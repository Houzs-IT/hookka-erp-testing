// Home Sales v12 · "Customer overdue sets" card + its two drill-downs (customer → orders sheet,
// order → item rows). Phone port of the desktop CustomerOverdueSetsCard: the SAME feed
// (/api/dashboard/prototype → sales.overdueSets, shared cache with the rest of the Home),
// the same types / production filter (src/api/lib/customer-overdue-sets.ts), the same stage
// order (orderStages), the same per-order progress source (/api/sales-orders/:id linkedPOs,
// still-to-dispatch lines only) and the same days-in-department rule (daysAtDept). Nothing is
// computed here that the desktop does not. Visual source: Home Sales v12.dc.html.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarX, ChevronRight, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayISO } from "@/pages/production/utils";
import { filterCustomersByProduction, PRODUCTION_FILTERS } from "@/api/lib/customer-overdue-sets";
import type { CustomerOverdueSets, OverdueSetsOrder, OverdueSetsSummary, ProductionFilter } from "@/api/lib/customer-overdue-sets";
import { fmtN } from "../../../dashboards/dashboard-shared-lib";
import { orderStages } from "../../../dashboards/ops-floor-lib";
import { PoCard } from "../ProductionScreen";
import { Sheet } from "../../components/Sheet";
import { M } from "../../theme";
import { DASHBOARD_FEED_URL } from "./types";
import { useDeptColors, DEPT_NEUTRAL } from "./dept-colors";
import { G, GHint, GPill, GPanel } from "./sales-glass";
import { TNUM } from "./home-style";

type Feed = {
  success?: boolean;
  availability?: { overdueSets?: { live: boolean; reason?: string } };
  sales?: { overdueSets?: OverdueSetsSummary | null };
};

type SoDetail = { success?: boolean; linkedPOs?: LineProgress[] };
type LineProgress = {
  companySOId?: string; targetEndDate?: string | null;
  id: string; poNo: string; productName: string; productCode: string; quantity: number; status: string; progress: number;
  currentDepartment: string; deliveryDoNo?: string; deliveryStatus?: string; startDate?: string | null;
  jobCards?: { departmentCode: string; status: string; completedDate: string | null }[];
};

const FILTER_LABEL: Record<ProductionFilter, string> = { all: "All", inProduction: "In production", productionComplete: "Complete" };
const FILTER_DOT: Record<ProductionFilter, string | null> = { all: null, inProduction: "#9C6F1E", productionComplete: "#4F7C3A" };
const DISPATCHED = new Set(["LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"]);
const isStillToDispatch = (l: LineProgress) => l.status !== "CANCELLED" && !DISPATCHED.has(l.deliveryStatus ?? "");
const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const ruleTop = (i: number) => (i ? `1px solid ${G.rule}` : "none");
const oldestLate = (c: CustomerOverdueSets) => c.orders.reduce((m, o) => Math.max(m, o.daysLate), 0);

const ORDERS_SHOWN = 5;

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function CustomerOverdueCard({ enabled }: { enabled: boolean }) {
  const { data, loading, error } = useCachedJson<Feed>(enabled ? DASHBOARD_FEED_URL : null);
  const summary = data?.sales?.overdueSets ?? null;
  const [filter, setFilter] = useState<ProductionFilter>("all");
  const [open, setOpen] = useState<string | null>(null); // customer key
  if (!enabled) return null;

  const keyOf = (c: CustomerOverdueSets) => c.customerId ?? c.customerName;
  const visible = summary ? filterCustomersByProduction(summary.customers, filter) : [];
  const openCustomer = open && summary ? visible.find((c) => keyOf(c) === open) ?? summary.customers.find((c) => keyOf(c) === open) ?? null : null;
  const unavailable = data?.availability?.overdueSets?.reason ?? error ?? undefined;

  let body: ReactNode;
  if (summary) {
    if (summary.customers.length === 0) {
      body = <Msg text="Nothing overdue. Every order past its delivery date has been fully delivered." />;
    } else {
      body = (
        <>
          <div role="group" aria-label="Production state" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PRODUCTION_FILTERS.map((f) => {
              const on = f === filter;
              const n = filterCustomersByProduction(summary.customers, f).reduce((s, c) => s + c.overdueSets, 0);
              const dot = FILTER_DOT[f];
              return (
                <button
                  key={f} type="button" aria-pressed={on} onClick={() => setFilter(f)}
                  style={{
                    flex: "none", height: 34, padding: "0 12px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5,
                    fontWeight: on ? 700 : 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                    background: on ? M.taupe : M.card, color: on ? M.paper : M.raisin,
                    boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {dot ? <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#FFFFFF" : dot }} /> : null}
                  {FILTER_LABEL[f]}
                  <span style={{ opacity: 0.8, ...TNUM }}>{fmtN(n)}</span>
                </button>
              );
            })}
          </div>
          {visible.length === 0 ? (
            <div style={{ marginTop: 12, padding: 16, borderRadius: 12, textAlign: "center", fontSize: 12.5, color: M.ink, background: G.panel.background }}>
              No overdue sets in this state.
            </div>
          ) : (
            <GPanel pad={0} style={{ marginTop: 12, borderRadius: 14, overflow: "hidden" }}>
              {visible.map((c, i) => (
                <button
                  key={keyOf(c)} type="button" onClick={() => setOpen(keyOf(c))}
                  aria-label={`${c.customerName}: ${c.overdueSets} sets overdue, ${oldestLate(c)} days late. Open orders`}
                  style={{
                    width: "100%", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 15px", columnGap: 10, rowGap: 3, alignItems: "center", padding: "10px 12px",
                    border: "none", borderTop: ruleTop(i), background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{ minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, ...ellipsis }}>{c.customerName}</span>
                  <span style={{ textAlign: "right", fontSize: 15, fontWeight: 800, lineHeight: 1.1, color: G.late.fg, whiteSpace: "nowrap", ...TNUM }}>
                    {fmtN(c.overdueSets)}<span style={{ fontSize: 11, fontWeight: 600, color: M.ink }}> sets</span>
                  </span>
                  <span style={{ gridRow: "span 2", display: "flex", color: M.gold }}><ChevronRight size={15} strokeWidth={2} aria-hidden="true" /></span>
                  <span style={{ minWidth: 0, fontSize: 11.5, color: M.ink, ...ellipsis, ...TNUM }}>
                    {fmtN(c.orders.length)} {c.orders.length === 1 ? "order" : "orders"} · oldest due {c.oldestDueDate}
                  </span>
                  <span style={{ justifySelf: "end" }}><GPill>{fmtN(oldestLate(c))} d late</GPill></span>
                </button>
              ))}
            </GPanel>
          )}
          {summary.ordersWithoutCustomerDate > 0 ? (
            <GHint>
              {fmtN(summary.ordersWithoutCustomerDate)} {summary.ordersWithoutCustomerDate === 1 ? "order has" : "orders have"} no delivery date and {summary.ordersWithoutCustomerDate === 1 ? "is" : "are"} not counted.
            </GHint>
          ) : null}
        </>
      );
    }
  } else if (loading) {
    body = <Msg text="Loading overdue sets…" />;
  } else {
    body = <Msg alert text={`Overdue sets could not be loaded${unavailable ? ` (${unavailable})` : ""}. This is not a zero.`} />;
  }

  return (
    <section id="sales-overdue-sets" aria-label="Customer overdue sets" style={{ ...G.card, scrollMarginTop: 70 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: `1px solid ${G.rule}`, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: G.late.bg, display: "flex", alignItems: "center", justifyContent: "center", color: G.late.fg }}>
          <CalendarX size={16} strokeWidth={2} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>Customer overdue sets</span>
          <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>Not yet dispatched · past customer delivery date</span>
        </span>
      </div>
      {body}
      <OrdersSheet customer={openCustomer} onClose={() => setOpen(null)} />
    </section>
  );
}

function Msg({ text, alert }: { text: string; alert?: boolean }) {
  return <div role={alert ? "alert" : "status"} style={{ padding: "18px 8px", textAlign: "center", fontSize: 13, color: M.ink, lineHeight: 1.45 }}>{text}</div>;
}

// ---------------------------------------------------------------------------
// Sheet 1 — a customer's overdue orders (most late first)
// ---------------------------------------------------------------------------
function OrdersSheet({ customer, onClose }: { customer: CustomerOverdueSets | null; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const colorOf = useDeptColors(customer != null);
  const orders = useMemo(() => (customer ? [...customer.orders].sort((a, b) => b.daysLate - a.daysLate) : []), [customer]);
  const shown = all ? orders : orders.slice(0, ORDERS_SHOWN);
  const close = () => { setExpanded(null); setAll(false); onClose(); };
  const lateMax = customer ? oldestLate(customer) : 0;

  return (
    <Sheet open={customer != null} onClose={close} title={customer ? `Overdue orders — ${customer.customerName}` : "Overdue orders"} bare portal phoneRadius={26}>
      {customer ? (
        <div style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${M.paper} 96%, transparent), color-mix(in srgb, ${M.paper} 92%, ${M.divider}))`, borderTopLeftRadius: 26, borderTopRightRadius: 26 }}>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
            <div style={{ width: 40, height: 4, borderRadius: 999, background: M.hairline }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, ...ellipsis }}>{customer.customerName}</div>
              <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>Overdue orders · oldest due {customer.oldestDueDate}</div>
            </div>
            <button type="button" onClick={close} aria-label="Close" style={{ width: 40, height: 40, marginRight: -10, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.muted }}>
              <X size={20} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
          <div style={{ padding: "0 16px 28px", display: "grid", gridTemplateColumns: "minmax(0,1fr)", gridAutoRows: "max-content", gap: 12 }}>
            <GPanel pad="12px 4px" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
              <Stat v={fmtN(customer.overdueSets)} l="sets to dispatch" c={G.late.fg} />
              <Stat v={fmtN(customer.orders.length)} l="orders" divider />
              <div style={{ textAlign: "center", borderLeft: `1px solid ${G.rule}` }}>
                <div style={{ height: 22, display: "flex", alignItems: "center", justifyContent: "center" }}><GPill>{fmtN(lateMax)} d late</GPill></div>
                <div style={{ fontSize: 11, color: M.ink, marginTop: 2 }}>oldest</div>
              </div>
            </GPanel>
            <div style={{ ...G.panel, overflow: "hidden" }}>
              {shown.map((o, i) => (
                <OrderRow
                  key={o.soId} order={o} first={i === 0} open={expanded === o.soId} onToggle={() => setExpanded(expanded === o.soId ? null : o.soId)}
                  colorOf={colorOf} customerName={customer.customerName} onNavigate={close}
                />
              ))}
              {orders.length > ORDERS_SHOWN ? (
                <button type="button" onClick={() => setAll(!all)} style={{ width: "100%", height: 44, border: "none", borderTop: `1px solid ${G.rule}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer" }}>
                  {all ? "Show fewer" : `Show all ${fmtN(orders.length)} orders`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function Stat({ v, l, c, divider }: { v: string; l: string; c?: string; divider?: boolean }) {
  return (
    <div style={{ textAlign: "center", borderLeft: divider ? `1px solid ${G.rule}` : "none" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: c ?? M.raisin, ...TNUM }}>{v}</div>
      <div style={{ fontSize: 11, color: M.ink, marginTop: 2 }}>{l}</div>
    </div>
  );
}

function OrderRow({
  order: o, customerName, first, open, onToggle, colorOf, onNavigate,
}: { order: OverdueSetsOrder; customerName: string; first: boolean; open: boolean; onToggle: () => void; colorOf: (c: string) => string; onNavigate: () => void }) {
  const stages = orderStages(o.stages);
  const po = o.customerPo ? (/^PO/i.test(o.customerPo) ? o.customerPo : `PO ${o.customerPo}`) : null;
  const sub = [po, o.customerState, `due ${o.dueDate}`].filter(Boolean).join(" · ");
  return (
    <div style={{ borderTop: ruleTop(first ? 0 : 1) }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ width: "100%", display: "block", padding: "11px 12px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "flex", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease", color: M.muted }}><ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" /></span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.taupe, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", letterSpacing: -0.2, ...ellipsis }}>{o.soNo ?? "(no number)"}</span>
          <GPill>{fmtN(o.daysLate)} d late</GPill>
        </span>
        <span style={{ display: "block", margin: "4px 0 0 22px", fontSize: 11.5, color: M.muted, ...ellipsis }}>{sub}</span>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, margin: "8px 0 0 22px" }}>
          {stages.map((s) => {
            const done = s.stage === "DONE";
            const dot = done ? "#2F6B3F" : s.stage === "NOT_STARTED" ? DEPT_NEUTRAL : colorOf(s.stage);
            return (
              <span key={s.stage} style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", background: done ? "#E6F0E8" : M.card, color: done ? "#2F6B3F" : M.raisin, boxShadow: done ? "none" : `inset 0 0 0 1px ${G.rule}` }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />{s.label}<b style={TNUM}>{fmtN(s.sets)}</b>
              </span>
            );
          })}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap", ...TNUM }}><b style={{ color: M.raisin }}>{fmtN(o.remainingSets)}</b> of {fmtN(o.orderedSets)} sets to dispatch</span>
        </span>
      </button>
      {open ? <OrderItems order={o} customerName={customerName} colorOf={colorOf} onNavigate={onNavigate} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet 2 (inline under the order) — where each item is now
// ---------------------------------------------------------------------------
function OrderItems({ order, customerName, colorOf, onNavigate }: { order: OverdueSetsOrder; customerName: string; colorOf: (c: string) => string; onNavigate: () => void }) {
  const navigate = useNavigate();
  const { data, loading, error } = useCachedJson<SoDetail>(`/api/sales-orders/${encodeURIComponent(order.soId)}`);
  const all = data?.linkedPOs ?? [];
  const lines = all.filter(isStillToDispatch);
  const today = todayISO();
  // Same overdue source as the Production Orders list (never inferred from dates).
  const { data: od } = useCachedJson<{ data?: { overdueBedframePoIds?: string[]; overdueSofaPoIds?: string[] } }>("/api/production-orders/overdue-counts");
  const overdueIds = new Set([...(od?.data?.overdueBedframePoIds ?? []), ...(od?.data?.overdueSofaPoIds ?? [])]);
  const go = (to: string) => { onNavigate(); navigate(to); };

  let body: ReactNode;
  if (data?.success) {
    body = lines.length === 0
      ? <div style={{ padding: "12px", fontSize: 12, color: M.ink }}>{all.length === 0 ? "No production orders yet for this sales order." : "Every production order here is dispatched or cancelled."}</div>
      : <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>{lines.map((l) => (
          <PoCard
            key={l.id}
            po={{ id: l.id, poNo: l.poNo, status: l.status, productCode: l.productCode, productName: l.productName, quantity: l.quantity, currentDepartment: l.currentDepartment, targetEndDate: l.targetEndDate ?? undefined, companySOId: l.companySOId || order.soNo || undefined, customerSO: order.customerPo ?? undefined, customerName }}
            today={today}
            deptColor={colorOf}
            overdue={overdueIds.has(l.id)}
            onClick={() => go(`/m/production/${encodeURIComponent(l.id)}`)}
          />
        ))}</div>
  } else if (loading) {
    body = <div style={{ padding: 12, fontSize: 12, color: M.ink }}>Loading progress…</div>;
  } else {
    body = <div role="alert" style={{ padding: 12, fontSize: 12, color: G.late.fg }}>Progress could not be loaded.{error ? ` ${error}` : ""}</div>;
  }
  return (
    <div style={{ margin: "0 12px 14px", display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
      {body}
      <button type="button" onClick={() => go(order.soNo ? `/m/production?q=${encodeURIComponent(order.soNo)}` : "/m/production")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0 14px", border: "none", borderRadius: 12, boxShadow: `inset 0 0 0 1px ${G.rule}`, background: M.card, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: M.taupe, cursor: "pointer", textAlign: "left" }}>
        Open {order.soNo ?? "sales order"} in Production Orders<span style={{ flex: 1 }} /><ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
