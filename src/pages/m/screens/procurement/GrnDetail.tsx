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
import { Ban, Coins, Download, Files, Package, Receipt, Ship, Warehouse, type LucideIcon } from "lucide-react";
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
import { BottomDock, PrimaryButton, Surface } from "../delivery/ui";
import { DL, SHADOW_SECTION, T } from "../delivery/ui-tokens";
import { useConfirmSheet, useMobileToast } from "../delivery/ui-hooks";
import { downloadGrnPdf, putGrn, refreshProcurementCaches, send } from "./actions";
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
      return toast.show(`${no} posted to stock`, "success");
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

  const status = g ? s(g, "status") : "";
  const st = statusOf("grn", status);
  const acts = g ? grnActions(g) : { primary: null, postBlocked: false, menu: [] as GrnActionKey[] };
  const primary = acts.primary && allowed(acts.primary) ? acts.primary : null;
  const menu = acts.menu.filter(allowed);
  const arrival = g ? arrivalOf(g) : "ARRIVED";
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
                  Post to Stock unlocks once the goods are marked arrived on desktop.
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
            {primary ? <div aria-hidden style={{ height: 84 }} /> : null}
          </DetailColumn>

          {primary ? (
            <BottomDock variant="detail" scope={dockScope}>
              <PrimaryButton icon={ICON[primary]} iconSize={17} onClick={() => void run(primary)} disabled={busy || (primary === "POST" && acts.postBlocked)} style={{ flex: 1.4 }}>
                {busy ? "Working…" : primary === "POST" && acts.postBlocked ? "Post to Stock — not arrived" : LABEL[primary]}
              </PrimaryButton>
            </BottomDock>
          ) : null}

          <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
            <MenuGroup>
              {menu.map((k, i) => (
                <MenuRow key={k} icon={ICON[k]} label={LABEL[k]} first={i === 0} danger={k === "CANCEL"} onClick={() => void run(k)} />
              ))}
            </MenuGroup>
            <div style={{ height: 16 }} />
          </Sheet>

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
