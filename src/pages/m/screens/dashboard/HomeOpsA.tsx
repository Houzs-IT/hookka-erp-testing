// Home Operations · Overview, part 1: Daily Report, Department Revenue, Overdue production orders, Due within 3 days.
// Visual + interaction source: the approved Home Operations HTML. Data and rules: desktop dashboard-b/index.tsx
// (dailyReport, deptRevenue), dashboards/OverdueOrdersList.tsx, dashboards/OverdueCards.tsx.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, Calculator, CalendarX, CircleAlert, ClipboardCheck, ClipboardList, Monitor, Receipt, ReceiptText, RotateCw, ShoppingCart, Tag as TagIcon, TriangleAlert, Truck, type LucideIcon,
} from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { cachedFetchJsonResult } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { M } from "../../theme";
import { dayLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { ChipRow, SheetFrame } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import {
  DR_CHECKS, DR_RULE, DUE_LANES, bucketWord, deptBuckets, deptChips, deptRevenueRows, drRows, drSummary, dueSorted, duePill, filterOrders,
  overdueSplit, splitDayIndex, staleCount, deptKey, n0, type DrKey, type OpsRevCat, type ProdOrder,
} from "./ops-lib";
import { C, SHADOW_TILE, deptColor, sheetCard } from "./ops-style";
import { Bar, Chev, ChipScroll, CountPill, IconTile, InfoBox, MoreButton, OCard, OHead, PeriodText, SearchField, SectionLabel, Seg, StatusBlock, Tag } from "./ops-ui";

const rmFull = (sen: number) => formatCurrency(Math.round(sen));

// ---------------------------------------------------------------------------
// Daily Report
// ---------------------------------------------------------------------------
type Vis = { icon: LucideIcon; fg: string; bg: string };
const DR_VIS: Partial<Record<DrKey, Vis>> = {
  overdueOrders: { icon: CalendarX, fg: C.danger, bg: C.dangerBg },
  soNoInvoice: { icon: ReceiptText, fg: C.warn, bg: C.warnBg },
  doPendingDispatch: { icon: Truck, fg: C.teal, bg: C.tealBg },
  pricingIssues: { icon: TagIcon, fg: C.warn, bg: C.warnBg },
  cogsIssues: { icon: Calculator, fg: C.warn, bg: C.warnBg },
};
const DR_NEUTRAL: Vis = { icon: ClipboardList, fg: M.taupe, bg: "#F4EFE6" };
const DR_HEAD: Partial<Record<DrKey, string>> = {
  overdueOrders: "ORDERS", soNoDo: "SALES ORDERS", soNoInvoice: "SALES ORDERS", doPendingDispatch: "DELIVERY ORDERS", doNotDelivered: "DELIVERY ORDERS",
  doNotInvoiced: "DELIVERY ORDERS", poNotReceived: "PURCHASE ORDERS", lowEfficiencyWorkers: "WORKERS", processSkips: "ORDERS", missingWipTimes: "PRODUCTS",
  incompleteBoms: "PRODUCTS", rdStalled: "PROJECTS", pricingIssues: "ORDER LINES", cogsIssues: "DELIVERY ORDERS",
};
const DR_GO: Partial<Record<DrKey, { to: string; label: string; need: string; icon: LucideIcon }>> = {
  overdueOrders: { to: "/m/sales", label: "Open Sales Orders", need: "sales-orders", icon: ShoppingCart },
  soNoDo: { to: "/m/sales", label: "Open Sales Orders", need: "sales-orders", icon: ShoppingCart },
  soNoInvoice: { to: "/m/sales", label: "Open Sales Orders", need: "sales-orders", icon: ShoppingCart },
  doPendingDispatch: { to: "/m/delivery", label: "Open Delivery Orders", need: "delivery-orders", icon: Truck },
  doNotDelivered: { to: "/m/delivery", label: "Open Delivery Orders", need: "delivery-orders", icon: Truck },
  doNotInvoiced: { to: "/m/invoices", label: "Open Invoices", need: "invoices", icon: Receipt },
};

export function DailyReportCard({ d }: { d: OpsData }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState<DrKey | null>(null);
  const [shown, setShown] = useState(40);
  const { status, data } = d.compliance;
  const sum = data ? drSummary(data) : null;
  const ready = status === "ready" && !!sum;

  const sub = ready ? (sum.clear ? "All clear — nothing flagged today" : `${sum.total}${sum.partial ? "+" : ""} issues today · top ${sum.top.length} shown`)
    : status === "error" ? "Couldn’t load — this is not a clean day, it is an unknown one"
      : status === "denied" ? "Process & SOP exceptions" : "Loading today’s checks…";
  const badge = ready ? { text: sum.clear ? "✓" : `${sum.total}${sum.partial ? "+" : ""}`, bg: sum.clear ? C.okBg : sum.partial ? "#F4F4F5" : C.dangerBg, fg: sum.clear ? C.ok : sum.partial ? "#52525B" : C.danger }
    : status === "error" ? { text: "—", bg: "#F3F4F6", fg: "#52525B" } : null;

  const rows = open && data ? drRows(open, data.groups) : [];
  const vis = (open && DR_VIS[open]) || DR_NEUTRAL;
  const go = open ? DR_GO[open] : undefined;
  const canGo = go ? hasPermission(go.need, "read") : false;

  return (
    <>
      <OCard label="Daily Report" id="ops-daily-report">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <IconTile icon={ClipboardCheck} bg="#F4EFE6" fg={M.taupe} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>Daily Report</span><Tag kind="live">TODAY</Tag>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: "17px", color: status === "error" ? C.danger : M.ink, marginTop: 3 }}>{sub}</div>
          </div>
          {status === "loading" ? <span aria-label="Loading" style={{ flex: "none", width: 44, height: 28, borderRadius: 999, backgroundColor: M.divider }} /> : null}
          {badge ? (
            <span aria-label={ready ? `${sum.total} issues` : "Unknown"} style={{ flex: "none", minWidth: 30, height: 28, boxSizing: "border-box", padding: "0 9px", borderRadius: 999, backgroundColor: badge.bg, color: badge.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, ...TNUM }}>{badge.text}</span>
          ) : null}
        </div>

        {status === "denied" || status === "loading" ? <StatusBlock status={status} what="The Daily Report" need="sales-orders access" /> : null}
        {status === "error" ? (
          <button type="button" onClick={d.compliance.retry} style={{ marginTop: 12, height: 40, width: "100%", border: "none", borderRadius: 12, backgroundColor: "#FFF7ED", color: "#C2410C", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RotateCw size={15} strokeWidth={2.2} aria-hidden="true" />Retry
          </button>
        ) : null}

        {ready && sum.partial ? (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "9px 11px", borderRadius: 12, backgroundColor: "#F4F4F5" }}>
            <CircleAlert size={15} strokeWidth={2} color="#52525B" aria-hidden="true" style={{ flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4, color: "#3F3F46" }}>{sum.failed} of {sum.checksTotal} checks couldn’t run — this count is a floor, not a total</span>
            <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, backgroundColor: "#FFFFFF", color: "#52525B", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>Couldn’t check {sum.failed}</span>
          </div>
        ) : null}

        {ready && sum.top.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 14 }}>
            {sum.top.map((t, i) => (
              <button key={t.key} type="button" aria-label={`${t.label}: ${t.n}. Shows the list`} onClick={() => { setOpen(t.key); setShown(40); }}
                style={{ gridColumn: sum.top.length % 2 === 1 && i === sum.top.length - 1 ? "1 / -1" : "auto", minWidth: 0, minHeight: 48, display: "flex", alignItems: "center", gap: 9, padding: "8px 8px 8px 11px", border: "none", borderRadius: 12, backgroundColor: M.paper, fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <span style={{ flex: "none", minWidth: 16, fontSize: 18, fontWeight: 700, color: C.danger, ...TNUM }}>{t.n}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: M.raisin }}>{t.label}</span>
                <Chev color={C.chevronGold} />
              </button>
            ))}
          </div>
        ) : null}
      </OCard>

      {open ? (
        <SheetFrame open title={DR_CHECKS.find((c) => c[0] === open)?.[1] ?? ""} sub="Daily Report · today" onClose={() => setOpen(null)}>
          <div style={{ ...sheetCard, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
            <IconTile icon={vis.icon} bg={vis.bg} fg={vis.fg} iconSize={19} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45, color: M.ink }}>{DR_RULE[open]}</div>
            <span style={{ flex: "none", minWidth: 30, height: 28, boxSizing: "border-box", padding: "0 9px", borderRadius: 999, backgroundColor: C.dangerBg, color: C.danger, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, ...TNUM }}>{data?.counts[open] ?? 0}</span>
          </div>
          <div style={{ padding: "16px 2px 8px" }}><SectionLabel>{DR_HEAD[open] ?? "ITEMS"}</SectionLabel></div>
          {rows.length === 0 ? (
            <div style={{ ...sheetCard, padding: "16px 14px", fontSize: 13, color: M.ink, textAlign: "center" }}>The list for this check was not returned.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
              {rows.slice(0, shown).map((r) => {
                const linkable = !!r.link && hasPermission(r.link.kind === "so" ? "sales-orders" : "delivery-orders", "read");
                const body = (
                  <>
                    <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: C.neutralRail }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS, ...TNUM }}>{r.ref || "—"}</div>
                      {r.sub ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere" }}>{r.sub}</div> : null}
                    </div>
                    <div style={{ flex: "none", textAlign: "right", maxWidth: "46%" }}>
                      {r.right ? <span style={{ height: 24, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, backgroundColor: C.neutralPill, color: M.ink, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{r.right}</span> : null}
                      {r.rightSub ? <div style={{ fontSize: 11, color: M.muted, marginTop: r.right ? 3 : 0, overflowWrap: "anywhere" }}>{r.rightSub}</div> : null}
                    </div>
                    {linkable ? <Chev size={16} /> : null}
                  </>
                );
                const box = { position: "relative" as const, overflow: "hidden" as const, display: "flex", alignItems: "center", gap: 12, padding: "12px 10px 12px 16px", borderRadius: 14, backgroundColor: M.card, boxShadow: SHADOW_TILE, color: "inherit", textAlign: "left" as const, width: "100%", boxSizing: "border-box" as const };
                return linkable ? (
                  <button key={r.key} type="button" aria-label={`${r.ref}, open detail`} onClick={() => navigate(r.link!.kind === "so" ? `/m/sales/${encodeURIComponent(r.link!.id)}` : `/m/delivery/${encodeURIComponent(r.link!.id)}`)}
                    style={{ ...box, border: "none", fontFamily: "inherit", cursor: "pointer" }}>{body}</button>
                ) : <div key={r.key} aria-label={r.ref} style={box}>{body}</div>;
              })}
            </div>
          )}
          {rows.length > shown ? <MoreButton label={`Show more (${rows.length - shown} left)`} onClick={() => setShown((n) => n + 40)} margin="10px 0 0" /> : null}
          {go && canGo ? (
            <button type="button" onClick={() => navigate(go.to)} style={{ width: "100%", margin: "14px 0 4px", height: 48, border: "none", borderRadius: 12, backgroundColor: M.taupe, color: M.paper, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 18px -10px rgba(107,92,50,.7)" }}>
              <go.icon size={16} strokeWidth={2} aria-hidden="true" />{go.label}<ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : !go ? (
            <div style={{ marginTop: 12 }}><InfoBox icon={Monitor} tone="neutral">Fix these on desktop — there is no mobile page for this list yet.</InfoBox></div>
          ) : null}
        </SheetFrame>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Department Revenue
// ---------------------------------------------------------------------------
const REV_CATS = [["all", "All"], ["bedframe", "Bedframe"], ["sofa", "Sofa"]] as const;
const deptTotal = (s: { bedframe: number; sofa: number; total: number }, cat: OpsRevCat) => (cat === "bedframe" ? s.bedframe : cat === "sofa" ? s.sofa : s.total);

export function DeptRevenueCard({ d, period, onPeriod }: { d: OpsData; period: Period; onPeriod: (p: Period) => void }) {
  const [cat, setCat] = useState<OpsRevCat>("all");
  const [open, setOpen] = useState<string | null>(null);
  const { status, data } = d.split;
  const di = splitDayIndex(data, period.day);
  const dayOn = di >= 0;
  const rows = useMemo(() => deptRevenueRows(data, cat, period.day), [data, cat, period.day]);
  const pickDay = (day: string) => onPeriod({ mode: "monthly", month: period.month, day: period.day === day ? undefined : day });
  const openRow = open ? rows.find((r) => r.code === open) : null;
  const dept = open && data ? (data.departments ?? []).find((x) => x.code === open) : null;
  const buckets = open && data ? deptBuckets(data, open, cat) : [];
  const maxB = Math.max(1, ...buckets.map((b) => b.value));
  const split = dept ? (dayOn ? dept.byBucket[di] : dept.period) : null;
  const anyAccessory = (data?.departments ?? []).some((x) => x.period.accessory > 0);
  const catLabel = REV_CATS.find((c) => c[0] === cat)?.[1] ?? "All";
  const dayText = dayOn ? `${dayLabel(period.day!)}` : "";
  const periodText = dayOn ? dayText : widgetPeriodLabel(period);
  const sel = dayOn ? period.day : undefined;

  return (
    <>
      <OCard label="Department Revenue" id="ops-dept-revenue">
        <OHead title="Department Revenue" right={<PeriodText>{periodText}</PeriodText>} />
        {status !== "ready" ? (
          <div style={{ marginTop: 12 }}><StatusBlock status={status} what="Department Revenue" need="a dashboard operations view" onRetry={d.retrySplit} /></div>
        ) : rows.length === 0 ? (
          <div role="status" style={{ padding: "30px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No department revenue data.</div>
        ) : (
          <>
            <div style={{ marginTop: 12 }}><ChipRow options={REV_CATS} value={cat} onChange={setCat} aria="Category" /></div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 14, paddingBottom: 4 }}>
              <SectionLabel>BY DEPARTMENT</SectionLabel>
              <span style={{ fontSize: 11, color: M.muted }}>{dayOn ? `Day total · ${dayText}` : "Period total"}</span>
            </div>
            <div>
              {rows.map((r) => {
                const c = deptColor(r.code);
                const dep = (data?.departments ?? []).find((x) => x.code === r.code);
                return (
                  <button key={r.code} type="button" aria-label={`${r.label}, ${rmFull(r.value)}, ${r.sets} ${r.sets === 1 ? "set" : "sets"}. Open daily trend`} onClick={() => setOpen(r.code)}
                    style={{ width: "100%", display: "block", padding: "11px 0", border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                      <span aria-hidden="true" style={{ width: 9, height: 9, flex: "none", borderRadius: "50%", backgroundColor: c, alignSelf: "center" }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.label}</span>
                      <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", ...TNUM }}>{r.sets} {r.sets === 1 ? "set" : "sets"}</span>
                      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rmFull(r.value)}</span>
                      <span style={{ display: "flex", alignSelf: "center" }}><Chev /></span>
                    </span>
                    <Bar frac={r.frac} color={c} h={8} inset="7px 24px 0 18px" />
                    {dayOn && dep ? <span style={{ display: "block", margin: "5px 24px 0 18px", fontSize: 11.5, color: M.ink, ...TNUM }}>Period {rmFull(deptTotal(dep.period, cat))}</span> : null}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </OCard>

      {open && openRow && data && dept ? (
        <SheetFrame open title={openRow.label} sub={`Department revenue · ${catLabel} · ${widgetPeriodLabel(period)}`} onClose={() => setOpen(null)}>
          <div style={{ ...sheetCard, padding: "14px 16px" }}>
            {[[dayOn ? dayText : "Selected day", dayOn ? rmFull(openRow.value) : "—", dayOn ? M.raisin : M.muted], ["Total", rmFull(deptTotal(dept.period, cat)), M.raisin]].map(([l, v, fg], i) => (
              <div key={l} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                <span style={{ flex: "none", fontSize: 12.5, color: M.ink }}>{l}</span>
                <span style={{ minWidth: 0, textAlign: "right", fontSize: 15, fontWeight: 700, color: fg, overflowWrap: "anywhere", ...TNUM }}>{v}</span>
              </div>
            ))}
            {buckets.length > 1 ? (
              <>
                <div role="img" aria-label={`${bucketWord(data.granularity)} output`} style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 96, marginTop: 16 }}>
                  {buckets.map((b) => {
                    const on = b.bucket === sel;
                    const bar = <span style={{ width: "100%", height: `${Math.max((b.value / maxB) * 100, b.value ? 4 : 2)}%`, borderRadius: "3px 3px 1px 1px", backgroundColor: deptColor(open), opacity: sel && !on ? 0.3 : 1, display: "block" }} />;
                    return b.pickable ? (
                      <button key={b.bucket} type="button" aria-label={`${b.bucket}: ${rmFull(b.value)}`} aria-pressed={on} onClick={() => pickDay(b.bucket)}
                        style={{ flex: 1, minWidth: 0, height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "flex-end" }}>{bar}</button>
                    ) : <span key={b.bucket} aria-label={`${b.bucket}: ${rmFull(b.value)}`} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end" }}>{bar}</span>;
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: M.muted, ...TNUM }}>
                  <span>{buckets[0]?.label}</span>
                  <span>{buckets[0]?.pickable ? (dayOn ? "tap again to clear" : "tap a day") : data.granularity === "week" ? "by week" : "by month"}</span>
                  <span>{buckets[buckets.length - 1]?.label}</span>
                </div>
              </>
            ) : null}
          </div>
          {split ? (
            <>
              <div style={{ padding: "14px 2px 8px" }}><SectionLabel>{dayOn ? `BY CATEGORY · ${dayText.toUpperCase()}` : "BY CATEGORY · PERIOD"}</SectionLabel></div>
              <div style={{ ...sheetCard, padding: "0 14px" }}>
                {[["Bedframe", split.bedframe], ["Sofa", split.sofa], ...(anyAccessory ? [["Accessory", split.accessory]] : []), ["Total", split.total]].map(([l, v], i, a) => (
                  <div key={l as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 44, borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                    <span style={{ fontSize: 13.5, fontWeight: i === a.length - 1 ? 700 : 500, color: M.raisin }}>{l}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, ...TNUM }}>{rmFull(v as number)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </SheetFrame>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overdue production orders / Due within 3 days
// ---------------------------------------------------------------------------
const PILL_RED = { bg: C.dangerBg, fg: C.danger };
const PILL_AMBER = { bg: C.warnBg, fg: C.warn };
const PILL_GREY = { bg: "#F0ECE9", fg: "#6B5C32" };

/**
 * Opening an order from the list: the feed carries the production order NUMBER but not its id, so the number is looked up on the
 * mobile Production board (GET /api/production-orders/board, the endpoint /m Production already reads, same production-orders:read
 * gate as the section) when the row is tapped, then /m/production/:id opens. No new endpoint; nothing is fetched until a tap.
 */
function useOpenOrder() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const can = hasPermission("production-orders", "read");
  const open = async (poNo: string | null) => {
    if (!poNo || busy) return;
    setErr(null);
    setBusy(poNo);
    const r = await cachedFetchJsonResult<{ data?: { id: string; poNo: string }[] }>("/api/production-orders/board");
    setBusy(null);
    if (!r.ok) { setErr(`Couldn’t open ${poNo}: the production board could not be loaded.`); return; }
    const hit = (r.data?.data ?? []).find((o) => o.poNo === poNo);
    if (!hit) { setErr(`Couldn’t find ${poNo} on the production board.`); return; }
    navigate(`/m/production/${encodeURIComponent(hit.id)}`);
  };
  return { can, busy, err, open };
}

function OrderRow({ o, pill, where, first, onOpen, busy }: { o: ProdOrder; pill: { label: string; bg: string; fg: string }; where: string; first?: boolean; onOpen?: () => void; busy?: boolean }) {
  const done = o.stagesTotal > 0 && o.stagesDone >= o.stagesTotal;
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS, ...TNUM }}>{o.poNo ?? "—"}</span>
        <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, backgroundColor: pill.bg, color: pill.fg, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{pill.label}</span>
        {onOpen ? <Chev /> : null}
      </div>
      <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3, ...NOWRAP_ELLIPSIS }}><span style={{ fontWeight: 600, color: M.raisin }}>{o.customer ?? "—"}</span>{o.productName ? ` · ${o.productName}` : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <div aria-hidden="true" style={{ flex: 1, minWidth: 0 }}><Bar frac={o.stagesTotal > 0 ? o.stagesDone / o.stagesTotal : 0} color={M.taupe} h={6} /></div>
        <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", ...TNUM }}>{o.stagesDone} / {o.stagesTotal} stages · {done ? "all done" : `${where} ${deptName(deptKey(o))}`}</span>
      </div>
    </>
  );
  const box = { display: "block", width: "100%", boxSizing: "border-box" as const, padding: "12px 0", borderTop: first ? "none" : `1px solid ${M.divider}`, textAlign: "left" as const };
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-busy={busy || undefined} aria-label={`${o.poNo ?? "Order"}, open production order`} style={{ ...box, border: "none", borderTop: box.borderTop, background: "none", fontFamily: "inherit", cursor: "pointer", opacity: busy ? 0.55 : 1, WebkitTapHighlightColor: "transparent" }}>{body}</button>
  ) : <div style={box}>{body}</div>;
}

function OpenError({ msg }: { msg: string | null }) {
  return msg ? <div role="alert" style={{ marginTop: 8, padding: "9px 11px", borderRadius: 12, backgroundColor: C.dangerBg, color: C.danger, fontSize: 12, lineHeight: 1.45 }}>{msg}</div> : null;
}

export function OverdueCard({ d }: { d: OpsData }) {
  const [kind, setKind] = useState<"live" | "done">("live");
  const [dept, setDept] = useState("ALL");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const { status, reason } = d.production;
  const orders = useMemo(() => d.feed?.production?.orders ?? [], [d.feed]);
  const split = useMemo(() => overdueSplit(orders), [orders]);
  const list = kind === "live" ? split.live : split.done;
  const chips = useMemo(() => deptChips(list), [list]);
  const rows = useMemo(() => filterOrders(list, dept, q), [list, dept, q]);
  const stale = staleCount(list);
  const live = status === "ready" && !!d.feed?.availability?.production?.live;
  const shown = all ? rows : rows.slice(0, 5);
  const ord = useOpenOrder();

  return (
    <OCard label="Overdue production orders" id="ops-overdue">
      <OHead title="Overdue production orders" center subLeading={1.45} sub="Past the customer’s delivery date · most late first"
        right={<>{live ? <Tag kind="live">LIVE</Tag> : null}{status === "ready" ? <CountPill n={n0(split.live.length)} tone="danger" /> : null}</>} />
      {status !== "ready" ? (
        <div style={{ marginTop: 12 }}><StatusBlock status={status} what="Overdue production orders" need="production-orders access" reason={reason} onRetry={d.retryFeed} /></div>
      ) : (
        <>
          {kind === "live" && stale > 0 ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "9px 11px", borderRadius: 12, backgroundColor: C.warnBg, fontSize: 12, lineHeight: 1.45, color: C.warnInk }}>
              <TriangleAlert size={14} strokeWidth={2} color={C.warn} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} /><span>{stale} over 60 days late — likely shipped but never scanned out, please check</span>
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Seg size="md" aria="Order state" value={kind} onChange={(k) => { setKind(k); setDept("ALL"); setAll(false); }} options={[["live", `In production · ${n0(split.live.length)}`], ["done", `Finished, not closed · ${n0(split.done.length)}`]]} />
          </div>
          <SearchField value={q} onChange={setQ} placeholder="Search PO, customer, product…" aria="Search overdue orders" />
          <ChipScroll aria="Department" value={dept} onChange={(k) => { setDept(k); setAll(false); }} options={[{ key: "ALL", label: `All · ${n0(list.length)}` }, ...chips.map((c) => ({ key: c.key, label: `${c.label} · ${n0(c.n)}` }))]} />
          {rows.length === 0 ? <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>{q || dept !== "ALL" ? "Nothing matches this filter." : "Nothing overdue here."}</div> : null}
          <div style={{ marginTop: 8 }}>
            {shown.map((o, i) => <OrderRow key={`${o.poNo}-${i}`} first={i === 0} o={o} pill={{ label: o.daysToDD == null ? "—" : `${-o.daysToDD} d`, ...PILL_RED }} where="waiting at" onOpen={ord.can ? () => void ord.open(o.poNo) : undefined} busy={ord.busy === o.poNo} />)}
          </div>
          <OpenError msg={ord.err} />
          {rows.length > 5 ? <MoreButton label={all ? "Show first 5" : `View all ${n0(rows.length)}`} expanded={all} onClick={() => setAll((v) => !v)} height={42} margin="0" /> : null}
        </>
      )}
    </OCard>
  );
}

export function DueSoonCard({ d }: { d: OpsData }) {
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState("ALL");
  const [q, setQ] = useState("");
  const { status, reason } = d.production;
  const orders = useMemo(() => dueSorted(d.feed?.production?.dueSoon3Days ?? []), [d.feed]);
  const chips = useMemo(() => deptChips(orders), [orders]);
  const rows = useMemo(() => filterOrders(orders, dept, q), [orders, dept, q]);
  const pillOf = (o: ProdOrder) => { const p = duePill(o.daysToDD); return { label: p.label, ...(p.urgent === true ? PILL_RED : p.urgent === false ? PILL_AMBER : PILL_GREY) }; };
  const live = status === "ready" && !!d.feed?.availability?.production?.live;
  const ord = useOpenOrder();
  const rowProps = (o: ProdOrder) => ({ onOpen: ord.can ? () => void ord.open(o.poNo) : undefined, busy: ord.busy === o.poNo });

  return (
    <>
      <OCard label="Due within 3 days" id="ops-due-soon">
        <OHead title="Due within 3 days" center sub="By customer delivery date · soonest first"
          right={<>{live ? <Tag kind="live">LIVE</Tag> : null}{status === "ready" ? <CountPill n={n0(orders.length)} tone="warn" /> : null}</>} />
        {status !== "ready" ? (
          <div style={{ marginTop: 12 }}><StatusBlock status={status} what="Due within 3 days" need="production-orders access" reason={reason} onRetry={d.retryFeed} /></div>
        ) : orders.length === 0 ? (
          <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>Nothing due in the next 3 days.</div>
        ) : (
          <>
            <div style={{ marginTop: 6 }}>{orders.slice(0, 3).map((o, i) => <OrderRow key={`${o.poNo}-${i}`} first={i === 0} o={o} pill={pillOf(o)} where="at" {...rowProps(o)} />)}</div>
            <OpenError msg={ord.err} />
            <MoreButton label={`View all ${n0(orders.length)}`} chevron="right" onClick={() => { setDept("ALL"); setQ(""); setOpen(true); }} />
          </>
        )}
      </OCard>
      {open ? (
        <SheetFrame open title="Due within 3 days" sub="Live · by customer delivery date" onClose={() => setOpen(false)}>
          <SearchField raised value={q} onChange={setQ} placeholder="Search PO, customer, product…" aria="Search due-soon orders" />
          <ChipScroll aria="Department" value={dept} onChange={setDept} options={[{ key: "ALL", label: `All · ${n0(orders.length)}` }, ...chips.map((c) => ({ key: c.key, label: `${c.label} · ${n0(c.n)}` }))]} />
          {rows.length === 0 ? <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No matching orders.</div> : null}
          {DUE_LANES.map((l) => {
            const g = rows.filter((o) => o.daysToDD === l.d);
            if (!g.length) return null;
            const col = l.urgent ? C.danger : C.warn;
            return (
              <div key={l.d} style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 8px" }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: col }} />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: col }}>{l.label.toUpperCase()}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: M.muted }}>{g.length}</span>
                </div>
                <div style={{ ...sheetCard, padding: "0 14px" }}>{g.map((o, i) => <OrderRow key={`${o.poNo}-${i}`} first={i === 0} o={o} pill={pillOf(o)} where="at" {...rowProps(o)} />)}</div>
              </div>
            );
          })}
        </SheetFrame>
      ) : null}
    </>
  );
}
