import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FinancePageTitle } from "@/components/finance/page-title";
import { KpiCards, SegmentedSwitch } from "@/components/finance/report-shell";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
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

  // Window both e-invoice tables so large invoice volumes stay light.
  const submissionsScrollRef = useRef<HTMLDivElement>(null);
  const submissionsVirtualizer = useVirtualizer({
    count: eInvoices.length,
    getScrollElement: () => submissionsScrollRef.current,
    estimateSize: () => 57,
    overscan: 10,
  });
  const availableScrollRef = useRef<HTMLDivElement>(null);
  const availableVirtualizer = useVirtualizer({
    count: candidates.length,
    getScrollElement: () => availableScrollRef.current,
    estimateSize: () => 49,
    overscan: 10,
  });

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

  const th = "text-left py-3 px-4 text-xs font-bold text-[#4B5563]";
  const thR = "text-right py-3 px-4 text-xs font-bold text-[#4B5563]";
  const actBtn = "h-7 px-2 text-[#3E6570] hover:text-[#2E4D57] hover:bg-[#E0EDF0]";

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
                <div
                  ref={submissionsScrollRef}
                  className="overflow-auto"
                  style={{ maxHeight: "calc(100vh - 340px)" }}
                >
                  <table data-fin-list className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-[#E2DDD8] bg-[#F0ECE9]">
                        <th className={th}>Invoice No</th>
                        <th className={th}>Customer</th>
                        <th className={thR}>Total (RM)</th>
                        <th className={th}>Uploaded To MyInvois</th>
                        <th className={th}>Status</th>
                        <th className={th}>Where It Is</th>
                        <th className={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const vItems = submissionsVirtualizer.getVirtualItems();
                        const padTop = vItems.length > 0 ? vItems[0].start : 0;
                        const padBottom =
                          vItems.length > 0
                            ? submissionsVirtualizer.getTotalSize() -
                              vItems[vItems.length - 1].end
                            : 0;
                        return (
                          <>
                            {padTop > 0 && (
                              <tr aria-hidden="true" data-fin-nolift="">
                                <td colSpan={7} style={{ height: padTop, padding: 0, border: 0 }} />
                              </tr>
                            )}
                            {vItems.map((vi) => {
                              const einv = eInvoices[vi.index];
                              if (!einv) return null;
                              const st = statusOf(einv);
                              const next = eInvoiceNextStep(st);
                              const bad = st === "INVALID" || st === "REJECTED";
                              return (
                        <tr
                          key={einv.id}
                          data-index={vi.index}
                          ref={submissionsVirtualizer.measureElement}
                          className="border-b border-[#E2DDD8] hover:bg-[#F0ECE9]/50 cursor-pointer"
                          title="Double-click to see the XML"
                          onDoubleClick={() => {
                            setSelectedXmlId(einv.id);
                            setActiveTab("xml");
                          }}
                        >
                          <td className="py-3 px-4 font-medium text-[#1F1D1B]">
                            {einv.invoiceNo}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-[#1F1D1B]">{einv.customerName}</div>
                            <div className={`text-xs ${einv.customerTIN ? "text-[#6B7280]" : "text-[#9A3A2D]"}`}>
                              {einv.customerTIN ? `TIN ${einv.customerTIN}` : "TIN missing"}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-[#1F1D1B]">
                            {formatCurrency(einv.totalIncludingTax)}
                          </td>
                          <td className="py-3 px-4 text-[#374151]">
                            {einv.submissionId && einv.submittedAt ? (
                              <>
                                <div>{formatDate(einv.submittedAt)}</div>
                                <div className="text-xs text-[#6B7280]">
                                  {new Date(einv.submittedAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </>
                            ) : (
                              <span className="text-[#C4BDB3]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4">{statusBadge(st)}</td>
                          <td className="py-3 px-4">
                            <div className={bad ? "text-[#9A3A2D]" : "text-[#374151]"}>{E_INVOICE_WHERE[st]}</div>
                            {whereDetail(einv) && (
                              <div className={`text-xs ${bad ? "text-[#9A3A2D]" : "text-[#6B7280]"}`}>{whereDetail(einv)}</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1">
                              {next === "mark" && (
                                <Button variant="ghost" size="sm" className={actBtn} onClick={() => openDialog("mark", einv)}>
                                  <Send className="h-3 w-3 mr-1" />
                                  Mark as Submitted
                                </Button>
                              )}
                              {next === "record" && (
                                <Button variant="ghost" size="sm" className={actBtn} onClick={() => openDialog("record", einv)}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Record Result
                                </Button>
                              )}
                              {next === "cancel" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-[#9A3A2D] hover:text-[#7A2E24] hover:bg-[#F9E1DA]"
                                  onClick={() => openDialog("cancel", einv)}
                                >
                                  <Ban className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[#6B5C32] hover:bg-[#F0ECE9]"
                                onClick={() => {
                                  setSelectedXmlId(einv.id);
                                  setActiveTab("xml");
                                }}
                              >
                                <Code className="h-3 w-3 mr-1" />
                                XML
                              </Button>
                            </div>
                          </td>
                        </tr>
                              );
                            })}
                            {padBottom > 0 && (
                              <tr aria-hidden="true" data-fin-nolift="">
                                <td colSpan={7} style={{ height: padBottom, padding: 0, border: 0 }} />
                              </tr>
                            )}
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
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
                <div
                  ref={availableScrollRef}
                  className="overflow-auto"
                  style={{ maxHeight: "calc(100vh - 340px)" }}
                >
                  <table data-fin-list className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-[#E2DDD8] bg-[#F0ECE9]">
                        <th className={th}>Invoice No</th>
                        <th className={th}>Date</th>
                        <th className={th}>Customer</th>
                        <th className={th}>Buyer TIN</th>
                        <th className={thR}>Total (RM)</th>
                        <th className={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const vItems = availableVirtualizer.getVirtualItems();
                        const padTop = vItems.length > 0 ? vItems[0].start : 0;
                        const padBottom =
                          vItems.length > 0
                            ? availableVirtualizer.getTotalSize() -
                              vItems[vItems.length - 1].end
                            : 0;
                        return (
                          <>
                            {padTop > 0 && (
                              <tr aria-hidden="true" data-fin-nolift="">
                                <td colSpan={6} style={{ height: padTop, padding: 0, border: 0 }} />
                              </tr>
                            )}
                            {vItems.map((vi) => {
                              const inv = candidates[vi.index];
                              if (!inv) return null;
                              return (
                        <tr
                          key={inv.id}
                          data-index={vi.index}
                          ref={availableVirtualizer.measureElement}
                          className="border-b border-[#E2DDD8] hover:bg-[#F0ECE9]/50"
                        >
                          <td className="py-3 px-4 font-medium text-[#1F1D1B]">
                            {inv.invoiceNo}
                          </td>
                          <td className="py-3 px-4 text-[#6B7280]">
                            {inv.invoiceDate ? formatDate(inv.invoiceDate) : "-"}
                          </td>
                          <td className="py-3 px-4 text-[#1F1D1B]">
                            {inv.customerName}
                          </td>
                          <td className="py-3 px-4">
                            {inv.buyerTin ? (
                              <span className="text-[#374151]">{inv.buyerTin}</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-[#F9E1DA] border-[#E8B2A1] text-[#9A3A2D]">
                                TIN missing
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-[#1F1D1B]">
                            {formatCurrency(inv.totalSen)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={actBtn}
                              disabled={!!generating}
                              onClick={() => generate([inv.id])}
                            >
                              <FileCheck className="h-3 w-3 mr-1" />
                              Generate XML
                            </Button>
                          </td>
                        </tr>
                              );
                            })}
                            {padBottom > 0 && (
                              <tr aria-hidden="true" data-fin-nolift="">
                                <td colSpan={6} style={{ height: padBottom, padding: 0, border: 0 }} />
                              </tr>
                            )}
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
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
