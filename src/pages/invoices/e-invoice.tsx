import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column, type ContextMenuItem } from "@/components/ui/data-grid";
import { FinancePageTitle } from "@/components/finance/page-title";
import { KpiCards, SegmentedSwitch } from "@/components/finance/report-shell";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { fmtAmt } from "@/lib/finance-reports";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import {
  FileCheck,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  FileText,
  Code,
  RefreshCw,
  Ban,
  Copy,
  Download,
} from "lucide-react";
import type { EInvoice } from "@/types";
import { useResizableTables } from "@/lib/use-resizable-tables";
import { useEscapeClose } from "@/lib/escape-stack";
import {
  E_INVOICE_STATUS_NAME,
  E_INVOICE_WHERE,
  eInvoiceKpis,
  eInvoiceNextStep,
  isEInvoiceStatus,
  mytMonth,
  type EInvoiceStatus,
} from "@/lib/e-invoice";

// An issued sales invoice with no e-Invoice yet (GET /api/e-invoices/candidates).
type Candidate = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  totalSen: number;
  status: string;
  buyerTin: string;
};

type TabId = "dashboard" | "generate" | "xml";

// The three steps that keep the record in step with MyInvois.
type Dialog = { kind: "mark" | "record" | "cancel"; einv: EInvoice };

const JSON_HEADERS = { "Content-Type": "application/json" };

export default function EInvoicePage() {
  const { data: eResp, loading: eLoading, refresh: refreshEInvoices } = useCachedJson<{ success?: boolean; data?: EInvoice[] }>("/api/e-invoices");
  const { data: cResp, loading: cLoading, refresh: refreshCandidates } = useCachedJson<{ success?: boolean; data?: Candidate[] }>("/api/e-invoices/candidates");
  const eInvoices: EInvoice[] = useMemo(
    () => (eResp?.success ? eResp.data ?? [] : Array.isArray(eResp) ? eResp : []),
    [eResp]
  );
  const candidates: Candidate[] = useMemo(
    () => (cResp?.success ? cResp.data ?? [] : []),
    [cResp]
  );
  const loading = eLoading || cLoading;
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [generating, setGenerating] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const [result, setResult] = useState<"VALID" | "REJECTED">("VALID");
  const [uuid, setUuid] = useState("");
  const [reason, setReason] = useState("");
  const [selectedXmlId, setSelectedXmlId] = useState<string | null>(null);
  // Esc closes the open step (owner 2026-10-02: every finance popup closes on
  // Esc); not while it is being saved.
  useEscapeClose(() => { if (!busy) setDialog(null); }, !!dialog);

  const fetchData = async () => {
    invalidateCachePrefix("/api/e-invoices");
    refreshEInvoices();
    refreshCandidates();
  };

  const statusOf = (e: EInvoice): EInvoiceStatus => (isEInvoiceStatus(e.status) ? e.status : "PENDING");

  // The four cards (design): uploaded this month with a MyInvois ID,
  // validated, waiting, invalid / rejected.
  const kpi = eInvoiceKpis(eInvoices, mytMonth(new Date().toISOString()));
  const readyWithTin = useMemo(() => candidates.filter((c) => c.buyerTin), [candidates]);

  const openDialog = (kind: Dialog["kind"], einv: EInvoice) => {
    setSubmissionId("");
    setResult("VALID");
    setUuid("");
    setReason("");
    setDialogError(null);
    setDialog({ kind, einv });
  };

  // One step on one record. A refused input (400 / 409) keeps the step open
  // so it can be fixed; anything the server recorded closes it.
  const step = async (payload: Record<string, unknown>, okText: string) => {
    if (!dialog) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/e-invoices/${dialog.einv.id}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (res.ok && json?.success) {
        setNotice({ tone: "ok", text: okText });
        setDialog(null);
      } else if (res.status === 400 || res.status === 409) {
        setDialogError(json?.error ?? `Not saved (HTTP ${res.status}).`);
      } else {
        setNotice({ tone: "err", text: json?.error ?? `Not saved (HTTP ${res.status}).` });
        setDialog(null);
      }
    } catch {
      setDialogError("Not saved: the request could not be sent.");
    }
    await fetchData();
    setBusy(false);
  };

  // Build the XML for each invoice, one request each; every refusal is shown.
  const generate = async (ids: string[]) => {
    if (ids.length === 0) return;
    setNotice(null);
    setGenerating({ done: 0, total: ids.length });
    const failed: string[] = [];
    for (const [i, invoiceId] of ids.entries()) {
      try {
        const res = await fetch("/api/e-invoices", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ invoiceId }),
        });
        const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !json?.success) failed.push(json?.error ?? `HTTP ${res.status}`);
      } catch {
        failed.push("the request could not be sent");
      }
      setGenerating({ done: i + 1, total: ids.length });
    }
    await fetchData();
    setGenerating(null);
    const made = ids.length - failed.length;
    setNotice(
      failed.length
        ? { tone: "err", text: `${made} XML generated, ${failed.length} not — ${failed[0]}` }
        : { tone: "ok", text: `${made} XML generated · now in the Dashboard as Pending` },
    );
  };

  const statusBadge = (status: EInvoiceStatus) => {
    const config: Record<EInvoiceStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      PENDING: {
        bg: "bg-[#FAEFCB] border-[#E8D597]",
        text: "text-[#9C6F1E]",
        icon: <Clock className="h-3 w-3" />,
      },
      SUBMITTED: {
        bg: "bg-[#E0EDF0] border-[#A8CAD2]",
        text: "text-[#3E6570]",
        icon: <Send className="h-3 w-3" />,
      },
      VALID: {
        bg: "bg-[#EEF3E4] border-[#C6DBA8]",
        text: "text-[#4F7C3A]",
        icon: <CheckCircle2 className="h-3 w-3" />,
      },
      INVALID: {
        bg: "bg-[#F9E1DA] border-[#E8B2A1]",
        text: "text-[#9A3A2D]",
        icon: <AlertTriangle className="h-3 w-3" />,
      },
      REJECTED: {
        bg: "bg-[#F9E1DA] border-[#E8B2A1]",
        text: "text-[#9A3A2D]",
        icon: <XCircle className="h-3 w-3" />,
      },
      CANCELLED: {
        bg: "bg-gray-50 border-gray-200",
        text: "text-gray-500",
        icon: <Ban className="h-3 w-3" />,
      },
    };
    const c = config[status];
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.bg} ${c.text}`}
      >
        {c.icon}
        {E_INVOICE_STATUS_NAME[status]}
      </span>
    );
  };

  // The second line of "Where It Is": the error, else the UUID, else the
  // Submission ID.
  const whereDetail = (e: EInvoice) =>
    e.errorMessage ? e.errorMessage : e.status === "VALID" && e.uuid ? `UUID ${e.uuid}` : e.submissionId ? `Submission ID ${e.submissionId}` : "";

  const selectedXml = useMemo(
    () => eInvoices.find((e) => e.id === selectedXmlId) ?? eInvoices[0],
    [eInvoices, selectedXmlId]
  );

  const copyXml = async () => {
    if (!selectedXml?.xmlContent) return;
    try {
      await navigator.clipboard.writeText(selectedXml.xmlContent);
      setNotice({ tone: "ok", text: "XML copied" });
    } catch {
      setNotice({ tone: "err", text: "Could not copy — select the XML and copy it by hand." });
    }
  };

  const downloadXml = () => {
    if (!selectedXml?.xmlContent) return;
    const url = URL.createObjectURL(new Blob([selectedXml.xmlContent], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedXml.invoiceNo}.xml`;
    a.click();
    // eslint-disable-next-line no-restricted-syntax -- a click handler: frees the file link once the download has started
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Both lists in the Payment Vouchers table standard (owner 2026-10-20
  // 「这个可以」): the grid's header menu (export, columns), draggable headers,
  // its own search and windowing; the row's steps on right-click (or ⋮), no
  // action buttons in the rows; double-click a submission for its XML.
  const openXml = (e: EInvoice) => { setSelectedXmlId(e.id); setActiveTab("xml"); };
  const submissionMenu = (e: EInvoice): ContextMenuItem[] => {
    const next = eInvoiceNextStep(statusOf(e));
    return [
      ...(next === "mark" ? [{ label: "Mark as Submitted", action: () => openDialog("mark", e) }] : []),
      ...(next === "record" ? [{ label: "Record Result", action: () => openDialog("record", e) }] : []),
      ...(next === "cancel" ? [{ label: "Cancel", danger: true, action: () => openDialog("cancel", e) }] : []),
      { label: "View XML", separator: next !== null, action: () => openXml(e) },
    ];
  };
  const candidateMenu = (c: Candidate): ContextMenuItem[] => [
    { label: "Generate XML", disabled: !!generating, action: () => void generate([c.id]) },
  ];
  const submissionColumns = useMemo<Column<EInvoice>[]>(() => [
    { key: "invoiceNo", label: "Invoice No", type: "docno", width: "140px", render: (_v, e) => <span className="font-medium text-[#1F1D1B]">{e.invoiceNo}</span> },
    {
      key: "customerName", label: "Customer", width: "260px",
      exportValue: (e) => e.customerName ?? "",
      render: (_v, e) => (
        <span className="block leading-tight">
          <span className="text-[#1F1D1B]">{e.customerName}</span>
          <span className={`block text-xs ${e.customerTIN ? "text-[#6B7280]" : "text-[#9A3A2D]"}`}>{e.customerTIN ? `TIN ${e.customerTIN}` : "TIN missing"}</span>
        </span>
      ),
    },
    { key: "totalIncludingTax", label: "Total (RM)", type: "currency", align: "right", width: "130px", total: "sum", render: (_v, e) => <span className="font-medium text-[#1F1D1B]">{fmtAmt(e.totalIncludingTax)}</span> },
    {
      key: "submittedAt", label: "Uploaded To MyInvois", type: "date", width: "170px",
      exportValue: (e) => (e.submissionId && e.submittedAt ? formatDate(e.submittedAt) : ""),
      render: (_v, e) => (e.submissionId && e.submittedAt ? (
        <span className="block leading-tight text-[#374151]">
          {formatDate(e.submittedAt)}
          <span className="block text-xs text-[#6B7280]">{new Date(e.submittedAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}</span>
        </span>
      ) : <span className="text-[#C4BDB3]">-</span>),
    },
    {
      key: "status", label: "Status", width: "140px",
      filterAccessor: (e) => E_INVOICE_STATUS_NAME[statusOf(e)],
      exportValue: (e) => E_INVOICE_STATUS_NAME[statusOf(e)],
      render: (_v, e) => statusBadge(statusOf(e)),
    },
    {
      key: "where", label: "Where It Is", width: "280px", noFilter: true,
      exportValue: (e) => [E_INVOICE_WHERE[statusOf(e)], whereDetail(e)].filter(Boolean).join(" — "),
      render: (_v, e) => {
        const st = statusOf(e);
        const bad = st === "INVALID" || st === "REJECTED";
        return (
          <span className="block leading-tight">
            <span className={bad ? "text-[#9A3A2D]" : "text-[#374151]"}>{E_INVOICE_WHERE[st]}</span>
            {whereDetail(e) && <span className={`block text-xs ${bad ? "text-[#9A3A2D]" : "text-[#6B7280]"}`}>{whereDetail(e)}</span>}
          </span>
        );
      },
    },
  ], []);
  const candidateColumns = useMemo<Column<Candidate>[]>(() => [
    { key: "invoiceNo", label: "Invoice No", type: "docno", width: "140px", render: (_v, c) => <span className="font-medium text-[#1F1D1B]">{c.invoiceNo}</span> },
    { key: "invoiceDate", label: "Date", type: "date", width: "120px", render: (_v, c) => <span className="text-[#6B7280]">{c.invoiceDate ? formatDate(c.invoiceDate) : "-"}</span> },
    { key: "customerName", label: "Customer", width: "260px" },
    {
      key: "buyerTin", label: "Buyer TIN", width: "160px",
      filterAccessor: (c) => (c.buyerTin ? "Has TIN" : "TIN missing"),
      exportValue: (c) => c.buyerTin || "TIN missing",
      render: (_v, c) => (c.buyerTin
        ? <span className="text-[#374151]">{c.buyerTin}</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[#F9E1DA] border-[#E8B2A1] text-[#9A3A2D]">TIN missing</span>),
    },
    { key: "totalSen", label: "Total (RM)", type: "currency", align: "right", width: "130px", total: "sum", render: (_v, c) => <span className="font-medium text-[#1F1D1B]">{fmtAmt(c.totalSen)}</span> },
  ], []);

  // Finance tables (owner 2026-10-01): no wrapping; drag a column edge to
  // resize — widths remembered (src/lib/use-resizable-tables.ts).
  const tablesRef = useResizableTables("e-invoice");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#6B7280]">
        Loading...
      </div>
    );
  }


  return (
    <div ref={tablesRef} data-fin-tables className="space-y-6 max-md:space-y-4" data-fin-ui>
      {/* Header (finance v2: the explanation sits behind the (i)) */}
      <FinancePageTitle
        title="e-Invoice"
        explain="LHDN MyInvois — builds and stores the UBL XML for each sales invoice, and keeps the record of what MyInvois and LHDN answered."
        actions={
          <Button variant="outline" onClick={fetchData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {/* Standing notice. Nothing on this page transmits to LHDN — until
          BUG-2026-08-13-014 the Submit button minted a random `LHDN-SUB-…` id
          and UUID and painted the row VALID. The record now only carries what
          the owner keys from MyInvois. */}
      <div className="rounded-md border border-[#E8D597] bg-[#FAEFCB] px-3 py-2 text-xs text-[#7A5712]">
        <span className="font-semibold">Not connected to LHDN.</span> This page
        builds the e-Invoice XML and keeps the record. Send each invoice through
        MyInvois, then come back: <em>Mark as Submitted</em> with the Submission
        ID, and <em>Record Result</em> with the UUID when LHDN replies. Nothing
        turns Valid without a UUID.
      </div>

      {notice && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            notice.tone === "err"
              ? "border-[#E8B2A1] bg-[#F9E1DA] text-[#9A3A2D]"
              : "border-[#C6DBA8] bg-[#EEF3E4] text-[#4F7C3A]"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Tabs (finance v2: the switch; Generate counts what is ready) */}
      <SegmentedSwitch
        label="e-Invoice view"
        options={[
          { key: "dashboard", label: "Dashboard" },
          { key: "generate", label: candidates.length ? `Generate e-Invoice · ${candidates.length}` : "Generate e-Invoice" },
          { key: "xml", label: "XML Preview" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab 1: Dashboard */}
      {activeTab === "dashboard" && (
        <>
          <KpiCards
            items={[
              { label: "Uploaded (MTD)", value: String(kpi.uploadedMtd), note: "with a MyInvois ID" },
              { label: "Validated by LHDN", value: String(kpi.validated), tone: "ok", note: "UUID recorded" },
              { label: "Waiting", value: String(kpi.notSent + kpi.waitingLhdn), tone: "warn", note: `${kpi.notSent} not sent yet · ${kpi.waitingLhdn} waiting for LHDN` },
              { label: "Invalid / Rejected", value: String(kpi.invalidRejected), tone: "err", note: "fix and send again" },
            ]}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-[#6B5C32]" />
                e-Invoice Submissions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {eInvoices.length === 0 ? (
                <p className="text-sm text-[#6B7280] text-center py-8">
                  No e-invoices yet. Go to the Generate tab to build one.
                </p>
              ) : (
                <DataGrid
                  columns={submissionColumns}
                  data={eInvoices}
                  keyField="id"
                  gridId="e-invoice-submissions"
                  virtualize
                  onDoubleClick={openXml}
                  contextMenuItems={submissionMenu}
                  headerMenu
                  reorderableHeaders
                  exportName="e-Invoice Submissions"
                  searchPlaceholder="Search invoice / customer / TIN"
                  alwaysSearchKeys={["invoiceNo", "customerName", "customerTIN", "submissionId", "uuid"]}
                  maxHeight="calc(100vh - 340px)"
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Tab 2: Generate e-Invoice */}
      {activeTab === "generate" && (
        <>
          <KpiCards
            items={[
              { label: "Ready to generate", value: String(candidates.length), note: `${candidates.length - readyWithTin.length} missing buyer TIN` },
            ]}
          />
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#6B5C32]" />
                  Sales Invoices Without An e-Invoice
                </CardTitle>
                <Button
                  variant="primary"
                  disabled={readyWithTin.length === 0 || !!generating}
                  onClick={() => generate(readyWithTin.map((c) => c.id))}
                  title="Builds the XML for every invoice whose buyer has a TIN on file"
                >
                  <FileCheck className="h-4 w-4 mr-1" />
                  {generating
                    ? `Generating ${generating.done} / ${generating.total}...`
                    : `Generate All Ready (${readyWithTin.length})`}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {candidates.length === 0 ? (
                <p className="text-sm text-[#6B7280] text-center py-8">
                  Every issued invoice already has an e-Invoice.
                </p>
              ) : (
                <DataGrid
                  columns={candidateColumns}
                  data={candidates}
                  keyField="id"
                  gridId="e-invoice-candidates"
                  virtualize
                  contextMenuItems={candidateMenu}
                  headerMenu
                  reorderableHeaders
                  exportName="Sales Invoices Without An e-Invoice"
                  searchPlaceholder="Search invoice / customer / TIN"
                  alwaysSearchKeys={["invoiceNo", "customerName", "buyerTin"]}
                  maxHeight="calc(100vh - 340px)"
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Tab 3: XML Preview */}
      {activeTab === "xml" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Selector */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Select e-Invoice</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto">
                {eInvoices.map((einv) => (
                  <button
                    key={einv.id}
                    className={`w-full text-left px-4 py-3 border-b border-[#E2DDD8] hover:bg-[#F0ECE9]/50 transition-colors ${
                      selectedXml?.id === einv.id
                        ? "bg-[#6B5C32]/10 border-l-2 border-l-[#6B5C32]"
                        : ""
                    }`}
                    onClick={() => setSelectedXmlId(einv.id)}
                  >
                    <p className="text-sm font-medium text-[#1F1D1B]">
                      {einv.invoiceNo}
                    </p>
                    <p className="text-xs text-[#6B7280]">
                      {einv.customerName}
                    </p>
                    <div className="mt-1">{statusBadge(statusOf(einv))}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* XML Content */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5 text-[#6B5C32]" />
                  XML Preview
                  {selectedXml && (
                    <span className="text-sm font-normal text-[#6B7280]">
                      - {selectedXml.invoiceNo}.xml
                    </span>
                  )}
                </CardTitle>
                {selectedXml?.xmlContent && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={copyXml}>
                      <Copy className="h-3.5 w-3.5" />
                      Copy XML
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={downloadXml}>
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedXml ? (
                <p className="text-sm text-[#6B7280] text-center py-12">
                  No e-invoices yet. Generate one first.
                </p>
              ) : !selectedXml.xmlContent ? (
                <p className="text-sm text-[#6B7280] text-center py-12">
                  No XML content available for this e-invoice.
                </p>
              ) : (
                <div>
                  {/* Meta info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 max-sm:grid-cols-1">
                    <div className="bg-[#F0ECE9] rounded-md p-3">
                      <p className="text-xs text-[#6B7280]">Submission ID</p>
                      <p className="text-sm font-mono font-medium text-[#1F1D1B] truncate">
                        {selectedXml.submissionId || "Not submitted"}
                      </p>
                    </div>
                    <div className="bg-[#F0ECE9] rounded-md p-3">
                      <p className="text-xs text-[#6B7280]">UUID</p>
                      <p className="text-sm font-mono font-medium text-[#1F1D1B] truncate">
                        {selectedXml.uuid || "N/A"}
                      </p>
                    </div>
                    <div className="bg-[#F0ECE9] rounded-md p-3">
                      <p className="text-xs text-[#6B7280]">Customer TIN</p>
                      <p className="text-sm font-mono font-medium text-[#1F1D1B]">
                        {selectedXml.customerTIN || "Missing"}
                      </p>
                    </div>
                    <div className="bg-[#F0ECE9] rounded-md p-3">
                      <p className="text-xs text-[#6B7280]">Status</p>
                      <div className="mt-0.5">
                        {statusBadge(statusOf(selectedXml))}
                      </div>
                    </div>
                  </div>

                  {/* XML code block */}
                  <div className="bg-[#FAFAF8] border border-[#E2DDD8] rounded-lg overflow-auto max-h-[500px]">
                    <pre className="p-4 text-xs font-mono text-[#1F1D1B] leading-relaxed whitespace-pre">
                      {selectedXml.xmlContent}
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* The step dialog: Mark as Submitted / Record Result / Cancel */}
      {dialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4">
            {dialog.kind === "mark" && (
              <>
                <h2 className="text-lg font-bold text-[#1F1D1B] mb-2">
                  Mark as Submitted — {dialog.einv.invoiceNo}
                </h2>
                <p className="text-sm text-[#6B7280] mb-3">
                  You sent {dialog.einv.invoiceNo} through MyInvois? Key the
                  Submission ID MyInvois gave you.
                </p>
                {!dialog.einv.customerTIN && (
                  <p className="text-xs text-[#9A3A2D] mb-3">
                    No buyer TIN on this e-invoice. Add it on the customer
                    first — without one it is recorded as Invalid, not sent.
                  </p>
                )}
                <label className="block text-xs font-semibold text-[#4B5563] mb-1" htmlFor="einv-sub-id">
                  Submission ID
                </label>
                <input
                  id="einv-sub-id"
                  autoFocus
                  value={submissionId}
                  onChange={(e) => setSubmissionId(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-md border border-[#E2DDD8] px-3 py-2 text-sm font-mono"
                />
              </>
            )}
            {dialog.kind === "record" && (
              <>
                <h2 className="text-lg font-bold text-[#1F1D1B] mb-2">
                  Record Result — {dialog.einv.invoiceNo}
                </h2>
                <p className="text-sm text-[#6B7280] mb-3">
                  What did LHDN answer for {dialog.einv.invoiceNo}
                  {dialog.einv.submissionId ? ` (Submission ID ${dialog.einv.submissionId})` : ""}?
                </p>
                <div className="flex gap-4 mb-3 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name="einv-result" checked={result === "VALID"} onChange={() => setResult("VALID")} />
                    Validated
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name="einv-result" checked={result === "REJECTED"} onChange={() => setResult("REJECTED")} />
                    Rejected
                  </label>
                </div>
                {result === "VALID" ? (
                  <>
                    <label className="block text-xs font-semibold text-[#4B5563] mb-1" htmlFor="einv-uuid">
                      UUID LHDN issued
                    </label>
                    <input
                      id="einv-uuid"
                      autoFocus
                      value={uuid}
                      onChange={(e) => setUuid(e.target.value)}
                      maxLength={100}
                      className="w-full rounded-md border border-[#E2DDD8] px-3 py-2 text-sm font-mono"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-semibold text-[#4B5563] mb-1" htmlFor="einv-reason">
                      Why did LHDN reject it?
                    </label>
                    <textarea
                      id="einv-reason"
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="w-full rounded-md border border-[#E2DDD8] px-3 py-2 text-sm"
                    />
                  </>
                )}
              </>
            )}
            {dialog.kind === "cancel" && (
              <>
                <h2 className="text-lg font-bold text-[#1F1D1B] mb-2">
                  Cancel e-Invoice {dialog.einv.invoiceNo}
                </h2>
                <p className="text-sm text-[#6B7280] mb-3">
                  Cancel it in MyInvois first — LHDN allows this within 72
                  hours of validation. This marks the record here as
                  cancelled; nothing is sent to LHDN.
                </p>
              </>
            )}
            {dialogError && (
              <p className="text-xs text-[#9A3A2D] mt-3">{dialogError}</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
                {dialog.kind === "cancel" ? "No, Keep It" : "Close"}
              </Button>
              {dialog.kind === "mark" && (
                <Button
                  variant="primary"
                  disabled={busy || !submissionId.trim()}
                  onClick={() =>
                    step(
                      { action: "mark-submitted", submissionId: submissionId.trim() },
                      `${dialog.einv.invoiceNo} marked submitted · ${submissionId.trim()}`,
                    )
                  }
                >
                  {busy ? "Saving..." : "Mark as Submitted"}
                </Button>
              )}
              {dialog.kind === "record" && (
                <Button
                  variant="primary"
                  disabled={busy || (result === "VALID" ? !uuid.trim() : !reason.trim())}
                  onClick={() =>
                    step(
                      result === "VALID"
                        ? { action: "record-result", result, uuid: uuid.trim() }
                        : { action: "record-result", result, reason: reason.trim() },
                      `${dialog.einv.invoiceNo} recorded as ${result === "VALID" ? "Valid" : "Rejected"}`,
                    )
                  }
                >
                  {busy ? "Saving..." : result === "VALID" ? "Record Valid" : "Record Rejected"}
                </Button>
              )}
              {dialog.kind === "cancel" && (
                <Button
                  variant="primary"
                  className="bg-[#9A3A2D] hover:bg-[#9A3A2D]"
                  disabled={busy}
                  onClick={() => step({ action: "cancel" }, `${dialog.einv.invoiceNo} cancelled`)}
                >
                  {busy ? "Saving..." : "Yes, Mark Cancelled"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
