// Home Operations v3 · Overview, part 1: Daily Report and Department Revenue (glass cards, "Home Operations v3" design).
// Data and rules: desktop dashboard-b/index.tsx (dailyReport, deptRevenue) + dashboard-b/DeptRevenueCard.tsx. The Overdue /
// Due within 3 days cards live in HomeOpsW.tsx, Daily production revenue in HomeOpsD.tsx.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleAlert, ClipboardCheck, ExternalLink, Factory, Receipt, RotateCw, ShoppingBag, ShoppingCart, TrendingUp, Truck, type LucideIcon,
} from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency, todayYmdMY } from "@/lib/utils";
import { M } from "../../theme";
import { dayLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { pickCat } from "../../../dashboard-b/revenue-split";
import { NOWRAP_ELLIPSIS, TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import {
  DR_LIST_HEAD, DR_RULE, DR_SORT, deptAvg, deptRevenueRows, deptWorkDays, drFull, drMoreDetail, drMoreText, drCards, hasAccessory, type DrJoin, type DrSide, type DrKey, type OpsRevCat,
} from "./ops-lib";
import { C } from "./ops-style";
import { Chev, StatusBlock } from "./ops-ui";
import { LiveTag, OGCard, ONote, PillButton } from "./ops-glass";
import { DeptRevenueSheet, DrSheet } from "./HomeOpsSheets";
import { statusPill } from "./dr-status";
import { panelStyle } from "./ops-glass-style";
import { dvColor } from "./ops-dept-colors";
import { G, GSwitch } from "./sales-glass";

const rmFull = (sen: number) => formatCurrency(Math.round(sen));

// ---------------------------------------------------------------------------
// Daily Report
// ---------------------------------------------------------------------------
const DR_GO: Partial<Record<DrKey, { to: string; label: string; need: string; icon: LucideIcon }>> = {
  overdueOrders: { to: "/m/sales", label: "Open Sales Orders", need: "sales-orders", icon: ShoppingCart },
  soNoDo: { to: "/m/sales", label: "Open Sales Orders", need: "sales-orders", icon: ShoppingCart },
  soNoInvoice: { to: "/m/sales", label: "Open Sales Orders", need: "sales-orders", icon: ShoppingCart },
  doPendingDispatch: { to: "/m/delivery", label: "Open Delivery Orders", need: "delivery-orders", icon: Truck },
  doNotDelivered: { to: "/m/delivery", label: "Open Delivery Orders", need: "delivery-orders", icon: Truck },
  doNotInvoiced: { to: "/m/invoices", label: "Open Invoices", need: "invoices", icon: Receipt },
  poNotReceived: { to: "/m/procurement", label: "Open Purchase Orders", need: "purchase-orders", icon: ShoppingBag },
  processSkips: { to: "/m/production", label: "Open Production Orders", need: "production-orders", icon: Factory },
};
/** Tile tones of the design (red = rail #C0574A on a pink wash, amber = rail #D19A32 on a cream wash). */
const TONE = {
  r: { rail: "#C0574A", n: "#9A3A2D", bg: `linear-gradient(160deg,${M.card},color-mix(in srgb, #C0574A 9%, ${M.card}))`, sh: "inset 0 0 0 1px rgba(192,87,74,.20),0 8px 18px -12px rgba(154,58,45,.45)", chev: "#C0574A" },
  a: { rail: "#D19A32", n: "#9C6F1E", bg: `linear-gradient(160deg,${M.card},color-mix(in srgb, #D19A32 10%, ${M.card}))`, sh: "inset 0 0 0 1px rgba(209,154,50,.25),0 8px 18px -12px rgba(156,111,30,.40)", chev: "#C2902D" },
} as const;

const DR_NEED = { so: "sales-orders", do: "delivery-orders", po: "purchase-orders", prod: "production-orders" } as const;
const DR_PATH = {
  so: (id: string) => `/m/sales/${encodeURIComponent(id)}`,
  do: (id: string) => `/m/delivery/${encodeURIComponent(id)}`,
  po: (id: string) => `/m/procurement/${encodeURIComponent(id)}`,
  prod: (id: string) => `/m/production/${encodeURIComponent(id)}`,
} as const;

export function DailyReportCard({ d }: { d: OpsData }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState<{ key: DrKey; title: string } | null>(null);
  const { status, data } = d.compliance;
  const full = data ? drFull(data) : null;
  const ready = status === "ready" && !!full;
  const more = full ? drMoreText(full) : null;
  const moreLong = full ? drMoreDetail(full) : null;

  const sub = ready ? (full.clear ? "All clear — nothing flagged today" : `Process & SOP exceptions${full.partial ? " · at least" : ""}`)
    : status === "error" ? "Couldn’t load — this is not a clean day, it is an unknown one"
      : status === "denied" ? "Process & SOP exceptions" : "Loading today’s checks…";
  const badge = ready ? { text: `${full.total}${full.partial ? "+" : ""}`, color: full.clear ? C.ok : full.partial ? "#71717A" : C.danger }
    : status === "error" ? { text: "—", color: "#9CA3AF" } : null;

  const key = open?.key ?? null;
  // The PO list and the production board are read only when their list is opened (one request each, cached 5 min and shared with the
  // Procurement / Production screens): the report row carries neither a PO's Expected date nor an order's own status.
  const canPo = hasPermission("purchase-orders", "read");
  const canProd = hasPermission("production-orders", "read");
  const poRead = useCachedJson<{ data?: { id: string; expectedDate?: string | null; status?: string }[] }>(key === "poNotReceived" && canPo ? "/api/purchase-orders" : null);
  const boardRead = useCachedJson<{ data?: { id: string; status?: string }[] }>(key === "processSkips" && canProd ? "/api/production-orders/board" : null);
  const side = <T,>(want: boolean, allowed: boolean, r: { data: unknown; loading: boolean; failure: unknown }, rows: { id: string }[] | undefined, pick: (x: never) => T): DrSide<T> =>
    !want ? { state: "idle", byId: new Map() }
      : !allowed ? { state: "unavailable", byId: new Map() }
        : rows ? { state: "ready", byId: new Map(rows.map((x) => [x.id, pick(x as never)])) }
          : { state: r.failure ? "unavailable" : "loading", byId: new Map() };
  const join: DrJoin = {
    po: side(key === "poNotReceived", canPo, poRead, poRead.data?.data, (x: { expectedDate?: string | null; status?: string }) => ({ expectedDate: x.expectedDate ?? "", status: x.status ?? "" })),
    prod: side(key === "processSkips", canProd, boardRead, boardRead.data?.data, (x: { status?: string }) => ({ status: x.status ?? "" })),
  };
  const cards = key && data ? drCards(key, data.groups, join) : [];
  const go = key ? DR_GO[key] : undefined;
  const canGo = go ? hasPermission(go.need, "read") : false;
  const openN = key ? data?.counts[key] ?? null : null;

  return (
    <>
      <section id="ops-daily-report" aria-label="Daily Report" style={G.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: "linear-gradient(145deg,#A08C5B,#6B5C32)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.28),0 8px 16px -8px rgba(107,92,50,.75)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            <ClipboardCheck size={16} strokeWidth={2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>Daily Report</span>
              <LiveTag>LIVE</LiveTag>
              {data?.today ? <span style={{ fontSize: 11.5, fontWeight: 600, color: M.muted, whiteSpace: "nowrap", ...TNUM }}>{dayLabel(data.today)}</span> : null}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.3, color: status === "error" ? C.danger : M.ink, marginTop: 2, ...NOWRAP_ELLIPSIS }}>{sub}</div>
          </div>
          {status === "loading" ? <span aria-label="Loading" style={{ flex: "none", width: 48, height: 28, borderRadius: 8, backgroundColor: M.divider }} /> : null}
          {badge ? (
            <span aria-label={ready ? `${full.total}${full.partial ? " or more" : ""} issues today` : "Couldn’t load"} style={{ flex: "none", fontSize: 26, lineHeight: "30px", fontWeight: 800, letterSpacing: -0.8, color: badge.color, ...TNUM }}>{badge.text}</span>
          ) : null}
        </div>

        {status === "denied" || status === "loading" ? <StatusBlock status={status} what="The Daily Report" need="sales-orders access" /> : null}
        {status === "error" ? (
          <button type="button" onClick={d.compliance.retry} style={{ marginTop: 12, height: 40, width: "100%", border: "none", borderRadius: 12, backgroundColor: "#FFF7ED", color: "#C2410C", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RotateCw size={15} strokeWidth={2.2} aria-hidden="true" />Retry
          </button>
        ) : null}

        {ready && full.partial ? (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "9px 11px", borderRadius: 12, backgroundColor: `color-mix(in srgb, #71717A 12%, ${M.card})` }}>
            <CircleAlert size={15} strokeWidth={2} color="#71717A" aria-hidden="true" style={{ flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4, color: M.ink }}>{full.failed} of {full.checksTotal} checks couldn’t run — this count is a floor, not a total</span>
            <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, backgroundColor: M.card, color: M.ink, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>Couldn’t check {full.failed}</span>
          </div>
        ) : null}

        {ready ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
              {full.tiles.map((t) => {
                const unknown = t.n === null;
                const zero = t.n === 0;
                const T = TONE[t.tone];
                const plain = zero || unknown;
                return (
                  <button key={t.key} type="button" aria-label={`${t.label}: ${unknown ? "couldn’t check" : t.n}`} onClick={() => { setOpen({ key: t.key, title: t.label }); }}
                    style={{ position: "relative", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "10px 10px 10px 14px", border: "none", borderRadius: 14, background: plain ? `color-mix(in srgb, ${M.card} 82%, transparent)` : T.bg, boxShadow: plain ? `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.06)` : T.sh, fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: unknown ? "#D4D4D8" : T.rail }} />
                    <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 22, lineHeight: "26px", fontWeight: 800, letterSpacing: -0.6, color: unknown ? "#71717A" : zero ? C.ok : T.n, ...TNUM }}>{unknown ? "—" : t.n}</span>
                      <Chev size={15} color={plain ? C.chevron : T.chev} />
                    </span>
                    <span style={{ width: "100%", fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: M.raisin, overflowWrap: "anywhere" }}>{t.label}</span>
                    {unknown ? <span style={{ fontSize: 11, color: "#71717A" }}>Couldn’t check today</span> : null}
                  </button>
                );
              })}
            </div>
            {more ? (
              <button type="button" onClick={() => navigate("/daily-report")} aria-label={`${moreLong ?? more}. Open the Daily Report on desktop`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", height: 36, margin: "10px 0 -8px", padding: 0, border: "none", borderTop: `1px solid ${G.rule}`, background: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: M.taupe, cursor: "pointer", whiteSpace: "nowrap" }}>
                <span style={{ minWidth: 0 }}>{more}</span>
                <ExternalLink size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none" }} />
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      {open ? (
        <DrSheet title={open.title} rule={DR_RULE[open.key]} n={openN} cards={cards} head={DR_LIST_HEAD[open.key] ?? "ITEMS"} sort={DR_SORT[open.key]}
          go={go ? { label: go.label, icon: go.icon } : undefined} canGo={canGo} onGo={() => go && navigate(go.to)}
          canOpen={(c) => !!c.link && hasPermission(DR_NEED[c.link.kind], "read")}
          openRef={(c) => c.link && navigate(DR_PATH[c.link.kind](c.link.id))}
          pillOf={(c) => statusPill(c.statusKind, c.statusRaw)}
          onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Department Revenue
// ---------------------------------------------------------------------------
const REV_BASE = [["all", "All"], ["bedframe", "Bedframe"], ["sofa", "Sofa"]] as const;
const REV_ACC = [...REV_BASE, ["accessory", "Accessory"]] as const;

export function DeptRevenueCard({ d, period, onPeriod }: { d: OpsData; period: Period; onPeriod: (p: Period) => void }) {
  const [cat0, setCat] = useState<OpsRevCat>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const { status, data } = d.split;
  const withAcc = hasAccessory(data);
  // Accessory is offered only when some department carries Accessory value (desktop CatToggle withAccessory).
  const cat: OpsRevCat = cat0 === "accessory" && !withAcc ? "all" : cat0;
  const rows = useMemo(() => deptRevenueRows(data, cat, period.day), [data, cat, period.day]);
  const workDays = useMemo(() => deptWorkDays(data, todayYmdMY()), [data]);
  const dayPicked = !!period.day && data?.granularity === "day" && (data.revenue ?? []).some((b) => b.bucket === period.day);
  const pickDay = (day: string) => onPeriod({ mode: "monthly", month: period.month, day: period.day === day ? undefined : day });
  const openRow = open ? rows.find((r) => r.code === open) : null;
  const shownRows = all ? rows : rows.slice(0, 5);
  const periodOf = (code: string) => pickCat((data?.departments ?? []).find((x) => x.code === code)?.period, cat);

  return (
    <>
      <OGCard icon={TrendingUp} title="Department Revenue" label="Department Revenue" id="ops-dept-revenue">
        {status !== "ready" ? (
          <StatusBlock status={status} what="Department Revenue" need="a dashboard operations view" onRetry={d.retrySplit} />
        ) : rows.length === 0 ? (
          <div role="status" style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No department revenue data.</div>
        ) : (
          <>
            <GSwitch aria="Category" options={withAcc ? REV_ACC : REV_BASE} value={cat} onChange={(k) => { setCat(k); setAll(false); }} />
            <div style={{ ...panelStyle({ padding: "0 12px", overflow: "hidden" }), marginTop: 10 }}>
              {shownRows.map((r, i) => {
                const c = dvColor(r.code);
                const avg = deptAvg(periodOf(r.code), workDays);
                // Bedframe counts are UNITS (every SKU x quantity), sofa counts are SETS (1 per order): never one "sets" figure for both.
                const count = cat === "accessory" ? "" : cat === "bedframe" ? `${r.bed} ${r.bed === 1 ? "unit" : "units"}` : cat === "sofa" ? `${r.sofa} ${r.sofa === 1 ? "set" : "sets"}` : `${r.bed} ${r.bed === 1 ? "unit" : "units"} · ${r.sofa} ${r.sofa === 1 ? "set" : "sets"}`;
                const avgText = avg == null ? "Avg —" : `Avg ${rmFull(avg)}/day`;
                // With a day picked the value and the counts are that day's, the average stays the period's: say so.
                const sub2 = dayPicked ? [count, avg == null ? "Period avg —" : `Period avg ${rmFull(avg)}/day`].filter(Boolean).join(" · ") : [avgText, count].filter(Boolean).join(" · ");
                return (
                  <button key={r.code} type="button" aria-label={`${r.label}, ${rmFull(r.value)}. Open daily trend`} onClick={() => setOpen(r.code)}
                    style={{ width: "100%", display: "block", padding: "9px 0", border: "none", borderTop: i ? `1px solid ${G.rule}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", backgroundColor: c, boxShadow: "inset 0 0 0 1px rgba(128,128,128,.35)" }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.label}</span>
                      <span style={{ flex: "none", fontSize: 13.5, fontWeight: 800, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rmFull(r.value)}</span>
                      <Chev size={14} />
                    </span>
                    <span aria-hidden="true" style={{ display: "block", height: 5, margin: "7px 22px 0 16px", borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${r.frac * 100}%`, borderRadius: 999, backgroundColor: c }} />
                    </span>
                    <span style={{ display: "block", margin: "5px 22px 0 16px", fontSize: 11.5, color: M.muted, ...NOWRAP_ELLIPSIS, ...TNUM }}>{sub2}</span>
                  </button>
                );
              })}
            </div>
            {rows.length > 5 ? <PillButton chevron="none" label={all ? "Show fewer" : `Show all ${rows.length}`} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
            <ONote top={10}>Tap a department for its daily trend and category split</ONote>
          </>
        )}
      </OGCard>

      {open && openRow && data ? (
        <DeptRevenueSheet data={data} code={open} cat={cat} period={period} todayMY={todayYmdMY()} workDays={workDays} pickDay={pickDay} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
