// Home Operations v3 · Overview: Overdue production orders and Due within 3 days. Data and rules: desktop
// dashboards/OverdueOrdersList.tsx and OverdueCards.tsx (DueSoonWorklist), both reading the shared dashboard feed
// (`production.orders`, `production.dueSoon3Days`). Three preview cards each; "View all" opens the full-page worklist.
import { useMemo, useState } from "react";
import { CalendarClock, CalendarX, TriangleAlert } from "lucide-react";
import { M } from "../../theme";
import type { OpsData } from "./ops-data";
import { DUE_LANES, deptChips, dueSorted, filterOrders, n0, overdueSplit, staleCount } from "./ops-lib";
import { C } from "./ops-style";
import { StatusBlock } from "./ops-ui";
import { OChipScroll, OGCard, PillButton } from "./ops-glass";
import { panelStyle } from "./ops-glass-style";
import { GSwitch } from "./sales-glass";
import { OpenError, OrderCard } from "./ops-orders";
import { duePillOf, latePill, useOpenOrder } from "./use-open-order";
import { OpsWorklistPage } from "./OpsWorklistPage";
import { useWorklistPage } from "./worklist-state";
import { TNUM } from "./home-style";

const OD_ROWS = 3;
/** Shown only when the dashboard feed says this section is not live (the design itself carries no tag). */
const NotLiveTag = () => <span title="The dashboard feed did not refresh this section live" style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, background: "#FBF3E2", color: "#9A7B2E", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>not live</span>;

export function OverdueCard({ d }: { d: OpsData }) {
  const [kind, setKind] = useState<"live" | "done">("live");
  const [dept, setDept] = useState("ALL");
  const page = useWorklistPage();
  const ord = useOpenOrder();
  const { status, reason } = d.production;
  const orders = useMemo(() => d.feed?.production?.orders ?? [], [d.feed]);
  const split = useMemo(() => overdueSplit(orders), [orders]);
  const list = kind === "live" ? split.live : split.done;
  const chips = useMemo(() => deptChips(list), [list]);
  const rows = useMemo(() => filterOrders(list, dept, ""), [list, dept]);
  const stale = staleCount(list);
  const notLive = status === "ready" && d.feed?.availability?.production?.live === false;
  const count = split.live.length;

  return (
    <>
      <OGCard icon={CalendarX} label="Overdue production orders" id="ops-overdue"
        title={<>Overdue production orders{status === "ready" ? <span style={{ color: C.danger, ...TNUM }}> · {n0(count)}</span> : null}</>}
        sub="Past the customer’s delivery date · most late first"
        right={notLive ? <NotLiveTag /> : undefined}>
        {status !== "ready" ? (
          <StatusBlock status={status} what="Overdue production orders" need="production-orders access" reason={reason} onRetry={d.retryFeed} />
        ) : (
          <>
            {kind === "live" && stale > 0 ? (
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 10, fontSize: 12, lineHeight: 1.5, color: C.warn }}>
                <span style={{ flex: "none", display: "flex", height: 18, alignItems: "center" }}><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" /></span>
                <span>{stale} over 60 days late — likely shipped but never scanned out, please check</span>
              </div>
            ) : null}
            <GSwitch aria="Order state" value={kind} onChange={(k) => { setKind(k); setDept("ALL"); }} options={[["live", `In production · ${n0(split.live.length)}`], ["done", `Finished, not closed · ${n0(split.done.length)}`]]} />
            <OChipScroll aria="Waiting at department" value={dept} onChange={setDept} options={[{ key: "ALL", label: `All · ${n0(list.length)}` }, ...chips.map((c) => ({ key: c.key, label: `${c.label} · ${n0(c.n)}` }))]} />
            {rows.length === 0 ? <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>{dept !== "ALL" ? "Nothing matches this filter." : "Nothing overdue here."}</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10, marginTop: 10 }}>
              {rows.slice(0, OD_ROWS).map((o, i) => <OrderCard key={`${o.poNo}-${i}`} o={o} pill={latePill(o)} ord={ord} />)}
            </div>
            <OpenError msg={ord.err} />
            {list.length > 0 ? <PillButton label={`View all ${n0(list.length)}`} chevron="right" onClick={() => page.open({ kind: "od", state: kind })} /> : null}
          </>
        )}
      </OGCard>
      {page.target?.kind === "od" ? <OpsWorklistPage target={page.target} orders={orders} dueSoon={d.feed?.production?.dueSoon3Days ?? []} onClose={page.close} /> : null}
    </>
  );
}

export function DueSoonCard({ d }: { d: OpsData }) {
  const page = useWorklistPage();
  const ord = useOpenOrder();
  const { status, reason } = d.production;
  const orders = useMemo(() => dueSorted(d.feed?.production?.dueSoon3Days ?? []), [d.feed]);
  const notLive = status === "ready" && d.feed?.availability?.production?.live === false;

  return (
    <>
      <OGCard icon={CalendarClock} label="Due within 3 days" id="ops-due-soon"
        title={<>Due within 3 days{status === "ready" ? <span style={{ color: C.warn, ...TNUM }}> · {n0(orders.length)}</span> : null}</>}
        sub="Early warning · by customer delivery date"
        right={notLive ? <NotLiveTag /> : undefined}>
        {status !== "ready" ? (
          <StatusBlock status={status} what="Due within 3 days" need="production-orders access" reason={reason} onRetry={d.retryFeed} />
        ) : orders.length === 0 ? (
          <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>Nothing due in the next 3 days.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
              {DUE_LANES.map((l) => {
                const n = orders.filter((o) => o.daysToDD === l.d).length;
                return (
                  <button key={l.d} type="button" aria-label={`${l.label}: ${n}`} onClick={() => page.open({ kind: "ds", lane: l.d })}
                    style={{ minWidth: 0, padding: "8px 8px 7px", border: "none", borderRadius: 12, ...panelStyle(), boxShadow: `inset 0 2px 0 ${l.urgent ? C.danger : C.warn}, inset 0 0 0 1px rgba(31,29,27,.05)`, fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    <div style={{ fontSize: 17, lineHeight: "20px", fontWeight: 800, color: n ? M.raisin : "#B5AC9C", ...TNUM }}>{n}</div>
                    <div style={{ fontSize: 10.5, color: M.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.label}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10, marginTop: 10 }}>
              {orders.slice(0, 3).map((o, i) => <OrderCard key={`${o.poNo}-${i}`} o={o} pill={duePillOf(o)} ord={ord} />)}
            </div>
            <OpenError msg={ord.err} />
            <PillButton label={`View all ${n0(orders.length)}`} chevron="right" onClick={() => page.open({ kind: "ds", lane: null })} />
          </>
        )}
      </OGCard>
      {page.target?.kind === "ds" ? <OpsWorklistPage target={page.target} orders={d.feed?.production?.orders ?? []} dueSoon={orders} onClose={page.close} /> : null}
    </>
  );
}
