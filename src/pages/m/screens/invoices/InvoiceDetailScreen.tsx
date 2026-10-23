// ===========================================================================
// InvoiceDetailScreen — L2 /m/invoices/:id, phone AND tablet (owner 2026-10-21).
//
// Visuals: the Invoice Detail of Claude Design `Invoices v2.dc.html`;
// typography: the sibling /m detail screens. Rules: ../../lib/invoices-mobile.ts.
//
// Reads (all existing, read-only):
//   GET /api/invoices/:id   { data, lockReason, linkedCreditNotes,
//                             linkedDebitNotes, sourceConsignmentNote }
//   GET /api/audit-events?resource=invoices&resourceId=:id
//   GET /api/files?resourceType=INVOICE&resourceId=:id
//   GET /api/invoices/:id/print-extras   (PDF only, on tap)
// Writes are the EXISTING mobile ones, unchanged:
//   Record Payment → recordPaymentSpec (PUT /api/invoices/:id), shown and run
//     only for SENT / PARTIAL_PAID / OVERDUE with invoices:update (owner D2);
//   Edit Invoice   → editSpecFor("invoices") (PUT), invoices:update;
//   Upload a file  → POST /api/files, as the generic detail did.
// Kept from the generic detail but not in the HTML: Edit and QR (header "⋯"
// menu), Files (collapsible), line details & files (each expanded line).
// ===========================================================================
import { useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Ban, Calendar, CalendarClock, CircleAlert, CloudOff, CreditCard, FileText, Files, History, Info, Lock, MapPin, Paperclip, Pencil, QrCode, Route, Wallet,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { todayYmdMY } from "@/lib/utils";
import { MobileHeader, FormSheet, QrModal, Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { editSpecFor, recordPaymentSpec } from "../../config/forms";
import { refreshOne } from "../../config/mutate";
import type { FormSpec } from "../../config/form-types";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import {
  adjustments, auditLines, balanceSen, balanceTone, canRecordPayment, detailBanner, invoiceTone, isPastDue, itemRows,
  lifecycle, longDate, paidSen, paymentHistory, relatedChain, rows, statusLabel, statusOf, totalSen,
  type RawRow,
} from "../../lib/invoices-mobile";
import { n, s } from "../../lib/do-mobile";
import { BottomDock, PrimaryButton } from "../delivery/ui";
import { T } from "../delivery/ui-tokens";
import { useMobileToast } from "../delivery/ui-hooks";
import { ChainRow, DetailColumn, HeaderMore, MenuGroup, MenuRow } from "../procurement/parts";
import {
  CardHead, Collapsible, FlowNote, IconFact, InfoRow, InvoicePdfCard, LifecycleSteps, LineItemCard, MoneyTile, MoreButton,
  NoticeBanner, PaymentRow, SectionCard, StatusTag,
} from "./detail-parts";

type Env = {
  success?: boolean;
  data?: RawRow;
  lockReason?: string | null;
  linkedCreditNotes?: unknown;
  linkedDebitNotes?: unknown;
  sourceConsignmentNote?: { id?: string; noteNumber?: string } | null;
};
type FileRow = { id: string; filename: string; sizeBytes?: number; uploadedAt?: string };

const SHADOW_SECTION = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const FILE_ACCEPT =
  "image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function InvoiceDetailScreen() {
  const { id = "", itemId } = useParams();
  // Keyed by id: in the tablet split view, opening another invoice must not
  // carry over the previous one's expanded sections, sheets or busy flags.
  // With an itemId this screen is the LEFT pane of the tablet line route.
  return <InvoiceDetail key={id} id={id} inLinePane={!!itemId} />;
}

function InvoiceDetail({ id, inLinePane }: { id: string; inLinePane: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useResponsiveLayout();
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission("invoices", "update");
  const canRead = hasPermission("invoices", "read");

  const docUrl = id ? `/api/invoices/${encodeURIComponent(id)}` : null;
  const { data, loading, error, failure, refresh } = useCachedJson<Env>(docUrl);
  const doc = data?.success && data.data && typeof data.data === "object" ? data.data : null;
  const audit = useCachedJson<{ data?: unknown }>(doc ? `/api/audit-events?resource=invoices&resourceId=${encodeURIComponent(id)}` : null);
  const filesUrl = doc ? `/api/files?resourceType=INVOICE&resourceId=${encodeURIComponent(id)}` : null;
  const files = useCachedJson<{ data?: FileRow[] }>(filesUrl);

  const toast = useMobileToast();
  const [allItems, setAllItems] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [formSpec, setFormSpec] = useState<FormSpec | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const back = () => navigate(-1);
  const header = (title: string, more: boolean) => (
    <MobileHeader
      title={title}
      onBack={back}
      glass
      trailing={more ? <HeaderMore label="More actions" onClick={() => setMoreOpen(true)} /> : null}
    />
  );

  // ---- load states (BUG class C15: only a 404 may say "not found") ----
  if (loading && !doc) {
    return (
      <>
        {header("Invoice", false)}
        <DetailColumn>
          <div aria-busy="true" aria-label="Loading invoice">
            {[90, 210, 64, 150].map((h, i) => (
              <div key={i} style={{ height: h, borderRadius: 20, background: M.card, boxShadow: SHADOW_SECTION, marginTop: i ? 12 : 14, opacity: 0.7 }} />
            ))}
          </div>
        </DetailColumn>
      </>
    );
  }
  if (!doc && failure?.kind === "notFound") {
    return (
      <>
        {header("Invoice", false)}
        <div style={{ padding: "60px 18px", textAlign: "center", color: M.muted, ...T.body }}>Invoice not found.</div>
      </>
    );
  }
  if (!doc) {
    return (
      <>
        {header("Invoice", false)}
        <div role="alert" style={{ padding: "56px 24px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--m-inv-danger-bg)" }}>
            <CloudOff size={22} strokeWidth={1.9} color="var(--m-inv-danger)" />
          </div>
          <div style={{ ...T.cardTitle, color: M.raisin, marginTop: 14 }}>{error ? "Couldn’t load this invoice" : "This invoice could not be shown."}</div>
          <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>Check your connection and try again.</div>
          <button
            type="button"
            onClick={() => refresh()}
            style={{ marginTop: 16, height: 44, padding: "0 22px", borderRadius: 9999, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  // ---- derived view (real fields only) ----
  const today = todayYmdMY();
  const st = statusOf(doc);
  const tone = invoiceTone(st);
  const invoiceNo = s(doc, "invoiceNo") || "Invoice";
  const banner = detailBanner(doc, today);
  const lockReason = typeof data?.lockReason === "string" && data.lockReason ? data.lockReason : "";
  const bal = balanceSen(doc);
  const balTone = balanceTone(doc, today);
  const past = isPastDue(doc, today);
  const life = lifecycle(st);
  const items = rows(doc.items);
  const shownItems = allItems ? items : items.slice(0, 2);
  const qty = items.reduce((a, it) => a + n(it, "quantity"), 0);
  const pays = paymentHistory(doc);
  const chain = relatedChain(doc, data?.sourceConsignmentNote);
  const adj = adjustments(data, totalSen(doc));
  const events = auditLines(audit.data?.data);
  const fileList = Array.isArray(files.data?.data) ? files.data.data : [];
  const payable = canRecordPayment(st, canUpdate);
  const editSpec = canUpdate ? editSpecFor("invoices", doc, id) : null;
  // Tablet line route: this detail is the left (list-width) pane, so the dock
  // stays over it instead of covering the line item on the right.
  const dockScope = !layout.canSplitDetail ? "content" : inLinePane ? "list" : "detail";
  const customerId = s(doc, "customerId");
  const open = (to: string) => navigate({ pathname: to, search: location.search });

  const balColors =
    balTone === "danger"
      ? { bg: "var(--m-inv-danger-bg)", fg: "var(--m-inv-danger-fg)" }
      : balTone === "warning"
        ? { bg: "var(--m-inv-warning-bg)", fg: "var(--m-inv-warning-fg)" }
        : { bg: "var(--m-inv-success-bg)", fg: "var(--m-inv-paid-label)" };

  const startPayment = () => {
    // Same eligibility in the handler as on the button (owner D2).
    if (!canRecordPayment(statusOf(doc), canUpdate)) {
      toast.show("Payments can only be recorded on Sent, Partial Paid or Overdue invoices.", "error");
      return;
    }
    setFormSpec(recordPaymentSpec(doc, id));
  };
  const startEdit = () => {
    setMoreOpen(false);
    if (!canUpdate || !editSpec) return;
    setFormSpec(editSpec);
  };

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("resourceType", "INVOICE");
      fd.append("resourceId", id);
      const resp = await fetch("/api/files", { method: "POST", body: fd, credentials: "include" });
      const json = (await resp.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!resp.ok || !json.success) toast.show(json.error || `Upload failed (${resp.status})`, "error");
      else {
        toast.show("Uploaded.", "success");
        if (filesUrl) refreshOne(filesUrl);
      }
    } catch (err) {
      toast.show((err as Error).message || "Upload failed", "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const qrValue = `${typeof window !== "undefined" ? window.location.origin : ""}/m/invoices/${encodeURIComponent(id)}`;

  return (
    <>
      {header(invoiceNo, true)}
      <DetailColumn>
        {/* A. Header */}
        <section aria-label="Invoice header" style={{ padding: "0 2px" }}>
          <StatusTag tone={tone} label={statusLabel(st)} size="md" />
          <h1
            style={{
              margin: "10px 0 0", fontSize: "var(--m-type-section-heading-size)", lineHeight: "var(--m-type-section-heading-line-height)", fontWeight: 700,
              letterSpacing: "var(--m-type-section-heading-tracking)", color: M.raisin, wordBreak: "break-word",
            }}
          >
            {s(doc, "customerName") || "—"}
          </h1>
          {s(doc, "customerState") ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, ...T.meta, color: M.ink }}>
              <MapPin size={13} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden />
              {s(doc, "customerState")}
            </div>
          ) : null}
          {banner ? <NoticeBanner tone={banner.tone} icon={banner.tone === "danger" ? CircleAlert : Ban} text={banner.text} /> : null}
          {lockReason ? <NoticeBanner tone="neutral" icon={Lock} text={lockReason} /> : null}
        </section>

        {/* B. Overview */}
        <section aria-label="Invoice overview" style={{ marginTop: 16, background: M.card, borderRadius: 20, padding: "18px 18px 16px", boxShadow: SHADOW_SECTION }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>
            <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
            INVOICE TOTAL
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 6, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: M.ink }}>RM</span>
            <span style={{ minWidth: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.6px", color: M.raisin, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
              {money(totalSen(doc)).replace(/^RM\s*/, "")}
            </span>
          </div>
          {/* Two columns while there is room; one per row in a narrow pane — money never clipped. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 14 }}>
            <MoneyTile label="Amount paid" value={money(paidSen(doc))} bg="var(--m-inv-success-bg)" fg="var(--m-inv-paid-label)" />
            <MoneyTile label="Balance due" value={money(Math.max(0, bal))} bg={balColors.bg} fg={balColors.fg} />
          </div>
          <div style={{ height: 1, background: "var(--m-segment-track)", margin: "16px 0 14px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "14px 16px" }}>
            <IconFact icon={Calendar} label="Invoice Date" value={longDate(s(doc, "invoiceDate"))} />
            <IconFact icon={CalendarClock} label="Due Date" value={longDate(s(doc, "dueDate"))} warn={past} />
          </div>
        </section>

        {/* Invoice PDF (owner spec) — after the overview, before the lifecycle. */}
        {canRead ? (
          <InvoicePdfCard doc={doc} id={id} fileName={`${s(doc, "invoiceNo") || "INVOICE"}.pdf`} onError={(m) => toast.show(m, "error")} />
        ) : null}

        {/* C. Lifecycle */}
        <SectionCard label="Invoice lifecycle" radius={20} big style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Route size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
            <span style={{ ...T.cardTitle, color: M.raisin }}>Invoice lifecycle</span>
          </div>
          {life.inFlow ? <LifecycleSteps steps={life.steps} /> : <FlowNote tone={tone} text={life.note} />}
        </SectionCard>

        {/* D. Line items */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 2px 10px", flexWrap: "wrap" }}>
          <FileText size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
          <span style={{ ...T.cardTitle, color: M.raisin }}>Line items</span>
          <span style={{ fontSize: 12.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
            {items.length} line{items.length === 1 ? "" : "s"} · {qty} qty
          </span>
        </div>
        {items.length === 0 ? (
          <div style={{ padding: "18px 16px", borderRadius: 16, background: M.card, textAlign: "center", fontSize: 12.5, color: M.ink }}>No line items on this invoice.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
            {shownItems.map((it, i) => {
              const itemId = s(it, "id");
              return (
                <LineItemCard
                  key={itemId || i}
                  name={s(it, "productName")}
                  sku={s(it, "productCode")}
                  spec={[s(it, "sizeLabel"), s(it, "fabricCode")].filter(Boolean).join(" · ")}
                  total={money(n(it, "totalSen"))}
                  qty={n(it, "quantity")}
                  rowsList={itemRows(it)}
                  onDetails={itemId ? () => open(`/m/invoices/${encodeURIComponent(id)}/item/${encodeURIComponent(itemId)}`) : undefined}
                />
              );
            })}
          </div>
        )}
        {items.length > 2 ? <MoreButton label={allItems ? "Show fewer items" : `View all ${items.length} items`} onClick={() => setAllItems((v) => !v)} /> : null}

        {/* E. Payment history */}
        <SectionCard label="Payment history" style={{ marginTop: 26 }}>
          <CardHead
            icon={Wallet}
            title="Payment history"
            trailing={pays.rows.length ? <span style={{ fontSize: 12.5, color: M.ink }}>{pays.rows.length}</span> : null}
          />
          {pays.rows.length ? (
            pays.rows.map((p) => <PaymentRow key={p.key} p={p} />)
          ) : pays.unitemisedSen != null ? (
            <div style={{ padding: "4px 15px 15px", fontSize: 12.5, lineHeight: 1.45, color: M.ink }}>
              {money(pays.unitemisedSen)} is recorded as paid, but itemised payment records aren’t available for this invoice.
            </div>
          ) : (
            <div style={{ padding: "4px 15px 15px", fontSize: 12.5, color: M.ink }}>No payments recorded yet.</div>
          )}
        </SectionCard>

        {/* F + G. Related documents + adjustments */}
        <SectionCard label="Related documents">
          <CardHead icon={Files} title="Related documents" pad="15px 15px 4px" />
          <ol aria-label="Document relationship" style={{ listStyle: "none", margin: 0, padding: "8px 15px 10px" }}>
            {chain.map((c, i) => (
              <ChainRow
                key={`${c.label}-${c.doc}`}
                last={i === chain.length - 1}
                nextPending={false}
                node={{ label: c.label, doc: c.doc, sub: c.sub, state: c.current ? "current" : "linked", onClick: c.href ? () => open(c.href as string) : undefined }}
              />
            ))}
          </ol>
          {adj.rows.length ? (
            <>
              <div style={{ borderTop: "1px solid var(--m-segment-track)", padding: "12px 15px 6px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>ADJUSTMENTS</div>
              {adj.rows.map((a) => (
                <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "6px 15px 10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{a.no}</span>
                      {a.status ? <StatusTag tone={a.tone} label={statusLabel(a.status)} /> : null}
                    </div>
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>{a.sub}</div>
                  </div>
                  <span
                    style={{
                      flex: "none", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                      color: a.kind === "CN" && a.amountSen != null ? "var(--m-inv-danger)" : M.raisin,
                    }}
                  >
                    {a.amountSen == null ? "—" : `${a.kind === "CN" ? "− " : "+ "}${money(a.amountSen)}`}
                  </span>
                </div>
              ))}
              {adj.issuedSen != null ? (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 15px 14px", borderTop: "1px solid var(--m-segment-track)", fontSize: 12.5, color: M.ink }}>
                  <span>Invoice as issued</span>
                  <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(adj.issuedSen)}</span>
                </div>
              ) : null}
            </>
          ) : null}
        </SectionCard>

        {/* H. Additional information */}
        <Collapsible icon={Info} title="Additional information" open={infoOpen} onToggle={() => setInfoOpen((v) => !v)}>
          <InfoRow k="Customer PO" v={s(doc, "customerPOId") || "—"} />
          <InfoRow k="Company SO" v={s(doc, "companySOId") || "—"} />
          <InfoRow k="DO No" v={s(doc, "doNo") || "—"} />
          {customerId ? (
            <InfoRow k="Customer" v={s(doc, "customerName") || "Customer"} onClick={() => open(`/m/customers/${encodeURIComponent(customerId)}`)} />
          ) : null}
          {s(doc, "hubName") ? <InfoRow k="Hub" v={s(doc, "hubName")} /> : null}
          {s(doc, "notes") ? <InfoRow k="Notes" v={s(doc, "notes")} /> : null}
        </Collapsible>

        {/* Files (kept from the generic detail; not in the HTML). */}
        <Collapsible
          icon={Paperclip}
          title="Files"
          summary={files.data ? String(fileList.length) : undefined}
          open={filesOpen}
          onToggle={() => setFilesOpen((v) => !v)}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 44, borderTop: "1px solid var(--m-segment-track)" }}>
            <span style={{ fontSize: 12.5, color: M.ink }}>{files.loading && !files.data ? "Loading…" : `${fileList.length} attached`}</span>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "none", background: uploading ? "var(--m-inv-tile-bg)" : M.taupe, color: uploading ? M.muted : "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: uploading ? "default" : "pointer" }}
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={FILE_ACCEPT}
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </div>
          {fileList.map((f) => (
            <a
              key={f.id}
              href={`/api/files/${encodeURIComponent(f.id)}/download`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, borderTop: "1px solid var(--m-segment-track)", color: M.raisin, textDecoration: "none" }}
            >
              <FileText size={18} color={M.taupe} aria-hidden />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
                <span style={{ display: "block", fontSize: 11.5, color: M.muted }}>
                  {[f.sizeBytes ? `${Math.round(f.sizeBytes / 1024)} KB` : "", f.uploadedAt ? longDate(f.uploadedAt) : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
            </a>
          ))}
        </Collapsible>

        {/* I. Audit history */}
        <Collapsible icon={History} title="Audit history" open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)}>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink }}>Recorded audit events only — may not include every historical change.</div>
          {audit.loading && !audit.data ? (
            <div style={{ padding: "12px 0 6px", fontSize: 12.5, color: M.ink }}>Loading…</div>
          ) : audit.error && !audit.data ? (
            <div style={{ padding: "12px 0 6px", fontSize: 12.5, color: M.ink }}>Couldn’t load the audit history.</div>
          ) : events.length === 0 ? (
            <div style={{ padding: "12px 0 6px", fontSize: 12.5, color: M.ink }}>No recorded events.</div>
          ) : (
            <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
              {events.map((ev, i) => (
                <li key={ev.key} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 16 }}>
                  <span aria-hidden style={{ position: "absolute", left: 6, top: 16, bottom: 0, width: 2, background: i === events.length - 1 ? "transparent" : "var(--m-segment-track)" }} />
                  <span aria-hidden style={{ position: "relative", width: 14, height: 14, flex: "none", boxSizing: "border-box", borderRadius: "50%", marginTop: 3, background: i === 0 ? "var(--m-inv-icon)" : M.card, border: "3px solid var(--m-inv-icon)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin }}>{ev.title}</div>
                    {ev.detail ? <div style={{ fontSize: 12.5, color: "var(--m-inv-body)", marginTop: 3 }}>{ev.detail}</div> : null}
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>{[auditTime(ev.ts), ev.actor].filter(Boolean).join(" · ")}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Collapsible>

        {payable ? <div aria-hidden style={{ height: 84 }} /> : <div aria-hidden style={{ height: 16 }} />}
      </DetailColumn>

      {/* Record Payment — eligible statuses + invoices:update only (owner D2). */}
      {payable ? (
        <BottomDock variant="detail" scope={dockScope}>
          <PrimaryButton icon={CreditCard} iconSize={17} onClick={startPayment} style={{ flex: 1 }}>
            Record Payment
          </PrimaryButton>
        </BottomDock>
      ) : null}

      {/* "⋯" — kept actions that the HTML does not draw: Edit (invoices:update) and QR. */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
        <MenuGroup>
          {editSpec ? <MenuRow icon={Pencil} label="Edit invoice" first onClick={startEdit} /> : null}
          <MenuRow
            icon={QrCode}
            label="Show QR code"
            first={!editSpec}
            onClick={() => {
              setMoreOpen(false);
              setQrOpen(true);
            }}
          />
        </MenuGroup>
        <div style={{ height: 16 }} />
      </Sheet>

      <FormSheet
        open={formSpec != null}
        onClose={() => setFormSpec(null)}
        spec={formSpec}
        onSaved={() => {
          const wasPayment = formSpec?.title === "Record Payment";
          setFormSpec(null);
          refresh();
          toast.show(wasPayment ? "Payment recorded." : "Saved.", "success");
        }}
      />

      <QrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`Invoices · ${invoiceNo}`}
        choices={[{ label: invoiceNo, code: invoiceNo, value: qrValue }]}
        downloadName={`invoices-${invoiceNo}`}
      />
      {toast.node}
    </>
  );
}

/** "14 Oct 2026, 16:20" in the viewer's local time; "" when unreadable. */
function auditTime(ts: string): string {
  const t = new Date(ts);
  if (!ts || Number.isNaN(t.getTime())) return "";
  const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return `${longDate(ymd)}, ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}
