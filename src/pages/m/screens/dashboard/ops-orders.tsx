// Shared pieces of the Overdue production orders / Due within 3 days cards and their full-page worklists: the order card of
// the v3 design (the open-order hook and the pills are in use-open-order.ts). Rules: desktop dashboards/OverdueOrdersList.tsx and
// OverdueCards.tsx (the feed's `production.orders` / `dueSoon3Days`).
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { M } from "../../theme";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { TNUM } from "./home-style";
import { allStagesDone, deptKey, type ProdOrder } from "./ops-lib";
import { StageSteps } from "./ops-glass";
import { PILL } from "./ops-glass-style";
import type { OpenOrder, Pill } from "./use-open-order";

export function OpenError({ msg }: { msg: string | null }) {
  return msg ? <div role="alert" style={{ marginTop: 8, padding: "9px 11px", borderRadius: 12, backgroundColor: PILL.red.bg, color: PILL.red.fg, fontSize: 12, lineHeight: 1.45 }}>{msg}</div> : null;
}

const CARD_RING = `0 0 0 1px ${M.hairline}, 0 10px 22px -16px rgba(107,92,50,.40)`;
const KEY: CSSProperties = { padding: "7px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: M.taupe, background: M.paper, borderRight: `1px solid ${M.divider}` };

/** The v3 order card: PO + pill, a four-row table (Customer / Product / Waiting at / Stages done), "Open PO ›" footer. */
export function OrderCard({ o, pill, ord }: { o: ProdOrder; pill: Pill; ord: OpenOrder }) {
  const finished = allStagesDone(o);
  const stages = `${o.stagesDone} / ${o.stagesTotal}`;
  const where = finished ? "All stages done" : deptName(deptKey(o));
  const row = (k: string, v: ReactNode, first?: boolean, bold?: boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr)", borderTop: first ? "none" : `1px solid ${M.divider}` }}>
      <span style={KEY}>{k}</span>
      <span style={{ padding: "7px 10px", fontSize: 12.5, fontWeight: bold ? 700 : 600, color: M.raisin, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{o.poNo ?? "—"}</span>
        <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: pill.bg, color: pill.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{pill.label}</span>
      </div>
      <div style={{ margin: "0 12px", borderRadius: 10, overflow: "hidden", boxShadow: `inset 0 0 0 1px ${M.hairline}` }}>
        {row("Customer", o.customer ?? "—", true)}
        {row("Product", o.productName ?? "—")}
        {row("Waiting at", where, false, true)}
        <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr)", borderTop: `1px solid ${M.divider}` }}>
          <span style={KEY}>Stages done</span>
          <span style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
            <StageSteps done={o.stagesDone} total={o.stagesTotal} finished={finished} label={`${o.stagesDone} of ${o.stagesTotal} stages done${finished ? "" : `, waiting at ${deptName(deptKey(o))}`}`} />
            <span style={{ flex: "none", fontSize: 12.5, fontWeight: 700, color: M.raisin, ...TNUM }}>{stages}</span>
          </span>
        </div>
      </div>
      {ord.can ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 38, marginTop: 10, borderTop: `1px solid ${M.divider}`, fontSize: 12.5, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>
          <span>{ord.busy === o.poNo ? "Opening…" : `Open ${o.poNo ?? "order"}`}</span><ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
        </div>
      ) : <div style={{ height: 10 }} />}
    </>
  );
  const box: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", borderRadius: 16, background: M.card, boxShadow: CARD_RING, overflow: "hidden", color: "inherit", textAlign: "left", padding: 0, border: "none", fontFamily: "inherit" };
  return ord.can && o.poNo ? (
    <button type="button" onClick={() => void ord.open(o.poNo)} aria-busy={ord.busy === o.poNo || undefined} aria-label={`${o.poNo}, ${pill.label}. Open production order`} style={{ ...box, cursor: "pointer", opacity: ord.busy === o.poNo ? 0.6 : 1, WebkitTapHighlightColor: "transparent" }}>{body}</button>
  ) : <div style={box}>{body}</div>;
}
