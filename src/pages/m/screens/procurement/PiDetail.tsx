// ===========================================================================
// PiDetail — purchase invoice detail (/m/procurement/pi-…), prototype layout.
// Data: GET /api/purchase-invoices/:id (+ linkedGRNs, linkedPayments).
// Actions (desktop PurchaseInvoiceDetail.tsx + pi.tsx; lib piActions):
//   Draft      Confirm · Edit · Delete
//   Confirmed  Mark Paid (a foreign PI asks the payment-day rate, as pi.tsx) ·
//              Edit (a changed total asks first) · Void
//   Paid / Partial Paid  Void shown; the server refuses it once paid
//   Cancelled  Restore (back to the status before the void)
// Void / Restore only for FINANCE / SUPER_ADMIN / ADMIN (server requireFinance).
// ===========================================================================
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Ban, Banknote, CircleCheck, Download, Files, Package, Pencil, RotateCcw, Trash2, Wallet, type LucideIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { getCurrentUser } from "@/lib/auth";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { fmtDate } from "../../lib/do-mobile";
import {
  PI_ACTION_PERMS, PI_FLOW, PI_STATUS_TARGET, canVoidRole, dateOnly, flowSteps, isForeign, markPaidBody, n, normalizePiStatus, piActions,
  piFlowStatus, piPastDue, rows, s, statusOf, todayIso,
  type PiActionKey, type RawRow,
} from "../../lib/procurement-mobile";
import { BottomDock, ConfirmLines, FieldLabel, PrimaryButton, SheetFooter, SheetSub, Surface } from "../delivery/ui";
import { DL, INPUT, SHADOW_SECTION, T } from "../delivery/ui-tokens";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { downloadPiPdf, putPi, refreshProcurementCaches, send } from "./actions";
import { Banner, ChainRow, DetailColumn, Fact, FlagPill, InfoRows, KvSection, LineCard, MenuGroup, MenuRow, OffFlow, SectionTitle, Timeline, TilePill, TotalBlock, type ChainNode } from "./parts";
import { DetailFrame } from "./ProcurementDetailScreen";
import { PiEditForm } from "./PiForm";

type Env = { success?: boolean; data?: RawRow; linkedGRNs?: RawRow[]; linkedPayments?: RawRow[] };

const ICON: Record<PiActionKey, LucideIcon> = { CONFIRM: CircleCheck, MARK_PAID: Banknote, EDIT: Pencil, DELETE: Trash2, VOID: Ban, RESTORE: RotateCcw, PDF: Download };
const LABEL: Record<PiActionKey, string> = { CONFIRM: "Confirm", MARK_PAID: "Mark Paid", EDIT: "Edit invoice", DELETE: "Delete invoice", VOID: "Void invoice", RESTORE: "Restore", PDF: "Download PDF" };

export function PiDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useResponsiveLayout();
  const url = `/api/purchase-invoices/${encodeURIComponent(id)}`;
  const { data, loading, error, failure, refresh } = useCachedJson<Env>(url);
  const p = (data?.data ?? null) as RawRow | null;
  const grns = rows(data?.linkedGRNs);
  const payments = rows(data?.linkedPayments);
  const { hasPermission } = usePermissions();
  const canVoid = canVoidRole(getCurrentUser()?.role);
  const allowed = (k: PiActionKey) => PI_ACTION_PERMS[k].every(([r, a]) => hasPermission(r, a));

  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [editing, setEditing] = useState<RawRow | null>(null);
  const open = (docId: string) => navigate({ pathname: `/m/procurement/${encodeURIComponent(docId)}`, search: location.search });

  const done = (msg: string) => {
    refreshProcurementCaches();
    refresh();
    toast.show(msg, "success");
  };

  const run = async (k: PiActionKey) => {
    if (!p || busy) return;
    setMoreOpen(false);
    const no = s(p, "piNo");
    if (k === "PDF") return void downloadPiPdf(p).catch(() => toast.show("Could not generate the PDF.", "error"));
    if (k === "EDIT") return setEditing(p);
    if (k === "MARK_PAID") return setPayOpen(true);
    if (k === "CONFIRM") {
      const poDirect = !!s(p, "purchaseOrderId") && !s(p, "grnId");
      const ok = await confirmSheet.confirm({
        title: "Confirm invoice",
        sub: no,
        lines: [
          { icon: "info", text: "Moves the invoice from Draft to Confirmed and posts it to the ledger." },
          ...(poDirect ? [{ icon: "receipt" as const, text: "Billed straight off a purchase order: confirming also receives its goods into stock." }] : []),
        ],
        confirmLabel: "Confirm",
      });
      if (!ok) return;
      setBusy(true);
      const r = await putPi(id, { status: PI_STATUS_TARGET.CONFIRM });
      setBusy(false);
      return r.ok ? done("Invoice confirmed") : toast.show(r.error, "error");
    }
    if (k === "DELETE") {
      const ok = await confirmSheet.confirm({ title: "Delete draft invoice?", lines: [{ icon: "warning", text: `Delete draft invoice ${no}? This cannot be undone.` }], confirmLabel: "Delete" });
      if (!ok) return;
      setBusy(true);
      const r = await send(url, "DELETE");
      setBusy(false);
      if (!r.ok) return toast.show(r.error, "error");
      refreshProcurementCaches();
      navigate({ pathname: "/m/procurement", search: location.search }, { replace: true });
      return;
    }
    if (k === "VOID") {
      const ok = await confirmSheet.confirm({
        title: `Void ${no}?`,
        lines: [{ icon: "warning", text: "This reverses its ledger entry, gives the goods-receipt quantity back, and drops it out of the creditor aging. The invoice stays on file as CANCELLED. It cannot be voided if any payment has been applied." }],
        confirmLabel: "Void",
      });
      if (!ok) return;
      setBusy(true);
      const r = await send(`${url}/void`, "POST");
      setBusy(false);
      return r.ok ? done(`${no} voided`) : toast.show(r.error, "error");
    }
    if (k === "RESTORE") {
      const ok = await confirmSheet.confirm({
        title: `Restore ${no}?`,
        lines: [{ icon: "info", text: "This puts its ledger entry back, re-claims the goods-receipt quantity, and returns the invoice to the creditor aging. It is refused if another invoice has billed those goods-receipt lines in the meantime." }],
        confirmLabel: "Restore",
      });
      if (!ok) return;
      setBusy(true);
      const r = await send(`${url}/unvoid`, "POST");
      setBusy(false);
      return r.ok ? done(`${no} restored`) : toast.show(r.error, "error");
    }
  };

  const raw = p ? s(p, "status") : "";
  const status = normalizePiStatus(raw);
  const st = statusOf("pi", raw);
  const acts = p ? piActions(p, canVoid) : { primary: null, menu: [] as PiActionKey[] };
  const primary = acts.primary && allowed(acts.primary) ? acts.primary : null;
  const menu = acts.menu.filter(allowed);
  const past = p ? piPastDue(p, todayIso()) : false;
  const paid = p ? n(p, "paidAmountSen") : 0;
  const dockScope = layout.canSplitDetail ? "detail" : "content";
  const grn = grns[0];

  return (
    <DetailFrame noun="Purchase Invoice" code={p ? s(p, "piNo") || "Purchase Invoice" : ""} loading={loading} failure={failure} error={error} hasDoc={!!p} onRetry={refresh} onMore={() => setMoreOpen(true)}>
      {p ? (
        <>
          <DetailColumn>
            <section aria-label="Header" style={{ padding: "0 2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <TilePill tone={st.tone} label={st.label} size="md" dot />
                {past ? <FlagPill tone="danger" label="Past due" size="md" /> : null}
              </div>
              <h1 style={{ margin: "10px 0 0", fontSize: "var(--m-type-section-heading-size)", lineHeight: "var(--m-type-section-heading-line-height)", fontWeight: 700, letterSpacing: "var(--m-type-section-heading-tracking)", color: M.raisin, wordBreak: "break-word" }}>
                {s(p, "supplierName", "supplier") || "—"}
              </h1>
              <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>Supplier invoice {s(p, "supplierInvoiceNo") || "—"}</div>
              {status === "CANCELLED" ? (
                <Banner tone="danger" icon={Ban} title="Voided.">
                  {s(p, "remarks")}
                </Banner>
              ) : null}
            </section>

            <Surface ariaLabel="Invoice overview" radius={20} shadow={SHADOW_SECTION} style={{ marginTop: 16, padding: "16px 16px 14px" }}>
              <TotalBlock k="INVOICE AMOUNT" v={money(n(p, "amountSen"))} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 16px" }}>
                <Fact k="Invoice date" v={fmtDate(dateOnly(s(p, "invoiceDate")))} />
                <Fact k="Due date" v={fmtDate(dateOnly(s(p, "dueDate")))} warn={past} />
                <Fact k="Supplier DO No." v={s(p, "supplierDoNo")} />
                <Fact k="Supplier invoice" v={s(p, "supplierInvoiceNo")} />
                {paid > 0 ? <Fact k="Paid" v={money(paid)} /> : null}
                {paid > 0 ? <Fact k="Outstanding" v={money(Math.max(0, n(p, "amountSen") - paid))} /> : null}
              </div>
              <div style={{ height: 1, background: DL.track, margin: "16px -16px 14px" }} />
              {status === "CANCELLED" ? <OffFlow>Voided — it can be restored.</OffFlow> : <Timeline label="Status timeline" steps={flowSteps(PI_FLOW, piFlowStatus(raw))} />}
            </Surface>

            {rows(p.items).length ? (
              <>
                <SectionTitle icon={Package} title="Invoice lines" summary={`${rows(p.items).length} line${rows(p.items).length === 1 ? "" : "s"}`} />
                <div style={{ display: "grid", gap: 10 }}>
                  {rows(p.items).map((it, i) => (
                    <LineCard
                      key={s(it, "id") || i}
                      name={s(it, "materialName")}
                      code={s(it, "materialCode")}
                      spec={`${n(it, "qty")} × ${money(n(it, "unitPriceSen"))}${s(it, "lineType") && s(it, "lineType") !== "STOCKED" ? ` · ${s(it, "lineType")}` : ""}`}
                      right={money(n(it, "lineTotalSen"))}
                      rightSub={n(it, "taxSen") ? `Tax ${money(n(it, "taxSen"))}` : n(it, "discountSen") ? `Less ${money(n(it, "discountSen"))}` : ""}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {payments.length ? (
              <KvSection
                icon={Wallet}
                title="Payments"
                rowsList={payments.map((pay) => ({ k: s(pay, "paymentNo") || "Payment", sub: [fmtDate(dateOnly(s(pay, "date"))), s(pay, "method"), s(pay, "reference")].filter(Boolean).join(" · "), v: money(n(pay, "amountSen")) }))}
              />
            ) : null}

            <Surface ariaLabel="Document lineage" style={{ marginTop: 26, padding: "14px 15px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Files size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
                <span style={{ ...T.cardTitle, color: M.raisin }}>Document lineage</span>
              </div>
              {(() => {
                const poId = s(p, "purchaseOrderId");
                const nodes: ChainNode[] = [
                  poId || s(p, "poRef")
                    ? { label: "Purchase Order", doc: s(p, "poRef") || "Purchase Order", sub: "Source order", state: "linked", onClick: poId ? () => open(poId) : undefined }
                    : { label: "Purchase Order", doc: "None", sub: "Not linked", state: "pending" },
                  grn
                    ? { label: "Goods Receipt", doc: s(grn, "grnNumber"), sub: statusOf("grn", s(grn, "status")).label, state: "linked", onClick: () => open(s(grn, "id")) }
                    : { label: "Goods Receipt", doc: "None", sub: "Not linked", state: "pending" },
                  { label: "Purchase Invoice", doc: s(p, "piNo"), sub: "This invoice", state: "current" },
                ];
                return (
                  <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                    {nodes.map((c, i) => (
                      <ChainRow key={`${c.label}-${c.doc}-${i}`} node={c} nextPending={nodes[i + 1]?.state === "pending"} last={i === nodes.length - 1} />
                    ))}
                  </ol>
                );
              })()}
            </Surface>

            <InfoRows
              list={[
                { k: "Purchase company", v: s(p, "purchaseOrgCode") || "HOOKKA" },
                ...(isForeign(p) ? [{ k: "Currency", v: `${s(p, "currency")} · rate ${n(p, "fxRate") || "—"}` }] : []),
                { k: "Remarks", v: s(p, "remarks") || "—" },
              ]}
            />
            {primary ? <div aria-hidden style={{ height: 84 }} /> : null}
          </DetailColumn>

          {primary ? (
            <BottomDock variant="detail" scope={dockScope}>
              <PrimaryButton icon={ICON[primary]} iconSize={17} onClick={() => void run(primary)} disabled={busy} style={{ flex: 1.4 }}>
                {busy ? "Working…" : LABEL[primary]}
              </PrimaryButton>
            </BottomDock>
          ) : null}

          <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
            <MenuGroup>
              {menu.map((k, i) => (
                <MenuRow key={k} icon={ICON[k]} label={LABEL[k]} first={i === 0} danger={k === "VOID" || k === "DELETE"} onClick={() => void run(k)} />
              ))}
            </MenuGroup>
            <div style={{ height: 16 }} />
          </Sheet>

          <MarkPaidSheet open={payOpen} pi={p} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); done("Invoice marked paid"); }} />
          <PiEditForm pi={editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); done(msg); }} />
        </>
      ) : null}
      {confirmSheet.node}
      {toast.node}
    </DetailFrame>
  );
}

/** Mark Paid (pi.tsx): a foreign PI settles at the payment-day rate (payFxRate). */
function MarkPaidSheet({ open, pi, onClose, onPaid }: { open: boolean; pi: RawRow; onClose: () => void; onPaid: () => void }) {
  const foreign = isForeign(pi);
  const cur = s(pi, "currency");
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setRate(n(pi, "fxRate") ? String(n(pi, "fxRate")) : "");
    setErr(null);
  }
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Mark Paid">
      <SheetSub>{`${s(pi, "piNo")} · ${money(n(pi, "amountSen"))}`}</SheetSub>
      <ConfirmLines lines={[{ icon: "receipt", text: "Records this supplier invoice as paid in full and posts the payment." }]} />
      {foreign ? (
        <label style={{ display: "block", marginTop: 12 }}>
          <FieldLabel required>{`Payment-day rate (MYR per 1 ${cur}; booked at ${n(pi, "fxRate") || "?"})`}</FieldLabel>
          <input className="dl-input" type="text" inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value); setErr(null); }} aria-label="Payment-day rate" style={INPUT} />
        </label>
      ) : null}
      {err ? <div role="alert" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--dl-sem-danger)" }}>{err}</div> : null}
      <SheetFooter
        onCancel={onClose}
        confirmLabel="Mark Paid"
        busy={busy}
        onConfirm={async () => {
          const b = markPaidBody(pi, rate);
          if (!b.ok) return setErr(b.error);
          setBusy(true);
          const r = await putPi(s(pi, "id"), b.body);
          setBusy(false);
          if (!r.ok) return setErr(r.error);
          onPaid();
        }}
      />
    </Sheet>
  );
}
