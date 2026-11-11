// The /m Home (Home v10). Replaces the old Home presentation: header, greeting,
// Scan to Create tiles, a six-view selector (no Today's problems — owner 2026-11-11) and the period bar, then
// the selected view. Sales, Operations and Employees are built; the other three show one Coming Soon
// state. Access follows the desktop dashboard (nav gate + tab list); a user with
// no dashboard access gets a permission-filtered module list instead.
//
// URL: /m?view=<sales|operations|people|service|finance|ocr>&mode&month&from&to&lbl&day
// (period scheme = the desktop's, so a phone link and a desktop link agree).
// Old /m/dashboard[/:tab] links are redirected here by LegacyDashboardRedirect.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Factory, Landmark, ScanText, Search, TrendingUp, Users, Wrench, Hourglass,
  type LucideIcon,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { usePermissions } from "@/lib/use-permission";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader } from "../../components/MobileHeader";
import { GlobalSearchSheet } from "../../components/GlobalSearchSheet";
import { ModuleGroupList } from "../../components/ModuleMenu";
import { useStickyBelowHeader } from "../../lib/header-geometry";
import { useNotificationFeed } from "../../lib/use-notification-feed";
import { visibleModuleGroups } from "../../nav";
import { M } from "../../theme";
import {
  monthLabel, quarterKeyOf, quarterPeriod, widgetPeriod, widgetPeriodLabel, yearsWithData, ymd, type Period,
} from "../../../dashboards/dashboard-shared-lib";
import { DASHBOARD_NAV_HREF } from "./dashboard-m-lib";
import { DASHBOARD_FEED_URL } from "./types";
import { useDashboardPeriod, useDashboardSub } from "./hooks";
import { useSalesData, type ProtoFeed, type SalesAccess } from "./home-data";
import {
  DASHBOARD_VIEWS, allowedViews, effectivePeriod, greetingWord, legacyDashboardTarget, opsPeriodLabel, periodResolved, periodMode, resolveView, stepOps, stepSales, switchMode, switchOpsMode, type DashView, type PeriodMode4,
} from "./home-lib";
import { SalesView } from "./SalesView";
import { OpsView, type OpsSubKey } from "./OpsView";
import { FloorLiveView } from "../../../dashboards/FloorLiveView";
import { EmpView } from "./EmpView";
import type { EmpAccess } from "./emp-data";
import type { OpsAccess } from "./ops-data";
import { ScanToCreate } from "./ScanToCreate";
import { Label, SectionState, SheetCard, SheetFrame, SheetNote } from "./home-ui";
import { DATA, SHADOW_CARD, SHADOW_SMALL, TNUM } from "./home-style";

const VIEW_ICON: Record<DashView, LucideIcon> = { sales: TrendingUp, operations: Factory, people: Users, service: Wrench, finance: Landmark, ocr: ScanText };
const HEADER_BTN = "0 1px 2px rgba(31,29,27,.06),0 6px 16px -8px rgba(31,29,27,.22)";

// ---------------------------------------------------------------------------
// Old links
// ---------------------------------------------------------------------------
/** /m/dashboard and /m/dashboard/:tab → /m?view=<tab>, every period parameter kept. */
export function LegacyDashboardRedirect() {
  const { tab } = useParams();
  const { search } = useLocation();
  return <Navigate to={legacyDashboardTarget(tab, search)} replace />;
}

// ---------------------------------------------------------------------------
// Header, greeting, quick actions, search (shared by the dashboard and the fallback)
// ---------------------------------------------------------------------------
function RoundBtn({ label, onClick, children, dot }: { label: string; onClick: () => void; children: ReactNode; dot?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{ position: "relative", width: 42, height: 42, flex: "none", borderRadius: "50%", border: "none", backgroundColor: M.card, boxShadow: HEADER_BTN, display: "flex", alignItems: "center", justifyContent: "center", color: M.taupe, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {children}
      {dot ? <span aria-hidden="true" style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: "50%", backgroundColor: DATA.red, boxShadow: `0 0 0 2px ${M.card}` }} /> : null}
    </button>
  );
}

function HomeTop({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { unread } = useNotificationFeed();
  const [searchOpen, setSearchOpen] = useState(false);
  const first = (getCurrentUser()?.displayName || "there").split(" ")[0];
  return (
    <>
      <MobileHeader
        title="Dashboard"
        menu
        trailing={
          <>
            <RoundBtn label="Search" onClick={() => setSearchOpen(true)}><Search size={18} strokeWidth={1.9} aria-hidden="true" /></RoundBtn>
            <RoundBtn label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => navigate("/m/updates")} dot={unread > 0}><Bell size={18} strokeWidth={1.9} aria-hidden="true" /></RoundBtn>
          </>
        }
      />
      <div style={{ padding: "10px 16px 0" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: M.raisin, lineHeight: "26px", letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{greetingWord()}, {first}</div>
        <ScanToCreate />
      </div>
      {children}
      <GlobalSearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback Home: a user with no dashboard access still lands somewhere useful.
// ---------------------------------------------------------------------------
function FallbackHome() {
  const navigate = useNavigate();
  const { isNavAllowed } = usePermissions();
  const groups = visibleModuleGroups(isNavAllowed);
  return (
    <HomeTop>
      <div style={{ padding: "6px 16px 28px" }}>
        {groups.length === 0 ? (
          <div role="status" style={{ marginTop: 18, padding: "18px 16px", borderRadius: 16, backgroundColor: M.card, boxShadow: SHADOW_CARD, fontSize: 13, color: M.ink, lineHeight: 1.5 }}>
            No modules are available for your role yet. Ask an administrator if this is unexpected.
          </div>
        ) : (
          <ModuleGroupList groups={groups} onSelect={(path) => navigate(path)} />
        )}
      </div>
    </HomeTop>
  );
}


// ---------------------------------------------------------------------------
// View selector + period bar
// ---------------------------------------------------------------------------
const MODES = [["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]] as const;
/** Operations adds Day (desktop: Operations is a day tab). */
const OPS_MODES = [["day", "Day"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]] as const;
// Floor Live (owner 2026-11-11: "我的floorlive也没有看到") is the desktop's third Operations sub-tab, the same FloorLiveView.
type HomeOpsSub = OpsSubKey | "floor";
const OPS_SUB_OPTIONS: readonly (readonly [HomeOpsSub, string])[] = [["overview", "Overview"], ["production", "Output & Cost"], ["floor", "Floor Live"]];

function PeriodCalendar({
  period, months, today, onPick, onClose,
}: { period: Period; months: string[]; today: string; onPick: (p: Period) => void; onClose: () => void }) {
  const mode = periodMode(period);
  const years = yearsWithData(months);
  const [viewYear, setViewYear] = useState(period.month.slice(0, 4));
  const yi = years.indexOf(viewYear);
  const curYm = today.slice(0, 7);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // A tap outside closes it; the trigger button is left to toggle it itself.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || box.current?.contains(t) || t.closest('[aria-label^="Choose period"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [onClose]);

  const cell = (label: string, sub: string | undefined, on: boolean, dis: boolean, aria: string, go: () => void, h: number) => (
    <button key={aria} type="button" aria-pressed={on} aria-disabled={dis} aria-label={aria} onClick={() => { if (!dis) go(); }}
      style={{ height: h, border: "none", borderRadius: 10, backgroundColor: on ? M.taupe : M.paper, color: on ? M.paper : dis ? M.faint : M.raisin, fontFamily: "inherit", cursor: dis ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: 0, opacity: dis ? 0.55 : 1 }}>
      <span style={{ fontSize: 13.5, fontWeight: on ? 700 : 500, ...TNUM }}>{label}</span>
      {sub ? <span style={{ fontSize: 11, color: on ? M.paper : M.ink }}>{sub}</span> : null}
    </button>
  );
  const monthOf = (y: string, m: number) => `${y}-${String(m).padStart(2, "0")}`;

  let body: ReactNode;
  if (mode === "day") {
    body = (
      <input type="date" aria-label="Pick a day" value={period.day ?? ""} max={today} min="2020-01-01"
        onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) onPick({ mode: "monthly", month: v.slice(0, 7), day: v }); }}
        style={{ width: "100%", boxSizing: "border-box", height: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${M.hairline}`, backgroundColor: M.paper, color: M.raisin, fontFamily: "inherit", fontSize: 15 }} />
    );
  } else if (mode === "month") {
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
        {Array.from({ length: 12 }, (_, i) => {
          const ym = monthOf(viewYear, i + 1);
          return cell(monthLabel(ym).slice(0, 3), undefined, period.month === ym, !months.includes(ym), `${monthLabel(ym)}`, () => onPick({ mode: "monthly", month: ym }), 42);
        })}
      </div>
    );
  } else if (mode === "quarter") {
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
        {[1, 2, 3, 4].map((q) => {
          const key = `${viewYear}-Q${q}`;
          const first = monthOf(viewYear, (q - 1) * 3 + 1);
          const has = months.some((m) => quarterKeyOf(m) === key) || key === quarterKeyOf(curYm);
          const on = quarterKeyOf(period.month) === key && periodMode(period) === "quarter";
          return cell(`Q${q}`, `${monthLabel(first).slice(0, 3)} – ${monthLabel(monthOf(viewYear, q * 3)).slice(0, 3)}`, on, !has, `Q${q} ${viewYear}`, () => onPick(quarterPeriod(key, today)), 54);
        })}
      </div>
    );
  } else {
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
        {years.map((y) => cell(y, y === today.slice(0, 4) ? "Jan – Present" : "Jan – Dec", period.month.startsWith(y), false, y, () => onPick({ mode: "ytd", month: months.filter((m) => m.startsWith(y)).pop() ?? `${y}-01` }), 54))}
      </div>
    );
  }
  return (
    <>
      <div ref={box} role="dialog" aria-label="Choose period" style={{ position: "absolute", top: "calc(100% + 4px)", right: 16, zIndex: 2, width: 300, maxWidth: "calc(100% - 32px)", boxSizing: "border-box", backgroundColor: M.card, borderRadius: 16, padding: 12, boxShadow: "0 2px 6px rgba(31,29,27,.08),0 24px 48px -18px rgba(31,29,27,.40)" }}>
        {mode === "day" ? (
          <div style={{ padding: "2px 4px 10px" }}><Label>DAY</Label></div>
        ) : mode !== "year" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" aria-label="Previous year" onClick={() => years[yi - 1] && setViewYear(years[yi - 1])} style={{ width: 36, height: 36, border: "none", background: "none", color: years[yi - 1] ? M.raisin : M.faint, cursor: years[yi - 1] ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={18} strokeWidth={2} aria-hidden="true" /></button>
            <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, ...TNUM }}>{viewYear}</span>
            <button type="button" aria-label="Next year" onClick={() => years[yi + 1] && setViewYear(years[yi + 1])} style={{ width: 36, height: 36, border: "none", background: "none", color: years[yi + 1] ? M.raisin : M.faint, cursor: years[yi + 1] ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={18} strokeWidth={2} aria-hidden="true" /></button>
          </div>
        ) : <div style={{ padding: "2px 4px 10px" }}><Label>YEAR</Label></div>}
        {body}
      </div>
    </>
  );
}

function ViewBar({
  view, canSwitch, onViews, period, months, today, onPeriod, sub, onSub,
}: { view: DashView; canSwitch: boolean; onViews: () => void; period: Period | null; months: string[]; today: string; onPeriod: (p: Period) => void; sub?: HomeOpsSub; onSub?: (k: HomeOpsSub) => void }) {
  const top = useStickyBelowHeader();
  const [cal, setCal] = useState(false);
  const closeCal = useCallback(() => setCal(false), []);
  const label = DASHBOARD_VIEWS.find((v) => v.key === view)?.label ?? "Dashboard";
  const ops = view === "operations";
  // Operations and Employees are the two Day views: same four period modes, same day arrows.
  const dayView = ops || view === "people";
  const mode = period ? periodMode(period) : "month";
  const step = dayView ? stepOps : stepSales;
  const prev = period ? step(period, months, -1, today) : null;
  const next = period ? step(period, months, 1, today) : null;
  const modes: readonly (readonly [PeriodMode4, string])[] = dayView ? OPS_MODES : MODES;
  const pickMode = (p: Period, k: PeriodMode4): Period => (dayView ? switchOpsMode(p, k, today) : switchMode(p, k as "month" | "quarter" | "year", today));
  const arrow = (dir: "prev" | "next", target: Period | null) => (
    <button type="button" aria-label={dir === "prev" ? "Previous period" : "Next period"} aria-disabled={!target} onClick={() => target && onPeriod(target)}
      style={{ width: 32, height: 36, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: target ? "pointer" : "default", color: target ? M.raisin : M.faint, WebkitTapHighlightColor: "transparent" }}>
      {dir === "prev" ? <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />}
    </button>
  );
  return (
    <div style={{ position: "sticky", top, zIndex: 30, backgroundColor: "var(--m-header-glass, " + M.paper + ")", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", padding: "6px 16px 10px", boxShadow: `0 1px 0 ${M.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={onViews} disabled={!canSwitch} aria-haspopup="dialog" aria-label={`Dashboard: ${label}${canSwitch ? " — switch" : ""}`}
          style={{ flex: "none", height: 36, display: "inline-flex", alignItems: "center", gap: 6, padding: canSwitch ? "0 12px 0 14px" : "0 14px", borderRadius: 999, border: "none", backgroundColor: M.card, boxShadow: SHADOW_SMALL, fontFamily: "inherit", cursor: canSwitch ? "pointer" : "default", color: M.raisin, WebkitTapHighlightColor: "transparent" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
          {canSwitch ? <ChevronDown size={16} strokeWidth={2.2} color={M.taupe} aria-hidden="true" /> : null}
        </button>
        <span style={{ flex: 1 }} />
        {period ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {arrow("prev", prev)}
            <button type="button" onClick={() => setCal((v) => !v)} aria-haspopup="dialog" aria-expanded={cal} aria-label={`Choose period: ${dayView ? opsPeriodLabel(period) : widgetPeriodLabel(period)}`}
              style={{ height: 36, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 12px", borderRadius: 999, border: "none", backgroundColor: cal ? M.taupe : M.card, color: cal ? M.paper : M.raisin, boxShadow: SHADOW_SMALL, fontFamily: "inherit", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <CalendarDays size={15} strokeWidth={2} aria-hidden="true" />
              <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{dayView ? opsPeriodLabel(period) : widgetPeriodLabel(period)}</span>
            </button>
            {arrow("next", next)}
          </div>
        ) : null}
      </div>
      {period ? (
        <div role="tablist" aria-label="Reporting period" style={{ display: "grid", gridTemplateColumns: `repeat(${modes.length},minmax(0,1fr))`, gap: 4, height: 46, marginTop: 10, boxSizing: "border-box", padding: 4, borderRadius: 14, backgroundColor: M.divider }}>
          {modes.map(([k, l]) => {
            const on = mode === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { if (!on) onPeriod(pickMode(period, k)); }}
                style={{ minWidth: 0, height: "100%", border: "none", borderRadius: 10, backgroundColor: on ? M.card : "transparent", boxShadow: on ? "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)" : "none", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>{l}</button>
            );
          })}
        </div>
      ) : null}
      {ops && sub && onSub ? (
        <div role="tablist" aria-label="Operations section" style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {OPS_SUB_OPTIONS.map(([k, l]) => {
            const on = sub === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { if (!on) onSub(k); }}
                style={{ flex: "none", height: 34, padding: "0 14px", border: "none", borderRadius: 999, backgroundColor: on ? M.taupe : M.card, color: on ? "#FFFFFF" : "#3A352C", boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : SHADOW_SMALL, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>{l}</button>
            );
          })}
        </div>
      ) : null}
      {cal && period ? <PeriodCalendar period={period} months={months} today={today} onPick={(p) => { onPeriod(p); setCal(false); }} onClose={closeCal} /> : null}
    </div>
  );
}

function ViewsSheet({ open, allowed, current, onPick, onClose }: { open: boolean; allowed: DashView[]; current: DashView | null; onPick: (v: DashView) => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <SheetFrame open title="Dashboard" sub="Choose which dashboard to view" onClose={onClose}>
      <SheetCard pad="0">
        <div role="radiogroup" aria-label="Dashboard">
          {DASHBOARD_VIEWS.filter((v) => allowed.includes(v.key)).map((v, i) => {
            const Icon = VIEW_ICON[v.key];
            const on = v.key === current;
            return (
              <button key={v.key} type="button" role="radio" aria-checked={on} onClick={() => onPick(v.key)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "0 16px", backgroundColor: M.card, border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                <Icon size={18} strokeWidth={1.9} color={on ? M.taupe : M.logoFrom} aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: on ? 700 : 500, color: M.raisin }}>{v.label}</span>
                {!v.built ? <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, backgroundColor: M.divider, color: M.ink, fontSize: 10.5, fontWeight: 700 }}>Soon</span> : null}
                {on ? <Check size={18} strokeWidth={2.4} color={M.taupe} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </SheetCard>
      <SheetNote>Only dashboards your role can open are listed. “Soon” views are not designed for mobile yet.</SheetNote>
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Coming Soon / blocked view
// ---------------------------------------------------------------------------
function ComingSoon({ view, onSales }: { view: DashView; onSales: (() => void) | null }) {
  const meta = DASHBOARD_VIEWS.find((v) => v.key === view)!;
  const Icon = VIEW_ICON[view];
  return (
    <div style={{ padding: "16px 16px 120px" }}>
      <div data-testid="dash-coming-soon" role="status" style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_CARD, padding: "28px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: M.divider, display: "flex", alignItems: "center", justifyContent: "center", color: M.taupe }}><Icon size={24} strokeWidth={1.75} /></span>
        <span style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px", borderRadius: 999, backgroundColor: M.divider, color: M.taupe, fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}><Hourglass size={12} strokeWidth={2} aria-hidden="true" />COMING SOON</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>{meta.label} dashboard</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, maxWidth: 280 }}>The mobile {meta.label} dashboard is being designed. Your access is unchanged, and the desktop dashboard has it today.</div>
        {onSales ? <button type="button" onClick={onSales} style={{ marginTop: 6, height: 40, padding: "0 18px", border: "none", borderRadius: 999, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Back to Sales</button> : null}
      </div>
    </div>
  );
}

function NotAvailable({ view, onFirst, firstLabel }: { view: DashView; onFirst: (() => void) | null; firstLabel: string }) {
  const meta = DASHBOARD_VIEWS.find((v) => v.key === view)!;
  return (
    <div style={{ padding: "16px 16px 120px" }}>
      <div data-testid="dash-not-available" role="alert" style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_CARD, padding: "24px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>Not available for your role</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, maxWidth: 280 }}>The {meta.label} dashboard is not part of your role’s dashboard views.</div>
        {onFirst ? <button type="button" onClick={onFirst} style={{ marginTop: 6, height: 40, padding: "0 18px", border: "none", borderRadius: 999, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Open {firstLabel}</button> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dashboard proper (mounted only for users who may open it)
// ---------------------------------------------------------------------------
function Dashboard() {
  const [params, setParams] = useSearchParams();
  const { hasPermission, dashboardTabs } = usePermissions();
  const allowed = useMemo(() => allowedViews(dashboardTabs), [dashboardTabs]);
  const resolved = resolveView(params.get("view"), allowed);
  const view: DashView | null = resolved.kind === "view" ? resolved.view : null;

  const tabHas = (t: string) => !!dashboardTabs && dashboardTabs.includes(t);
  const base: SalesAccess = {
    view: dashboardTabs ? tabHas("sales") : hasPermission("sales-orders", "read"),
    invoices: hasPermission("invoices", "read"),
    accounting: hasPermission("accounting", "read"),
    delivery: tabHas("sales") || hasPermission("delivery-orders", "read"),
  };
  const onSales = view === "sales";
  const access: SalesAccess = { ...base, view: base.view && onSales };

  // Operations: the tab list for a tab-restricted role (PRODUCTION), else the feed's own front door
  // (sales-orders:read). Each section then gates itself (ops-data.ts); the server stays the authority.
  const onOps = view === "operations";
  const opsView = dashboardTabs ? tabHas("operations") : hasPermission("sales-orders", "read");
  const opsAccess: OpsAccess = {
    view: opsView && onOps,
    salesOrders: hasPermission("sales-orders", "read"),
    accounting: hasPermission("accounting", "read"),
    invoices: hasPermission("invoices", "read"),
    purchaseOrders: hasPermission("purchase-orders", "read"),
    payroll: hasPermission("payroll", "read"),
    workers: hasPermission("workers", "read"),
    payslips: hasPermission("payslips", "read"),
  };
  // Employees: the tab list for a tab-restricted role, else workers:read (the server redacts the feed's employee
  // section without it). Salary needs payroll:read AND the inputs the server gates separately (workers, payslips).
  const onPeople = view === "people";
  const peopleView = dashboardTabs ? tabHas("people") : hasPermission("workers", "read");
  const peopleAccess: EmpAccess = {
    view: peopleView && onPeople,
    workers: hasPermission("workers", "read"),
    payroll: hasPermission("payroll", "read"),
    payslips: hasPermission("payslips", "read"),
    revenueFigures: hasPermission("revenue-figures", "read"),
  };
  // The removed "Not in" tile used to bump this to open the attendance log.
  const logSignal = 0;
  const { sub: rawSub, setSub } = useDashboardSub("operations");
  const opsSub: HomeOpsSub = rawSub === "production" ? "production" : rawSub === "floor" ? "floor" : "overview";

  // The month list drives the period model; it is the prototype feed the desktop page reads.
  const proto = useCachedJson<ProtoFeed>((onSales && base.view) || (onOps && opsView) || (onPeople && peopleView) ? DASHBOARD_FEED_URL : null);
  const months = useMemo(() => proto.data?.meta?.monthsWithSales ?? proto.data?.meta?.months ?? [], [proto.data]);
  const { period: rawPeriod, setPeriod } = useDashboardPeriod(months, view ?? "sales");
  const period = effectivePeriod(view ?? "sales", rawPeriod);
  const ready = periodResolved(period);
  const periodKey = ready ? widgetPeriod(period) : "";
  const periodText = ready ? widgetPeriodLabel(period) : "";
  const today = ymd(new Date());
  // No fetch runs off an unresolved period (the month list has not loaded yet).
  const data = useSalesData(periodKey, { ...access, view: access.view && ready });

  const [viewsOpen, setViewsOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const closeViews = useCallback(() => setViewsOpen(false), []);

  const setView = (v: DashView) => {
    setParams((prev) => { const n = new URLSearchParams(prev); n.set("view", v); return n; });
    setViewsOpen(false);
  };
  const refresh = () => { data.refresh(); setRefreshedAt(new Date()); };
  const firstAllowed = allowed[0];
  const firstLabel = DASHBOARD_VIEWS.find((v) => v.key === firstAllowed)?.label ?? "";

  return (
    <HomeTop>
      {/* Home v10 sets no line-height (browser `normal`); the /m shell inherits 1.5. Scoped to this screen's content. */}
      <div style={{ lineHeight: "normal" }}>
      {/* Today's problems removed from the phone Home (owner 2026-11-11: "整个手机版本
          dashboard都不要看到这个上面的"); the desktop dashboard keeps its strip. */}
      <ViewBar
        view={view ?? (resolved.kind === "blocked" ? resolved.view : "sales")}
        canSwitch={allowed.length > 1}
        onViews={() => setViewsOpen(true)}
        period={((onSales && base.view) || (onOps && opsView) || (onPeople && peopleView)) && ready ? period : null}
        months={months}
        today={today}
        onPeriod={setPeriod}
        sub={onOps && opsView ? opsSub : undefined}
        // Floor Live opens on today's live board (as on the desktop); the other sub-tabs keep the period.
        onSub={onOps && opsView ? (k: HomeOpsSub) => { setSub(k); if (k === "floor" && !period.day) setPeriod({ mode: "monthly", month: today.slice(0, 7), day: today }); } : undefined}
      />
      {resolved.kind === "none" ? (
        <div style={{ padding: 16 }}><div role="status" style={{ padding: 20, borderRadius: 16, backgroundColor: M.card, boxShadow: SHADOW_CARD, fontSize: 13, color: M.ink }}>No dashboard views are available for your role.</div></div>
      ) : resolved.kind === "blocked" ? (
        <NotAvailable view={resolved.view} onFirst={firstAllowed ? () => setView(firstAllowed) : null} firstLabel={firstLabel} />
      ) : onOps ? (
        !opsView ? (
          <NotAvailable view="operations" onFirst={firstAllowed && firstAllowed !== "operations" ? () => setView(firstAllowed) : null} firstLabel={firstLabel} />
        ) : !ready ? (
          <div style={{ padding: "14px 16px 120px" }}>
            <SectionState
              kind={proto.loading || (!proto.data && !proto.failure) ? "loading" : proto.failure ? "error" : "empty"}
              text={proto.loading || (!proto.data && !proto.failure) ? undefined : proto.failure ? "Could not load the list of months." : "No records yet, so there is no period to show."}
              onRetry={proto.refresh} minHeight={240}
            />
          </div>
        ) : (
          opsSub === "floor" ? (
            <div style={{ padding: "14px 16px 120px" }} data-testid="ops-floor-live">
              <FloorLiveView period={period} today={today} onPeriodChange={setPeriod} />
            </div>
          ) : (
            <OpsView access={opsAccess} period={period} periodKey={periodKey} sub={opsSub} today={today} onPeriod={setPeriod} />
          )
        )
      ) : onPeople ? (
        !peopleView ? (
          <NotAvailable view="people" onFirst={firstAllowed && firstAllowed !== "people" ? () => setView(firstAllowed) : null} firstLabel={firstLabel} />
        ) : !ready ? (
          <div style={{ padding: "14px 16px 120px" }}>
            <SectionState
              kind={proto.loading || (!proto.data && !proto.failure) ? "loading" : proto.failure ? "error" : "empty"}
              text={proto.loading || (!proto.data && !proto.failure) ? undefined : proto.failure ? "Could not load the Employees dashboard." : "No employee records yet, so there is no period to show."}
              onRetry={proto.refresh} minHeight={240}
            />
          </div>
        ) : (
          <EmpView access={peopleAccess} period={period} today={today} logSignal={logSignal} />
        )
      ) : view !== "sales" ? (
        <ComingSoon view={view!} onSales={allowed.includes("sales") ? () => setView("sales") : null} />
      ) : !base.view ? (
        <NotAvailable view="sales" onFirst={null} firstLabel="" />
      ) : !ready ? (
        <div style={{ padding: "14px 16px 120px" }}>
          <SectionState
            kind={proto.loading || (!proto.data && !proto.failure) ? "loading" : proto.failure ? "error" : "empty"}
            text={proto.loading || (!proto.data && !proto.failure) ? undefined : proto.failure ? "Could not load the list of sales months." : "No sales have been recorded yet."}
            onRetry={proto.refresh} minHeight={240}
          />
        </div>
      ) : (
        <>
          <SalesView data={data} access={access} period={period} periodKey={periodKey} periodText={periodText} curYm={today.slice(0, 7)} todayYmd={today} onRefresh={refresh} refreshedAt={refreshedAt} />
        </>
      )}
      <ViewsSheet open={viewsOpen} allowed={allowed} current={view} onPick={setView} onClose={closeViews} />
      </div>
    </HomeTop>
  );
}

export function HomeDashboard() {
  const { isNavAllowed, loading } = usePermissions();
  // Wait for the permission set (first visit only; it is cached after), so a
  // restricted role never fetches for, or flashes, a view it may not see.
  if (loading) return <HomeTop><div aria-busy="true" style={{ height: "60vh" }} /></HomeTop>;
  if (!isNavAllowed(DASHBOARD_NAV_HREF)) return <FallbackHome />;
  return <Dashboard />;
}
