// ===========================================================================
// RelationshipMap — phone/tablet version of src/components/ui/document-chain-map.tsx
// (same data, same states, same station roll-up), laid out as in the Phase 4 prototype:
// a vertical five-step chain with a status rail, collapsible production-order cards
// (progress bar + "n/m departments") and department tiles.
//
// Data: ONE read, GET /api/sales-orders/:anchorId (order + linkedPOs / linkedDOs /
// linkedInvoices / linkedPayments); each production order reads GET /api/production-orders/:id
// for its job cards and uses the desktop's groupJobCardsByDept — nothing is re-derived here.
//
// Five steps: Customer PO → Sales Order → Delivery Order → Sales Invoice → Payment.
// Teal = exists, brown = in progress, dashed = not yet (with the reason). A step with
// nothing to open explains itself inline instead of desktop's window.alert.
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, Info, Truck, User } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { groupJobCardsByDept, prettyDept, type JobCard, type NodeState, type Station } from "@/lib/job-card-stations";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { M } from "../../theme";
import { CC, SH_CARD } from "./case-style";
import { tc } from "./case-model";
import { Card } from "./case-ui";

type LinkedPO = {
  id: string;
  poNo: string;
  productName?: string;
  quantity?: number;
  status?: string;
  progress?: number;
  currentDepartment?: string;
  completedDate?: string | null;
  completedBy?: string | null;
  deliveryDoNo?: string;
};
type ChainResp = {
  success?: boolean;
  data?: { id: string; companySOId?: string; status?: string; customerPOId?: string };
  linkedPOs?: LinkedPO[];
  linkedDOs?: { id: string; doNo: string; status: string; driverName?: string | null }[];
  linkedInvoices?: { id: string; invoiceNo: string; status: string }[];
  linkedPayments?: { id: string; receiptNumber: string; status: string }[];
};

const TEAL = CC.linked;
const S: Record<NodeState, { dot: string; label: string; line: string; tileBg: string; tileBd: string }> = {
  linked: { dot: TEAL, label: TEAL, line: CC.linkedLine, tileBg: "#EEF5F2", tileBd: "1px solid #C9E0D8" },
  current: { dot: CC.brown, label: CC.brown, line: "#E6E0D9", tileBg: "#FBF7EE", tileBd: "1px solid #E3D3A8" },
  pending: { dot: "#fff", label: M.ink, line: "#E6E0D9", tileBg: "#FAF8F4", tileBd: "1px dashed #D9D2C6" },
};

type MapNode = { kind: string; label: string; docNo?: string | null; sub?: string | null; state: NodeState; href?: string | null; why?: string | null };

/** Status dot: filled teal + check (linked), filled brown + inner dot (current), dashed ring (pending). */
function Dot({ state, size = 22 }: { state: NodeState; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, flex: "none", boxSizing: "border-box", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", background: state === "pending" ? "#fff" : S[state].dot, border: state === "pending" ? "1.5px dashed #A8A196" : "none" }}>
      {state === "linked" ? <Check size={Math.round(size * 0.55)} strokeWidth={3} /> : null}
      {state === "current" ? <span style={{ width: "40%", height: "40%", borderRadius: "50%", background: "#fff" }} /> : null}
    </span>
  );
}

export function RelationshipMap({ anchorId, anchorIsSv = true }: { anchorId: string; anchorIsSv?: boolean }) {
  const navigate = useNavigate();
  const { mode } = useResponsiveLayout();
  const tablet = mode !== "phone";
  const { data, loading, failure } = useCachedJson<ChainResp>(anchorId ? `/api/sales-orders/${encodeURIComponent(anchorId)}` : null);
  const [openPOs, setOpenPOs] = useState<Record<string, boolean>>({});
  const [openWhy, setOpenWhy] = useState<string | null>(null);

  const chain = useMemo(() => {
    if (!data?.success || !data.data) return null;
    const so = data.data;
    const dos = data.linkedDOs ?? [];
    const invs = data.linkedInvoices ?? [];
    const pays = data.linkedPayments ?? [];
    const nodes: MapNode[] = [
      {
        kind: "CPO",
        label: "Customer PO",
        docNo: so.customerPOId || null,
        sub: so.customerPOId ? "From the customer" : "No reference recorded",
        state: so.customerPOId ? "linked" : "pending",
        why: so.customerPOId
          ? `${so.customerPOId} is the customer’s own reference for this order. It is their document, not ours, so there is no file here to open.`
          : "No customer PO reference was recorded on this order.",
      },
      { kind: "SO", label: anchorIsSv ? "Service order (SV)" : "Sales order", docNo: so.companySOId ?? "", sub: so.status ? tc(so.status) : null, state: "linked", href: `/m/sales/${encodeURIComponent(so.id)}` },
      {
        kind: "DO",
        label: "Delivery order",
        docNo: dos[0]?.doNo ?? null,
        sub: dos[0] ? [dos[0].status, dos[0].driverName].filter(Boolean).join(" · ") : "After confirmation",
        why: dos[0] ? null : "No delivery order yet. One is created once this sales order is confirmed and the goods are ready to ship.",
        state: dos[0] ? "linked" : "pending",
        href: dos[0] ? `/m/delivery/${encodeURIComponent(dos[0].id)}` : null,
      },
      {
        kind: "INV",
        label: "Sales invoice",
        docNo: invs[0]?.invoiceNo ?? null,
        sub: invs[0] ? invs[0].status : "On delivery",
        why: invs[0] ? null : "No invoice yet. One is raised from the delivery order once the goods have gone out.",
        state: invs[0] ? "linked" : "pending",
        href: invs[0] ? `/m/invoices/${encodeURIComponent(invs[0].id)}` : null,
      },
      {
        kind: "PAY",
        label: "Payment",
        docNo: pays[0]?.receiptNumber ?? null,
        sub: pays[0] ? pays[0].status : "On settlement",
        why: pays[0] ? "Payments are shown for reference; there is no separate payment page to open." : "No payment recorded yet. Payments appear here once they are allocated against this order’s invoice.",
        state: pays[0] ? "linked" : "pending",
      },
    ];
    return { nodes, pos: data.linkedPOs ?? [], extraDOs: dos.slice(1) };
  }, [data, anchorIsSv]);

  if (!anchorId) return null;
  if (!chain) {
    return (
      <Card>
        <div style={{ fontSize: 13, color: failure ? CC.danger : M.ink }}>
          {failure ? `Couldn’t load the relationship map — ${failure.message}` : loading ? "Loading relationship map…" : "No relationship map available."}
        </div>
      </Card>
    );
  }

  const isOpen = (id: string) => openPOs[id] ?? tablet;
  const anyClosed = chain.pos.some((p) => !isOpen(p.id));

  return (
    <div>
      <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "12px 15px 6px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>SALES CHAIN</span>
          <span style={{ fontSize: 11, color: CC.hint, whiteSpace: "nowrap" }}>{anchorIsSv ? "Anchor: first SV order" : "Anchor: source sales order"}</span>
        </div>
        <ol aria-label="Sales chain" style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
          {chain.nodes.map((n, i) => {
            const last = i === chain.nodes.length - 1;
            const tappable = !!n.href || !!n.why;
            const showWhy = openWhy === n.kind && !!n.why;
            return (
              <li key={n.kind} style={{ position: "relative" }}>
                {!last ? <span aria-hidden style={{ position: "absolute", left: 10, top: 34, bottom: -4, width: 2, borderRadius: 2, background: S[n.state].line }} /> : null}
                <button
                  type="button"
                  disabled={!tappable}
                  aria-label={`${n.label}: ${n.docNo || "Not created"}`}
                  onClick={() => (n.href ? navigate(n.href) : setOpenWhy(showWhy ? null : n.kind))}
                  style={{ position: "relative", width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "6px 0", background: "none", border: "none", fontFamily: "inherit", textAlign: "left", cursor: tappable ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}
                >
                  <Dot state={n.state} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: S[n.state].label }}>{n.label}</span>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: n.docNo ? M.raisin : M.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{n.docNo || "Not created"}</span>
                    {n.sub ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.sub}</span> : null}
                  </span>
                  {n.href ? <ChevronRight size={16} strokeWidth={2} color={CC.brownSoft} /> : n.why ? <Info size={16} strokeWidth={2} color={CC.brownSoft} /> : null}
                </button>
                {showWhy ? <div role="note" style={{ margin: "0 0 8px 34px", padding: "8px 10px", borderRadius: 10, background: CC.tile, fontSize: 12.5, color: M.ink, lineHeight: 1.45 }}>{n.why}</div> : null}
              </li>
            );
          })}
        </ol>
        {chain.extraDOs.length > 0 ? (
          <div style={{ display: "grid", gap: 6, margin: "2px 0 8px 34px", gridTemplateColumns: "minmax(0,1fr)" }}>
            {chain.extraDOs.map((d) => (
              <button key={d.id} type="button" onClick={() => navigate(`/m/delivery/${encodeURIComponent(d.id)}`)} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36, padding: "0 10px", border: "none", borderRadius: 10, background: M.paper, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                <Truck size={14} strokeWidth={2} color={CC.brown} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><b>{d.doNo}</b> · {[d.status, d.driverName].filter(Boolean).join(" · ")}</span>
                <ChevronRight size={14} strokeWidth={2} color={CC.brownSoft} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, margin: "16px 2px 8px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1px", color: CC.brown }}>PRODUCTION — {chain.pos.length} ORDER{chain.pos.length === 1 ? "" : "S"}</span>
        {chain.pos.length > 0 ? (
          <button type="button" onClick={() => setOpenPOs(Object.fromEntries(chain.pos.map((p) => [p.id, anyClosed])))} style={{ height: 28, padding: 0, border: "none", background: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: CC.brown, cursor: "pointer" }}>
            {anyClosed ? "Expand all" : "Collapse all"}
          </button>
        ) : null}
      </div>
      {chain.pos.length === 0 ? (
        <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px", fontSize: 12.5, color: M.ink }}>No production orders yet. They are created when the sales order is confirmed.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
          {chain.pos.map((po) => (
            <PoCard key={po.id} po={po} open={isOpen(po.id)} tablet={tablet} onToggle={() => setOpenPOs((p) => ({ ...p, [po.id]: !isOpen(po.id) }))} onOpen={() => navigate(`/m/production/${encodeURIComponent(po.id)}`)} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "10px 2px 0", fontSize: 11.5, color: M.ink }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: TEAL }} />Linked</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: CC.brown }} />Current / in progress</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, boxSizing: "border-box", borderRadius: "50%", border: "1.5px dashed #A8A196" }} />Not created yet</span>
      </div>
    </div>
  );
}

function PoCard({ po, open, tablet, onToggle, onOpen }: { po: LinkedPO; open: boolean; tablet: boolean; onToggle: () => void; onOpen: () => void }) {
  // Job cards drive the "n/m departments" bar (desktop reads them too, only when expanded;
  // the prototype shows the bar while collapsed, so they are read here — cached, one per order).
  const { data, loading, failure } = useCachedJson<{ success?: boolean; data?: { jobCards?: JobCard[] } }>(`/api/production-orders/${encodeURIComponent(po.id)}`);
  const stations = useMemo<Station[]>(() => groupJobCardsByDept(data?.data?.jobCards ?? []), [data]);
  const done = (po.status ?? "").toUpperCase() === "COMPLETED";
  const state: NodeState = done ? "linked" : (po.progress ?? 0) > 0 ? "current" : "pending";
  const doneN = stations.filter((s) => s.state === "linked").length;
  const pct = stations.length ? Math.round((doneN / stations.length) * 100) : Math.max(0, Math.min(100, Math.round(po.progress ?? 0)));
  const where = done ? (po.completedDate ? `Completed ${po.completedDate}` : "Completed") : po.currentDepartment ? `At ${prettyDept(po.currentDepartment)}` : "Not started";
  const cols = tablet ? "repeat(4,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))";
  return (
    <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: state === "linked" ? SH_CARD : "0 0 0 1px #E3D3A8,0 12px 28px -16px rgba(31,29,27,.22)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", border: "none", background: state === "linked" ? M.card : "#FBF7EE", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        <span style={{ display: "flex", marginTop: 2 }}><Dot state={state} size={18} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{po.poNo}</span>
            <span style={{ flex: 1 }} />
            <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: state === "linked" ? TEAL : state === "current" ? CC.brown : M.ink, whiteSpace: "nowrap" }}>{where}</span>
          </span>
          <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{po.productName}{po.quantity ? ` × ${po.quantity}` : ""}</span>
          {po.completedBy ? (
            <span style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11.5, color: M.ink, marginTop: 4 }}>
              <User size={12} strokeWidth={2} color={CC.brownSoft} style={{ marginTop: 1, flex: "none" }} />
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{po.completedBy}</span>
            </span>
          ) : null}
          <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
            <span aria-hidden style={{ flex: 1, height: 5, borderRadius: 999, background: CC.trackMap, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: done ? TEAL : CC.brown }} />
            </span>
            <span style={{ flex: "none", fontSize: 11, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
              {stations.length ? `${doneN}/${stations.length} departments` : loading ? "Loading…" : failure ? "Job cards unavailable" : `${pct}%`}
            </span>
          </span>
          {po.deliveryDoNo ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: M.ink, marginTop: 5 }}><Truck size={12} strokeWidth={2} color={CC.brown} />{po.deliveryDoNo}</span> : null}
        </span>
        <span style={{ display: "flex", marginTop: 1, transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}><ChevronDown size={18} strokeWidth={2} color={CC.brownSoft} /></span>
      </button>
      {open ? (
        stations.length === 0 ? (
          <div style={{ padding: "0 14px 12px", fontSize: 12, color: failure ? CC.danger : CC.hint }}>
            {failure ? `Couldn’t load this production order’s job cards — ${failure.message}` : loading ? "Loading job cards…" : "No job cards on this production order yet."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "0 12px 12px" }}>
            {stations.map((s) => <StationTile key={s.code} s={s} onOpen={onOpen} />)}
          </div>
        )
      ) : null}
    </div>
  );
}

function StationTile({ s, onOpen }: { s: Station; onOpen: () => void }) {
  const c = S[s.state];
  const who = s.who.join(", ");
  const over = s.state === "linked" && s.estMinutes > 0 && s.actualMinutes > s.estMinutes;
  return (
    <button type="button" onClick={onOpen} title={`${s.name} — ${s.done}/${s.total} job card(s) done`} style={{ minWidth: 0, display: "block", padding: "10px 10px 9px", border: c.tileBd, borderRadius: 12, background: c.tileBg, fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Dot state={s.state} size={14} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: s.state === "pending" ? M.ink : M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
        <span style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, background: "#fff", boxShadow: "inset 0 0 0 1px #E2DDD8", fontSize: 10.5, fontWeight: 700, color: M.ink, fontVariantNumeric: "tabular-nums" }}>{s.done}/{s.total}</span>
      </span>
      <span style={{ display: "block", fontSize: 11, color: M.ink, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
        {s.state === "linked" ? s.completedDate || "done" : s.state === "current" ? "in progress" : "waiting"}
      </span>
      {who ? <span style={{ display: "block", fontSize: 11, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{who}</span> : null}
      {s.estMinutes > 0 ? (
        <span style={{ display: "block", fontSize: 11, fontWeight: over ? 700 : 400, color: over ? CC.danger : M.ink, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {s.actualMinutes > 0 ? `${s.actualMinutes}m` : "—"} / est {s.estMinutes}m{over ? " ⚠" : ""}
        </span>
      ) : null}
    </button>
  );
}

