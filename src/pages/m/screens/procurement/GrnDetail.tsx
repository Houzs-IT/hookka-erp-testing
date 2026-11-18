// ===========================================================================
// GrnDetail — goods receipt detail (/m/procurement/grn-…), prototype layout.
// Data: GET /api/grn/:id; its invoices from GET /api/purchase-invoices
// (grnId) when readable — the GRN payload has no linked-PI field.
// Actions (desktop grn-detail.tsx, lib/procurement-mobile.ts grnActions):
//   Post to Stock (Draft / Approved, only once ARRIVED) · Create Invoice
//   (Posted) · Download PDF · Cancel Receipt.
// NOT here: Approve (BUG-2026-10-21-344 — it posts stock without drawing the
// PO down), Mark Arrived, Edit Quantities, shipment / landed-cost editing,
// purchase returns (all desktop; owner 2026-10-21).
// ===========================================================================
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Ban, Coins, Download, FileText, Files, Package, Pencil, Receipt, Ship, Warehouse, type LucideIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { fmtDate } from "../../lib/do-mobile";
import {
  ARRIVAL_LABEL, GRN_ACTION_PERMS, GRN_FLOW, GRN_POST_NEEDS_ARRIVAL, QC_LABEL, arrivalOf, dateOnly, flowSteps, grnActions, grnCancelLines,
  landedCost, n, rows, s, statusOf,
  type GrnActionKey, type RawRow,
} from "../../lib/procurement-mobile";
import { GRN_ARRIVAL_PERM, GRN_EDIT_QTY_PERM, grnArrivalAdvance, grnQtyBody, grnQtyCheck, grnQtyEditState, grnQtyLines } from "../../lib/grn-mobile";
import { BottomDock, FieldLabel, PrimaryButton, SheetFooter, SheetSub, Surface } from "../delivery/ui";
import { DL, INPUT, SHADOW_SECTION, T } from "../delivery/ui-tokens";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { downloadGrnPdf, putGrn, putGrnArrival, refreshProcurementCaches, send } from "./actions";
import { Banner, ChainRow, DetailColumn, Fact, KvSection, LineCard, MenuGroup, MenuRow, OffFlow, SectionTitle, Timeline, TilePill, FlagPill, TotalBlock, type ChainNode, type KvRow } from "./parts";
import { DetailFrame } from "./ProcurementDetailScreen";
import { PiForm } from "./PiForm";

type Env = { success?: boolean; data?: RawRow };

const ICON: Record<GrnActionKey, LucideIcon> = { POST: Warehouse, CREATE_INVOICE: Receipt, CANCEL: Ban, PDF: Download };
const LABEL: Record<GrnActionKey, string> = { POST: "Post to Stock", CREATE_INVOICE: "Create Invoice", CANCEL: "Cancel Receipt", PDF: "Download PDF" };

export function GrnDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useResponsiveLayout();
  const url = `/api/grn/${encodeURIComponent(id)}`;
  const { data, loading, error, failure, refresh } = useCachedJson<Env>(url);
  const g = (data?.data ?? null) as RawRow | null;
  const { hasPermission } = usePermissions();
  const allowed = (k: GrnActionKey) => GRN_ACTION_PERMS[k].every(([r, a]) => hasPermission(r, a));
  const piList = useCachedJson<{ data?: RawRow[] }>(g && hasPermission("purchase-invoices", "read") ? "/api/purchase-invoices" : null);
  const invoices = rows(piList.data?.data).filter((p) => s(p, "grnId") === id && s(p, "status") !== "CANCELLED");

  const toast = useMobileToast();
  const confirmSheet = useConfirmSheet();
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [piOpen, setPiOpen] = useState(false);
  const [qtyOpen, setQtyOpen] = useState(false);
  const [qtyVals, setQtyVals] = useState<string[]>([]);
  const [qtyErr, setQtyErr] = useState<string | null>(null);
  const filesList = useCachedJson<{ data?: RawRow[] }>(g ? `/api/files?resourceType=GRN&resourceId=${encodeURIComponent(id)}` : null);
  const sourceFiles = rows(filesList.data?.data);
  const open = (docId: string) => navigate({ pathname: `/m/procurement/${encodeURIComponent(docId)}`, search: location.search });

  const run = async (k: GrnActionKey) => {
    if (!g || busy) return;
    setMoreOpen(false);
    const no = s(g, "grnNumber");
    if (k === "PDF") return void downloadGrnPdf(g).catch(() => toast.show("Could not generate the PDF.", "error"));
    if (k === "CREATE_INVOICE") return setPiOpen(true);
    if (k === "POST") {
      if (arrivalOf(g) !== "ARRIVED") return toast.show(GRN_POST_NEEDS_ARRIVAL, "error");
      const ok = await confirmSheet.confirm({ title: "Post to Stock", sub: no, lines: [{ icon: "receipt", text: "Posts the received quantities into stock." }], confirmLabel: "Post to Stock" });
      if (!ok) return;
      setBusy(true);
      const r = await putGrn(id, { status: "POSTED" });
      setBusy(false);
      if (!r.ok) return toast.show(r.error, "error");
      refreshProcurementCaches();
      refresh();
      const unresolved = Number((r.body as { data?: { costing?: { unresolvedLines?: number } } } | undefined)?.data?.costing?.unresolvedLines ?? 0);
      return unresolved > 0 ? toast.show(`Posted, but ${unresolved} line(s) had no matching raw material — that stock did NOT land. Check the item codes.`, "error") : toast.show(`${no} posted to stock`, "success");
    }
    if (k === "CANCEL") {
      const ok = await confirmSheet.confirm({ title: `Cancel receipt ${no}?`, lines: grnCancelLines(g).map((text, i) => ({ icon: i === 1 ? "warning" : "info", text })), confirmLabel: "Cancel Receipt" });
      if (!ok) return;
      setBusy(true);
      const r = await send(`${url}/cancel`, "POST", {});
      setBusy(false);
      if (!r.ok) return toast.show(r.error, "error");
      refreshProcurementCaches();
      refresh();
      return toast.show(`${no} cancelled`, "success");
    }
  };

  const advance = async () => {
    const adv = g ? grnArrivalAdvance(g) : null;
    if (!g || !adv || busy) return;
    setMoreOpen(false);
    const no = s(g, "grnNumber");
    const ok = await confirmSheet.confirm({
      title: adv.label,
      sub: no,
      lines: [{ icon: "info", text: adv.target === "ARRIVED" ? "Marks the goods as arrived, which is what allows Post to Stock. Nothing is posted yet." : "Moves the shipment one step along the arrival pipeline (Planning → In Transit → At Customs → Arrived)." }],
      confirmLabel: adv.label,
    });
    if (!ok) return;
    setBusy(true);
    const r = await putGrnArrival(id, adv.target);
    setBusy(false);
    if (!r.ok) return toast.show(r.error, "error");
    refreshProcurementCaches();
    refresh();
    toast.show(`${adv.label} — done`, "success");
  };

  const openQtyEdit = () => {
    if (!g) return;
    setMoreOpen(false);
    setQtyErr(null);
    setQtyVals(grnQtyLines(g).map((l) => String(l.oldAccepted)));
    setQtyOpen(true);
  };
  const saveQty = async () => {
    if (!g || busy) return;
    const check = grnQtyCheck(g, qtyVals);
    if (!check.ok) return setQtyErr(check.error);
    if (!check.changed) return setQtyErr("No quantities changed.");
    const posted = s(g, "status") === "POSTED";
    const ok = await confirmSheet.confirm({
      title: "Adjust received quantities?",
      sub: s(g, "grnNumber"),
      lines: [{ icon: "info", text: posted ? `${check.deltaText} A matching cost entry is posted so inventory and cost stay in sync.` : "Updates the accepted quantities on this goods receipt. Nothing has been posted to stock yet." }],
      confirmLabel: "Save quantities",
    });
    if (!ok) return;
    setBusy(true);
    const r = await putGrn(id, grnQtyBody(g, qtyVals));
    setBusy(false);
    if (!r.ok) return setQtyErr(r.error);
    setQtyOpen(false);
    refreshProcurementCaches();
    refresh();
    const unresolved = Number((r.body as { editAdjust?: { unresolved?: unknown[] } } | undefined)?.editAdjust?.unresolved?.length ?? 0);
    if (unresolved > 0) toast.show(`Saved, but ${unresolved} changed line(s) had no matching raw material — that stock delta did NOT move. Check the item codes.`, "error");
    else toast.show(posted ? "Received quantities updated — stock adjusted" : "Received quantities updated", "success");
  };

  const status = g ? s(g, "status") : "";
  const st = statusOf("grn", status);
  const acts = g ? grnActions(g) : { primary: null, postBlocked: false, menu: [] as GrnActionKey[] };
  const primary = acts.primary && allowed(acts.primary) ? acts.primary : null;
  const menu = acts.menu.filter(allowed);
  const arrival = g ? arrivalOf(g) : "ARRIVED";
  const adv = g ? grnArrivalAdvance(g) : null;
  const canUpd = GRN_ARRIVAL_PERM.every(([r, a]) => hasPermission(r, a));
  const advPrimary = !!(primary === "POST" && acts.postBlocked && adv && canUpd);
  const qtyState = g ? grnQtyEditState(g) : ({ ok: false, reason: "" } as const);
  const canEditQty = GRN_EDIT_QTY_PERM.every(([r, a]) => hasPermission(r, a));
  const advInMenu = !!(adv && canUpd && !advPrimary);
  const qtyInMenu = canEditQty && (qtyState.ok || !!qtyState.reason);
  const dockScope = layout.canSplitDetail ? "detail" : "content";
  const lc = g ? landedCost(g) : null;

  const shipment: KvRow[] = g
    ? ([
        ["Shipping method", s(g, "shipping_method")],
        ["Carrier", s(g, "carrier_name")],
        ["Tracking no.", s(g, "tracking_number")],
        ["Container no.", s(g, "container_number")],
        ["Expected arrival", fmtDate(dateOnly(s(g, "expected_arrival")))],
        ["Actual arrival", fmtDate(dateOnly(s(g, "actual_arrival")))],
        ["Customs status", s(g, "customs_status")],
        ["Customs clearance", fmtDate(dateOnly(s(g, "customs_clearance_date")))],
      ] as [string, string][])
        .filter(([, v]) => v)
        .map(([k, v]) => ({ k, v }))
    : [];

  return (
    <DetailFrame noun="Goods Receipt" code={g ? s(g, "grnNumber") || "Goods Receipt" : ""} loading={loading} failure={failure} error={error} hasDoc={!!g} onRetry={refresh} onMore={() => setMoreOpen(true)}>
      {g ? (
        <>
          <DetailColumn>
            <section aria-label="Header" style={{ padding: "0 2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <TilePill tone={st.tone} label={st.label} size="md" dot />
                {s(g, "qcStatus") === "PENDING" ? <FlagPill tone="warning" label="QC Pending" size="md" /> : null}
                <TilePill tone={arrival === "ARRIVED" ? "success" : "info"} label={ARRIVAL_LABEL[arrival] ?? arrival} size="md" />
              </div>
              <h1 style={{ margin: "10px 0 0", fontSize: "var(--m-type-section-heading-size)", lineHeight: "var(--m-type-section-heading-line-height)", fontWeight: 700, letterSpacing: "var(--m-type-section-heading-tracking)", color: M.raisin, wordBreak: "break-word" }}>
                {s(g, "supplierName") || "—"}
              </h1>
              <div style={{ ...T.meta, color: M.ink, marginTop: 4 }}>{s(g, "poNumber") ? `For ${s(g, "poNumber")}` : "No purchase order"}</div>
              {status !== "POSTED" && status !== "CANCELLED" && arrival !== "ARRIVED" ? (
                <Banner tone="info" icon={Ship} title={`${ARRIVAL_LABEL[arrival] ?? arrival}.`}>
                  Post to Stock unlocks once the goods are marked arrived — use the button below, one step at a time.
                </Banner>
              ) : null}
              {status === "CANCELLED" && s(g, "cancelled_reason") ? (
                <Banner tone="danger" icon={Ban} title="Cancelled.">
                  {s(g, "cancelled_reason")}
                </Banner>
              ) : null}
            </section>

            <Surface ariaLabel="Receipt overview" radius={20} shadow={SHADOW_SECTION} style={{ marginTop: 16, padding: "16px 16px 14px" }}>
              <TotalBlock k="RECEIVED VALUE" v={money(n(g, "totalAmount"))} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 16px" }}>
                <Fact k="Receive date" v={fmtDate(dateOnly(s(g, "receiveDate")))} />
                <Fact k="Received by" v={s(g, "receivedBy")} />
                <Fact k="Supplier DO No." v={s(g, "supplier_do_no", "supplierDoNo")} />
                <Fact k="QC status" v={QC_LABEL[s(g, "qcStatus")] ?? s(g, "qcStatus")} />
              </div>
              <div style={{ height: 1, background: DL.track, margin: "16px -16px 14px" }} />
              {status === "CANCELLED" ? (
                <OffFlow>Cancelled — this receipt no longer counts toward stock or the purchase order.</OffFlow>
              ) : (
                <Timeline label="Status timeline" steps={flowSteps(GRN_FLOW, status)} />
              )}
            </Surface>

            <SectionTitle icon={Package} title="Received lines" summary={`${rows(g.items).length} line${rows(g.items).length === 1 ? "" : "s"}`} />
            <div style={{ display: "grid", gap: 10 }}>
              {rows(g.items).map((it, i) => {
                const full = n(it, "receivedQty") >= n(it, "orderedQty");
                const rej = n(it, "rejectedQty");
                return (
                  <LineCard
                    key={s(it, "id") || i}
                    name={s(it, "materialName")}
                    code={s(it, "materialCode")}
                    spec={[`Ordered ${n(it, "orderedQty")}`, `${money(n(it, "unitPrice"))} / unit`, rej ? `Rejected ${rej}` : "", n(it, "invoicedQty") ? `Invoiced ${n(it, "invoicedQty")}` : ""].filter(Boolean).join(" · ")}
                    right={String(n(it, "receivedQty"))}
                    rightSub={money(n(it, "acceptedQty") * n(it, "unitPrice"))}
                    tag={full ? { label: "Full", tone: "success" } : { label: "Partial", tone: "warning" }}
                  />
                );
              })}
            </div>

            <KvSection icon={Ship} title="Shipment" note={shipment.length ? "Edited on desktop." : "No shipment details."} rowsList={shipment} />
            {lc ? (
              <KvSection
                icon={Coins}
                title="Landed cost"
                badge={lc.shippingSen || lc.dutySen ? null : { label: "Not entered", tone: "neutral" }}
                rowsList={[
                  { k: "Product total", v: money(lc.productSen) },
                  { k: "Shipping cost", v: money(lc.shippingSen) },
                  { k: "Customs duty", v: money(lc.dutySen) },
                  { k: "Currency", v: lc.currency === "MYR" ? "MYR" : `${lc.currency} · rate ${lc.rate || "—"}` },
                  { k: "Total landed cost (MYR)", v: money(lc.totalSen), bold: true },
                ]}
              />
            ) : null}

            <Surface ariaLabel="Document lineage" style={{ marginTop: 26, padding: "14px 15px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Files size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
                <span style={{ ...T.cardTitle, color: M.raisin }}>Document lineage</span>
              </div>
              {(() => {
                const nodes: ChainNode[] = [
                  s(g, "poId")
                    ? { label: "Purchase Order", doc: s(g, "poNumber") || "Purchase Order", sub: "Source order", state: "linked", onClick: () => open(s(g, "poId")) }
                    : { label: "Purchase Order", doc: "None", sub: "Received without a PO", state: "pending" },
                  { label: "Goods Receipt", doc: s(g, "grnNumber"), sub: "This receipt", state: "current" },
                  ...(invoices.length
                    ? invoices.map<ChainNode>((p) => ({ label: "Purchase Invoice", doc: s(p, "piNo"), sub: statusOf("pi", s(p, "status")).label, state: "linked", onClick: () => open(s(p, "id")) }))
                    : [{ label: "Purchase Invoice", doc: "Not created", sub: status === "POSTED" ? "Create from this GRN" : "Created once posted", state: "pending" as const }]),
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
            {s(g, "notes") ? (
              <Surface style={{ marginTop: 12, padding: "13px 15px" }} radius={16}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>NOTES</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: M.raisin, marginTop: 5, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{s(g, "notes")}</div>
              </Surface>
            ) : null}
            {primary || advPrimary ? <div aria-hidden style={{ height: 84 }} /> : null}
          </DetailColumn>

          {advPrimary && adv ? (
            <BottomDock variant="detail" scope={dockScope}>
              <PrimaryButton icon={Ship} iconSize={17} onClick={() => void advance()} disabled={busy} style={{ flex: 1.4 }}>
                {busy ? "Working…" : adv.label}
              </PrimaryButton>
            </BottomDock>
          ) : primary ? (
            <BottomDock variant="detail" scope={dockScope}>
              <PrimaryButton icon={ICON[primary]} iconSize={17} onClick={() => void run(primary)} disabled={busy || (primary === "POST" && acts.postBlocked)} style={{ flex: 1.4 }}>
                {busy ? "Working…" : primary === "POST" && acts.postBlocked ? "Post to Stock — not arrived" : LABEL[primary]}
              </PrimaryButton>
            </BottomDock>
          ) : null}

          <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
            <MenuGroup>
              {advInMenu && adv ? <MenuRow icon={Ship} label={adv.label} first onClick={() => void advance()} /> : null}
              {qtyInMenu ? (
                <MenuRow icon={Pencil} label={qtyState.ok ? "Edit Quantities" : "Edit Quantities (unavailable)"} first={!advInMenu} onClick={() => { if (qtyState.ok) openQtyEdit(); else { setMoreOpen(false); toast.show(qtyState.reason, "error"); } }} />
              ) : null}
              {menu.map((k, i) => (
                <MenuRow key={k} icon={ICON[k]} label={LABEL[k]} first={i === 0 && !advInMenu && !qtyInMenu} danger={k === "CANCEL"} onClick={() => void run(k)} />
              ))}
            </MenuGroup>
            <div style={{ height: 16 }} />
          </Sheet>

          <Sheet open={qtyOpen} onClose={busy ? () => undefined : () => setQtyOpen(false)} title="Edit Quantities">
            <SheetSub>{`${s(g, "grnNumber")} · accepted quantity per line`}</SheetSub>
            {s(g, "status") === "POSTED" ? <div role="note" style={{ margin: "8px 0", fontSize: 12.5, color: M.ink }}>Editing a posted receipt adjusts stock and writes a cost-ledger correction.</div> : null}
            {grnQtyLines(g).map((l, i) => (
              <label key={i} style={{ display: "block", marginTop: 12 }}>
                <FieldLabel>{`${l.ref} — received ${n(rows(g.items)[i] ?? {}, "receivedQty")}${l.locked ? ` · locked, ${l.invoiced} invoiced` : ""}`}</FieldLabel>
                <input className="dl-input" type="text" inputMode="decimal" disabled={l.locked} value={l.locked ? String(l.oldAccepted) : qtyVals[i] ?? ""} onChange={(e) => { const v = e.target.value; setQtyErr(null); setQtyVals((p) => p.map((x, j) => (j === i ? v : x))); }} aria-label={`Line ${i + 1} accepted quantity`} style={INPUT} />
              </label>
            ))}
            {qtyErr ? <div role="alert" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--dl-sem-danger)" }}>{qtyErr}</div> : null}
            <SheetFooter onCancel={() => setQtyOpen(false)} confirmLabel="Save quantities" busy={busy} onConfirm={() => void saveQty()} />
          </Sheet>

          {sourceFiles.length ? (
            <a
              href={`/api/files/${encodeURIComponent(s(sourceFiles[0], "id"))}/download?inline=1`}
              target="_blank"
              rel="noreferrer"
              aria-label="View the scanned source document"
              style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 16px 0", padding: "12px 14px", borderRadius: 14, backgroundColor: M.card, boxShadow: SHADOW_SECTION, color: M.raisin, textDecoration: "none" }}
            >
              <FileText size={17} strokeWidth={1.9} color={M.taupe} aria-hidden />
              <span style={{ flex: 1, ...T.cardTitle }}>Source document</span>
              <span style={{ ...T.meta, color: M.taupe }}>View</span>
            </a>
          ) : null}

          <PiForm
            open={piOpen}
            source={{ kind: "grn", doc: g }}
            onClose={() => setPiOpen(false)}
            onDone={(msg, newId) => {
              setPiOpen(false);
              refreshProcurementCaches();
              refresh();
              toast.show(msg, "success");
              if (newId) open(newId);
            }}
          />
        </>
      ) : null}
      {confirmSheet.node}
      {toast.node}
    </DetailFrame>
  );
}
