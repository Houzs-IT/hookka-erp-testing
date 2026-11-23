// OpsWorklistPage — the full-screen "View all" page of Overdue production orders and Due within 3 days (Home Operations v3).
// Every order is the same table card as on the Overview (Customer / Product / Waiting at / Stages done, then "Open PO") and opens
// its production order the same way (use-open-order.ts). Filters: search, the In production / Finished switch (Overdue) or the
// lane tiles (Due soon). Rendered through a portal into <body>: the Overview cards are glass (backdrop-filter), which would trap a
// fixed layer inside the card. Back (the header button, Escape or the phone's own Back, see worklist-state.ts) returns to the Overview.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Search, X } from "lucide-react";
import { M } from "../../theme";
import { TNUM } from "./home-style";
import { DUE_LANES, dueSorted, filterOrders, n0, overdueSplit, type ProdOrder } from "./ops-lib";
import { C } from "./ops-style";
import { GSwitch } from "./sales-glass";
import { OpenError, OrderCard } from "./ops-orders";
import { duePillOf, latePill, useOpenOrder } from "./use-open-order";
import { panelStyle } from "./ops-glass-style";
import type { WorklistTarget } from "./worklist-state";

const BG = `radial-gradient(120% 50% at 100% 0%,rgba(201,169,97,.16),rgba(201,169,97,0) 60%), linear-gradient(180deg,color-mix(in srgb, ${M.paper} 96%, #F6F1E8),${M.paper})`;

export function OpsWorklistPage({ target, orders, dueSoon, onClose }: { target: WorklistTarget; orders: ProdOrder[]; dueSoon: ProdOrder[]; onClose: () => void }) {
  const isOd = target.kind === "od";
  const [state, setState] = useState<"live" | "done">(target.state ?? "live");
  const [lane, setLane] = useState<number | null>(target.lane ?? null);
  const [q, setQ] = useState("");
  const ord = useOpenOrder();
  const split = useMemo(() => overdueSplit(orders), [orders]);
  const due = useMemo(() => dueSorted(dueSoon), [dueSoon]);
  const base = isOd ? (state === "live" ? split.live : split.done) : due;
  const byText = useMemo(() => filterOrders(base, "ALL", q), [base, q]);
  const rows = !isOd && lane != null ? byText.filter((o) => o.daysToDD === lane) : byText;
  const filtered = !!q || lane != null;
  const title = isOd ? "Overdue production orders" : "Due within 3 days";

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Due soon is grouped by lane (today first); the overdue list is one group, most late first.
  const groups: { head: string; color: string; rows: ProdOrder[] }[] = isOd
    ? rows.length ? [{ head: "", color: "", rows }] : []
    : DUE_LANES.map((l) => ({ head: `${l.label} · ${rows.filter((o) => o.daysToDD === l.d).length}`, color: l.urgent ? C.danger : C.warn, rows: rows.filter((o) => o.daysToDD === l.d) })).filter((g) => g.rows.length);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 200, background: BG, color: M.raisin, display: "flex", flexDirection: "column", fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" }}>
      <div style={{ flex: "none", height: "env(safe-area-inset-top, 0px)" }} />
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "4px 14px 6px 6px", width: "100%", maxWidth: 820, margin: "0 auto", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={24} strokeWidth={1.9} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title} <span style={{ color: isOd ? C.danger : C.warn, ...TNUM }}>· {n0(rows.length)}</span></div>
          <div style={{ fontSize: 12, color: M.ink }}>{isOd ? "Past the customer’s delivery date · most late first" : "Early warning · by customer delivery date"}</div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px calc(110px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ width: "100%", maxWidth: 820, margin: "0 auto" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, height: 42, padding: "0 12px", borderRadius: 16, background: `color-mix(in srgb, ${M.card} 78%, transparent)`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 10px 22px -16px rgba(107,92,50,.35)` }}>
            <Search size={16} strokeWidth={2} color={M.muted} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO, customer, product" aria-label="Search" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 15, color: M.raisin }} />
            {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 28, height: 28, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.muted }}><X size={15} strokeWidth={2} /></button> : null}
          </label>
          {filtered ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" onClick={() => { setQ(""); setLane(null); }} style={{ height: 28, padding: "0 4px", border: "none", background: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: M.taupe, cursor: "pointer" }}>Reset filters</button>
            </div>
          ) : null}
          {isOd ? (
            <div style={{ marginTop: 10 }}>
              <GSwitch aria="Order state" value={state} onChange={setState} options={[["live", `In production · ${n0(split.live.length)}`], ["done", `Finished, not closed · ${n0(split.done.length)}`]]} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6, marginTop: 10 }}>
              {DUE_LANES.map((l) => {
                const n = byText.filter((o) => o.daysToDD === l.d).length;
                const on = lane === l.d;
                return (
                  <button key={l.d} type="button" aria-pressed={on} onClick={() => setLane(on ? null : l.d)}
                    style={{ minWidth: 0, padding: "8px 8px 7px", border: "none", borderRadius: 12, background: on ? M.card : `color-mix(in srgb, ${M.card} 70%, transparent)`, boxShadow: `inset 0 2px 0 ${l.urgent ? C.danger : C.warn}, ${on ? `inset 0 0 0 1.5px ${M.taupe}` : "inset 0 0 0 1px rgba(31,29,27,.05)"}`, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                    <span style={{ display: "block", fontSize: 17, lineHeight: "20px", fontWeight: 800, color: M.raisin, ...TNUM }}>{n}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: M.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <OpenError msg={ord.err} />
          {groups.length === 0 ? (
            <div role="status" style={{ ...panelStyle({ padding: "26px 16px" }), marginTop: 12, textAlign: "center", fontSize: 13, color: M.muted }}>{filtered ? "Nothing matches this filter." : isOd ? "Nothing overdue here." : "Nothing due in the next 3 days."}</div>
          ) : null}
          {groups.map((g, gi) => (
            <div key={g.head || gi} style={{ marginTop: 14 }}>
              {g.head ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 8px" }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: g.color }} />
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, color: M.raisin }}>{g.head}</span>
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
                {g.rows.map((o, i) => <OrderCard key={`${o.poNo}-${i}`} o={o} pill={isOd ? latePill(o) : duePillOf(o)} ord={ord} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
