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
  ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Factory, Landmark, Moon, ScanText, Search, Sun, Sunrise, TrendingUp, Users, Wrench, Hourglass,
  type LucideIcon,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { todayYmdMY } from "@/lib/utils";
import { usePermissions } from "@/lib/use-permission";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader } from "../../components/MobileHeader";
import { GlobalSearchSheet } from "../../components/GlobalSearchSheet";
import { ModuleGroupList } from "../../components/ModuleMenu";
import { MenuButton } from "../../components/MenuButton";
import { useStickyBelowHeader } from "../../lib/header-geometry";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useNotificationFeed } from "../../lib/use-notification-feed";
import { visibleModuleGroups } from "../../nav";
import { M } from "../../theme";
import {
  monthLabel, quarterKeyOf, quarterPeriod, widgetPeriod, widgetPeriodLabel, yearsWithData, type Period,
} from "../../../dashboards/dashboard-shared-lib";
import { DASHBOARD_NAV_HREF } from "./dashboard-m-lib";
import { DASHBOARD_FEED_URL } from "./types";
import { useDashboardPeriod, useDashboardSub } from "./hooks";
import { writePeriod } from "./dashboard-m-lib";
import { useSalesData, type ProtoFeed, type SalesAccess } from "./home-data";
import {
  DASHBOARD_VIEWS, allowedViews, effectivePeriod, greetingWord, legacyDashboardTarget, problemDest, todayLabel, opsPeriodLabel, periodResolved, periodMode, resolveView, stepOps, stepSales, switchMode, switchOpsMode, type DashView, type PeriodMode4,
} from "./home-lib";
import { SalesView } from "./SalesView";
import { OpsView, type OpsSubKey } from "./OpsView";
import { FloorLivePhone } from "./FloorLivePhone";
import { EmpView } from "./EmpView";
import type { EmpAccess } from "./emp-data";
import type { OpsAccess } from "./ops-data";
import { ScanToCreate } from "./ScanToCreate";
import { Label, SectionState, SheetCard, SheetFrame, SheetNote } from "./home-ui";
import { DATA, SHADOW_CARD, SHADOW_SMALL, TNUM } from "./home-style";

import { TONE, useProblemTiles, type Tile } from "../../../dashboards/use-problem-tiles";

const VIEW_ICON: Record<DashView, LucideIcon> = { sales: TrendingUp, operations: Factory, people: Users, service: Wrench, finance: Landmark, ocr: ScanText };

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
// Home Sales v12 page chrome: warm page glow (over the theme's paper, so dark mode keeps working), one glass header
// card (menu, title, search + bell, greeting banner, Scan to Create).
const PAGE_BG = [
  "radial-gradient(70% 45% at 0% 0%, rgba(201,169,97,.22) 0%, rgba(201,169,97,0) 70%)",
  "radial-gradient(60% 40% at 100% 55%, rgba(139,122,78,.14) 0%, rgba(139,122,78,0) 70%)",
  "radial-gradient(70% 40% at 10% 100%, rgba(201,169,97,.16) 0%, rgba(201,169,97,0) 70%)",
].join(",");
const GREETING_ICON = { morning: Sunrise, afternoon: Sun, evening: Moon } as const;

function QuickTools({ unread, onSearch, onBell }: { unread: number; onSearch: () => void; onBell: () => void }) {
  const btn = { width: 44, height: 44, border: "none", borderRadius: "50%", background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: M.raisin, cursor: "pointer", padding: 0, position: "relative", WebkitTapHighlightColor: "transparent" } as const;
  return (
    <div role="group" aria-label="Quick tools" style={{ flex: "none", display: "flex", alignItems: "center", height: 44, padding: "0 2px", borderRadius: 999, backgroundColor: M.card, boxShadow: `0 0 0 1px ${M.divider}, 0 2px 4px rgba(31,29,27,.05), 0 8px 18px -10px rgba(31,29,27,.28)` }}>
      <button type="button" onClick={onSearch} aria-label="Search" style={btn}><Search size={18} strokeWidth={1.9} aria-hidden="true" /></button>
      <span aria-hidden="true" style={{ width: 1, height: 18, backgroundColor: M.divider }} />
      <button type="button" onClick={onBell} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} style={btn}>
        <Bell size={18} strokeWidth={1.9} aria-hidden="true" />
        {unread > 0 ? <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 5, minWidth: 15, height: 15, boxSizing: "border-box", padding: "0 4px", borderRadius: 999, backgroundColor: DATA.red, color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, lineHeight: "15px", textAlign: "center", boxShadow: `0 0 0 2px ${M.card}` }}>{unread > 99 ? "99+" : unread}</span> : null}
      </button>
    </div>
  );
}

function HomeTop({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { unread } = useNotificationFeed();
  const phone = useResponsiveLayout().mode === "phone";
  const [searchOpen, setSearchOpen] = useState(false);
  const first = (getCurrentUser()?.displayName || "there").split(" ")[0];
  const word = greetingWord();
  const GIcon = word.includes("morning") ? GREETING_ICON.morning : word.includes("afternoon") ? GREETING_ICON.afternoon : GREETING_ICON.evening;
  return (
    <>
      {/* Phones draw the bar inside the glass card; wider screens keep the standard sticky header. */}
      {phone ? null : (
        <MobileHeader title="Dashboard" menu trailing={<QuickTools unread={unread} onSearch={() => setSearchOpen(true)} onBell={() => navigate("/m/updates")} />} />
      )}
      <style>{"@keyframes hs12Glow{0%,100%{transform:translate(0,0) scale(1);opacity:.9}50%{transform:translate(-26px,14px) scale(1.18);opacity:1}}@keyframes hs12Orb{0%,100%{transform:translate(0,0)}50%{transform:translate(-22px,-12px)}}@keyframes hs12In{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes hs12Shine{0%{transform:translateX(-120%) skewX(-18deg)}55%,100%{transform:translateX(320%) skewX(-18deg)}}@media (prefers-reduced-motion:reduce){.hs12-anim{animation:none!important}}"}</style>
      {/* The warm glow is one viewport-sized fixed layer (not the 414px column), so wide phones, tablets and a resized
          window never show a seam where the column ends; content sits above it. */}
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: `${PAGE_BG}, ${M.paper}` }} />
      <div style={{ position: "relative", paddingTop: phone ? "env(safe-area-inset-top)" : 0, paddingBottom: 8, minHeight: "100%" }}>
        <header>
          {/* Top bar sits directly on the page background (no card); only date + greeting are in the gold card. */}
          {phone ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 52, padding: "2px 10px 0" }}>
              <MenuButton />
              <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 700, color: M.raisin, lineHeight: "24px", letterSpacing: -0.2 }}>Dashboard</div>
              <QuickTools unread={unread} onSearch={() => setSearchOpen(true)} onBell={() => navigate("/m/updates")} />
            </div>
          ) : null}
          <div style={{ padding: "8px 10px 0" }}>
            <div style={{ position: "relative", overflow: "hidden", borderRadius: 20, padding: "16px 16px 18px", background: "linear-gradient(160deg,#4A3F21 0%,#6B5C32 55%,#8B7A4E 100%)", boxShadow: "0 2px 4px rgba(74,63,33,.18),0 18px 34px -16px rgba(74,63,33,.60)" }}>
              <span aria-hidden="true" className="hs12-anim" style={{ position: "absolute", right: -70, top: -90, width: 240, height: 220, borderRadius: "50%", background: "radial-gradient(circle,rgba(201,169,97,.70) 0%,rgba(201,169,97,0) 65%)", animation: "hs12Glow 9s ease-in-out infinite" }} />
              <span aria-hidden="true" className="hs12-anim" style={{ position: "absolute", right: -30, bottom: -46, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,255,255,.16),rgba(255,255,255,0) 70%)", animation: "hs12Orb 12s ease-in-out infinite" }} />
              <span aria-hidden="true" className="hs12-anim" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.14),rgba(255,255,255,0))", animation: "hs12Shine 6s ease-in-out 1.2s infinite" }} />
              <div className="hs12-anim" style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.3, color: "#E9D9A8", animation: "hs12In .5s ease-out both" }}>
                <GIcon size={14} strokeWidth={2} color="#F1D58A" aria-hidden="true" /><span style={{ whiteSpace: "nowrap", ...TNUM }}>{todayLabel()}</span>
              </div>
              <div className="hs12-anim" style={{ position: "relative", marginTop: 6, fontSize: 22, fontWeight: 700, color: "#FFFFFF", lineHeight: "28px", letterSpacing: -0.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", animation: "hs12In .6s ease-out .12s both" }}>{word}, {first}</div>
            </div>
          </div>
          <div style={{ padding: "0 10px" }}><ScanToCreate /></div>
        </header>
        {children}
      </div>
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
// Floor Live (owner 2026-11-11: "我的floorlive也没有看到") is the desktop's third Operations sub-tab, FloorLivePhone (phone design; same data and rules as the desktop FloorLiveView).
type HomeOpsSub = OpsSubKey | "floor";
const OPS_SUB_OPTIONS: readonly (readonly [HomeOpsSub, string])[] = [["overview", "Overview"], ["production", "Output & Cost"], ["floor", "Floor Live"]];

const GLASS_PILL = { background: `linear-gradient(180deg, color-mix(in srgb, ${M.card} 95%, transparent), color-mix(in srgb, ${M.card} 72%, transparent))`, boxShadow: `inset 0 1px 0 ${M.card}, 0 0 0 1px rgba(201,169,97,.22), 0 6px 14px -8px rgba(107,92,50,.45)` } as const;
const ON_GRADIENT = "linear-gradient(145deg,#8B7A4E,#6B5C32)";
/** Earliest day the picker offers (the old date field's own limit). */
const DAY_MIN = "2020-01-01";
/** Selected cell of the calendar (design: taupe gradient, lit top edge). */
const CAL_ON = "linear-gradient(145deg,#A08C5B,#6B5C32)";
const CAL_ON_RING = "inset 0 1px 0 rgba(255,255,255,.25),0 8px 16px -8px rgba(107,92,50,.75)";

function PeriodCalendar({
  period, months, today, onPick, onClose, modes, mode, onMode,
}: { period: Period; months: string[]; today: string; onPick: (p: Period) => void; onClose: () => void; modes: readonly (readonly [PeriodMode4, string])[]; mode: PeriodMode4; onMode: (k: PeriodMode4) => void }) {
  const years = yearsWithData(months);
  const [viewYear, setViewYear] = useState(period.month.slice(0, 4));
  const yi = years.indexOf(viewYear);
  const curYm = today.slice(0, 7);
  // Day mode: a month grid (the design's calendar). The month shown starts on the picked day's month.
  const [viewM, setViewM] = useState((period.day ?? `${period.month}-01`).slice(0, 7));
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

  // Design cells: radius 10, a soft white tile with a faint gold ring, the selected one a taupe gradient, the current period a gold dot,
  // an unavailable one flat and faded (same availability rule as before).
  const cell = (label: string, sub: string | undefined, on: boolean, dis: boolean, aria: string, go: () => void, h: number, cur: boolean, fs: number) => (
    <button key={aria} type="button" aria-pressed={on} aria-disabled={dis} aria-label={aria} onClick={() => { if (!dis) go(); }}
      style={{ height: h, border: "none", borderRadius: 10, background: on ? CAL_ON : dis ? "transparent" : `color-mix(in srgb, ${M.card} 75%, transparent)`, boxShadow: on ? CAL_ON_RING : dis ? "none" : `inset 0 1px 0 ${M.card}, 0 0 0 1px rgba(201,169,97,.18)`, color: on ? "#FFFFFF" : dis ? M.faint : M.raisin, fontFamily: "inherit", cursor: dis ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: 0, WebkitTapHighlightColor: "transparent" }}>
      <span style={{ fontSize: fs, fontWeight: on || cur ? 700 : 500, ...TNUM }}>{label}</span>
      {sub ? <span style={{ fontSize: 11, color: on ? "#EFE7D3" : M.muted }}>{sub}</span> : null}
      <span aria-hidden="true" style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: cur && !on ? "#C9A961" : "transparent" }} />
    </button>
  );
  const monthOf = (y: string, m: number) => `${y}-${String(m).padStart(2, "0")}`;

  let body: ReactNode;
  if (mode === "day") {
    const [vy, vm] = viewM.split("-").map(Number);
    const lead = (new Date(vy, vm - 1, 1).getDay() + 6) % 7; // Monday first
    const n = new Date(vy, vm, 0).getDate();
    const ymdOf = (d: number) => `${viewM}-${String(d).padStart(2, "0")}`;
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yest = yesterday.toISOString().slice(0, 10);
    const pick = (v: string) => { if (v <= today && v >= DAY_MIN) onPick({ mode: "monthly", month: v.slice(0, 7), day: v }); };
    body = (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))" }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <span key={i} style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#8B7A4E" }}>{w}</span>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 2 }}>
          {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden="true" style={{ height: 36 }} />)}
          {Array.from({ length: n }, (_, i) => {
            const d = i + 1;
            const v = ymdOf(d);
            const dis = v > today || v < DAY_MIN;
            const on = period.day === v;
            const isToday = v === today;
            return (
              <button key={v} type="button" aria-label={`${d} ${monthLabel(viewM)}`} aria-pressed={on} aria-disabled={dis} onClick={() => pick(v)}
                style={{ height: 36, border: "none", borderRadius: 999, background: on ? CAL_ON : "transparent", boxShadow: on ? CAL_ON_RING : "none", color: on ? "#FFFFFF" : dis ? M.faint : M.raisin, fontFamily: "inherit", cursor: dis ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: 0, WebkitTapHighlightColor: "transparent" }}>
                <span style={{ fontSize: 13, fontWeight: on || isToday ? 700 : 500, ...TNUM }}>{d}</span>
                <span aria-hidden="true" style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: isToday && !on ? "#C9A961" : "transparent" }} />
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${M.divider}` }}>
          {([["Today", today], ["Yesterday", yest]] as const).map(([l, v]) => (
            <button key={l} type="button" onClick={() => pick(v)} style={{ flex: "none", height: 32, padding: "0 12px", borderRadius: 999, border: "none", background: `color-mix(in srgb, ${M.card} 80%, transparent)`, boxShadow: "inset 0 0 0 1px rgba(201,169,97,.25)", color: M.raisin, fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>
      </>
    );
  } else if (mode === "month") {
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
        {Array.from({ length: 12 }, (_, i) => {
          const ym = monthOf(viewYear, i + 1);
          return cell(monthLabel(ym).slice(0, 3), undefined, period.month === ym, !months.includes(ym), `${monthLabel(ym)}`, () => onPick({ mode: "monthly", month: ym }), 42, ym === curYm, 13.5);
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
          return cell(`Q${q}`, `${monthLabel(first).slice(0, 3)} – ${monthLabel(monthOf(viewYear, q * 3)).slice(0, 3)}`, on, !has, `Q${q} ${viewYear}`, () => onPick(quarterPeriod(key, today)), 54, key === quarterKeyOf(curYm), 14);
        })}
      </div>
    );
  } else {
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
        {years.map((y) => cell(y, y === today.slice(0, 4) ? "Jan – Present" : "Jan – Dec", period.month.startsWith(y), false, y, () => onPick({ mode: "ytd", month: months.filter((m) => m.startsWith(y)).pop() ?? `${y}-01` }), 54, y === today.slice(0, 4), 14))}
      </div>
    );
  }
  const monthNav = (dir: -1 | 1) => {
    const t = new Date(Date.UTC(Number(viewM.slice(0, 4)), Number(viewM.slice(5, 7)) - 1 + dir, 1)).toISOString().slice(0, 7);
    const ok = dir < 0 ? t >= DAY_MIN.slice(0, 7) : t <= curYm;
    return (
      <button type="button" aria-label={dir < 0 ? "Previous month" : "Next month"} aria-disabled={!ok} onClick={() => ok && setViewM(t)} style={{ width: 36, height: 36, border: "none", background: "none", color: ok ? M.raisin : M.faint, cursor: ok ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {dir < 0 ? <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />}
      </button>
    );
  };
  const yearNav = (dir: -1 | 1) => {
    const t = years[yi + dir];
    return (
      <button type="button" aria-label={dir < 0 ? "Previous year" : "Next year"} onClick={() => t && setViewYear(t)} style={{ width: 36, height: 36, border: "none", background: "none", color: t ? M.raisin : M.faint, cursor: t ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {dir < 0 ? <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />}
      </button>
    );
  };
  return (
    <>
      <div ref={box} role="dialog" aria-label="Choose period" style={{ position: "absolute", top: "calc(100% + 4px)", right: 12, zIndex: 41, width: 300, maxWidth: "calc(100% - 24px)", boxSizing: "border-box", background: `linear-gradient(160deg, color-mix(in srgb, ${M.card} 98%, transparent), color-mix(in srgb, ${M.card} 96%, transparent) 60%, color-mix(in srgb, ${M.paper} 97%, transparent))`, backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)", borderRadius: 20, padding: 14, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px color-mix(in srgb, ${M.card} 60%, transparent), 0 0 0 1px rgba(201,169,97,.18), 0 28px 56px -20px rgba(31,29,27,.45)`, transformOrigin: "top right" }}>
        <div role="tablist" aria-label="Period" style={{ display: "grid", gridTemplateColumns: `repeat(${modes.length},minmax(0,1fr))`, gap: 3, padding: 3, marginBottom: 12, borderRadius: 12, backgroundColor: M.divider }}>
          {modes.map(([k, l]) => {
            const on = mode === k;
            return <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { if (!on) onMode(k); }} style={{ height: 30, border: "none", borderRadius: 9, backgroundColor: on ? M.card : "transparent", boxShadow: on ? "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)" : "none", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer" }}>{l}</button>;
          })}
        </div>
        {mode === "day" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            {monthNav(-1)}
            <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, ...TNUM }}>{monthLabel(viewM)}</span>
            {monthNav(1)}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 10px" }}>
            {mode === "year" ? (
              <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, lineHeight: "36px" }}>YEAR</span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", marginLeft: -10 }}>
                {yearNav(-1)}
                <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, ...TNUM }}>{viewYear}</span>
                {yearNav(1)}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: M.muted }}>{mode === "month" ? "Pick a month" : mode === "quarter" ? "Pick a quarter" : "Pick a year"}</span>
          </div>
        )}
        {body}
      </div>
    </>
  );
}

function ViewBar({
  view, canSwitch, onViews, period, months, today, onPeriod, sub, onSub, sticky,
}: { view: DashView; canSwitch: boolean; onViews: () => void; period: Period | null; months: string[]; today: string; onPeriod: (p: Period) => void; sub?: HomeOpsSub; onSub?: (k: HomeOpsSub) => void; sticky: boolean }) {
  const top = useStickyBelowHeader();
  const phone = useResponsiveLayout().mode === "phone";
  const [cal, setCal] = useState(false);
  const closeCal = useCallback(() => setCal(false), []);
  const label = DASHBOARD_VIEWS.find((v) => v.key === view)?.label ?? "Dashboard";
  const ViewIcon = VIEW_ICON[view];
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
  const stickyTop = phone ? "env(safe-area-inset-top, 0px)" : top;
  return (
    <div style={{ position: sticky ? "sticky" : "relative", ...(sticky ? { top: stickyTop } : null), zIndex: 30, margin: "6px 10px 0", padding: "12px 12px 6px", borderRadius: "22px 22px 0 0", background: `linear-gradient(180deg, color-mix(in srgb, ${M.card} 82%, transparent), color-mix(in srgb, ${M.card} 66%, transparent))`, backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)", boxShadow: `inset 0 1px 0 ${M.card}, inset 1px 0 0 color-mix(in srgb, ${M.card} 55%, transparent), inset -1px 0 0 color-mix(in srgb, ${M.card} 55%, transparent)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={onViews} disabled={!canSwitch} aria-haspopup="dialog" aria-label={`Dashboard: ${label}${canSwitch ? " — switch" : ""}`}
          style={{ ...GLASS_PILL, flex: "none", height: 38, display: "inline-flex", alignItems: "center", gap: 8, padding: canSwitch ? "0 12px 0 6px" : "0 14px 0 6px", borderRadius: 999, border: "none", fontFamily: "inherit", cursor: canSwitch ? "pointer" : "default", color: M.raisin, WebkitTapHighlightColor: "transparent" }}>
          <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", background: ON_GRADIENT, boxShadow: "inset 0 1px 0 rgba(255,255,255,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}><ViewIcon size={14} strokeWidth={2.2} color="#FFFFFF" /></span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
          {canSwitch ? <ChevronDown size={16} strokeWidth={2.2} color={M.taupe} aria-hidden="true" /> : null}
        </button>
        <span style={{ flex: 1 }} />
        {period ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {arrow("prev", prev)}
            <button type="button" onClick={() => setCal((v) => !v)} aria-haspopup="dialog" aria-expanded={cal} aria-label={`Choose period: ${dayView ? opsPeriodLabel(period) : widgetPeriodLabel(period)}`}
              style={{ ...GLASS_PILL, height: 38, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 13px", borderRadius: 999, border: "none", color: M.raisin, fontFamily: "inherit", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
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
      {cal && period ? <PeriodCalendar period={period} months={months} today={today} modes={modes} mode={mode} onMode={(k) => onPeriod(pickMode(period, k))} onPick={(p) => { onPeriod(p); setCal(false); }} onClose={closeCal} /> : null}
    </div>
  );
}

// Dashboard picker: 2-column tiles (Home Sales v12). The list is the repo's own (what the role may open); the repo's
// unbuilt OCR entry is left out of the picker, as in the design, but its ?view=ocr link still resolves.
function ViewsSheet({ open, allowed, current, onPick, onClose }: { open: boolean; allowed: DashView[]; current: DashView | null; onPick: (v: DashView) => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <SheetFrame open title="Dashboard" sub="Choose which dashboard to view" onClose={onClose}>
      <div role="radiogroup" aria-label="Dashboard" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 4 }}>
        {DASHBOARD_VIEWS.filter((v) => v.key !== "ocr" && allowed.includes(v.key)).map((v) => {
          const Icon = VIEW_ICON[v.key];
          const on = v.key === current;
          return (
            <button key={v.key} type="button" role="radio" aria-checked={on} onClick={() => onPick(v.key)}
              style={{ position: "relative", overflow: "hidden", minWidth: 0, display: "flex", alignItems: "center", gap: 10, minHeight: 58, padding: "10px 12px", border: "none", borderRadius: 16, background: on ? `linear-gradient(160deg, ${M.card}, color-mix(in srgb, ${M.card} 70%, transparent))` : `color-mix(in srgb, ${M.card} ${v.built ? 75 : 45}%, transparent)`, boxShadow: on ? "inset 0 0 0 1.5px #6B5C32, 0 10px 22px -14px rgba(107,92,50,.45)" : "inset 0 0 0 1px rgba(201,169,97,.2)", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <span aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: v.built ? ON_GRADIENT : M.divider, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={16} strokeWidth={2.1} color={v.built ? "#FFFFFF" : M.faint} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: v.built ? M.raisin : M.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.label}</span>
                {!v.built ? <span style={{ fontSize: 11, fontWeight: 600, color: M.faint }}>Coming soon</span> : null}
              </span>
              {on ? <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", backgroundColor: "#6B5C32", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 8px -3px rgba(107,92,50,.8)" }}><Check size={12} strokeWidth={3} color="#FFFFFF" aria-hidden="true" /></span> : null}
            </button>
          );
        })}
      </div>
      <SheetNote>Only dashboards your role can open are listed.</SheetNote>
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Today's problems (desktop rules: use-problem-tiles.ts, the same tiles as the desktop strip)
// ---------------------------------------------------------------------------
// "Bad" tiles use the bright red in both themes (the tone's own dark red is dim on a dark card).
const toneValue = (t: Tile) => (t.tone === "bad" ? "#DC2626" : TONE[t.tone].value === "#1F1D1B" ? M.raisin : TONE[t.tone].value);
const PROBLEM_LINES: Record<string, [string, string]> = { overdue: ["Production", "orders overdue"], overdueSets: ["Customer sets", "overdue"], svc: ["Service cases", "overdue"] };
const problemLines = (t: Tile): [string, string] => {
  const fixed = PROBLEM_LINES[t.key];
  if (fixed) return fixed;
  const [a, ...r] = t.label.split(" · ");
  return [a, r.join(" · ")];
};

function ProblemsSection({ tiles, onTap }: { tiles: Tile[]; onTap: (t: Tile) => void }) {
  const wide = useResponsiveLayout().mode !== "phone";
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Today's problems" style={{ padding: "14px 10px 14px" }}>
      <div style={{ paddingBottom: 10 }}><Label style={{ whiteSpace: "nowrap" }}>TODAY’S PROBLEMS</Label></div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${wide ? Math.min(tiles.length, 4) : 2},minmax(0,1fr))`, gridAutoRows: "1fr", gap: 8 }}>
        {tiles.map((p) => {
          const [t1, t2] = problemLines(p);
          const bar = TONE[p.tone].bar;
          return (
            <button key={p.key} type="button" onClick={() => onTap(p)} aria-label={`${p.value} ${p.label}${p.hint ? `, ${p.hint}` : ""}`}
              style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 5, boxSizing: "border-box", padding: "8px 6px 8px 6px", borderRadius: 14, border: "none", background: `linear-gradient(160deg, ${M.card} 0%, color-mix(in srgb, ${bar} 5%, ${M.card}) 100%)`, boxShadow: `inset 0 3px 0 ${bar}, inset 0 0 0 1px color-mix(in srgb, ${bar} 32%, transparent), 0 1px 2px rgba(31,29,27,.05), 0 10px 22px -14px rgba(31,29,27,.30)`, fontFamily: "inherit", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}>
              <span style={{ flex: "none", width: 44, textAlign: "center", fontSize: 20, fontWeight: 800, lineHeight: "26px", letterSpacing: -1, color: toneValue(p), ...TNUM }}>{p.value}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 30, lineHeight: "15px", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis" }}>{t1}</span>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: M.ink, overflow: "hidden", textOverflow: "ellipsis" }}>{t2}</span>
              </span>
              <span aria-hidden="true" style={{ width: 18, height: 18, flex: "none", borderRadius: "50%", backgroundColor: M.divider, display: "flex", alignItems: "center", justifyContent: "center", color: M.taupe }}><ArrowUpRight size={10} strokeWidth={2.4} /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// "Not in" and "Efficiency" are computed from attendance and job-card data that no /m screen lists, so the tile
// explains itself instead of faking a list.
function ProblemSheet({ tile, onClose, onOpen, isNavAllowed }: { tile: Tile; onClose: () => void; onOpen: (to: string) => void; isNavAllowed: (h: string) => boolean }) {
  const d = problemDest(tile.key);
  const blockedRoute = d.kind === "route";
  const canEmployees = isNavAllowed("/employees");
  return (
    <SheetFrame open title={tile.label} sub={tile.hint} onClose={onClose}>
      <SheetCard pad="14px 16px">
        <div style={{ fontSize: 22, fontWeight: 700, color: toneValue(tile), ...TNUM }}>{tile.value}</div>
        <div style={{ fontSize: 13, color: M.ink, lineHeight: 1.5, marginTop: 6 }}>
          {blockedRoute
            ? `Your role can't open ${d.where} on mobile, so the list behind this number is not available here.`
            : `The detailed ${d.where.toLowerCase()} list is part of the desktop dashboard and is not on mobile yet. The Employees list shows people, not today’s attendance or efficiency.`}
        </div>
      </SheetCard>
      {!blockedRoute && canEmployees ? (
        <button type="button" onClick={() => onOpen("/m/employees")} style={{ marginTop: 12, width: "100%", height: 44, border: "none", borderRadius: 12, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Open Employees</button>
      ) : null}
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasPermission, isNavAllowed, dashboardTabs } = usePermissions();
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
  // The "Not in" tile bumps this to open the attendance log (Employees view).
  const [logSignal, setLogSignal] = useState(0);
  // "Not in" from another view: switch to Employees on the tile's day first, then ask for the log once Employees is on screen
  // (a bump before it mounts would be read as the starting value and open nothing).
  const [logWant, setLogWant] = useState(false);
  // The day the tile was computed for (the Employees drill reads that day, whatever period is in view), and the Efficiency drill's request.
  const [drillDate, setDrillDate] = useState("");
  const [effSignal, setEffSignal] = useState(0);
  const [effWant, setEffWant] = useState(false);
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
  // Malaysia date, the clock the server uses for "today" (not the phone's own zone).
  const today = todayYmdMY();
  // No fetch runs off an unresolved period (the month list has not loaded yet).
  const data = useSalesData(periodKey, { ...access, view: access.view && ready });

  // Service cases overdue is not shown on the phone Home (owner 2026-11-20); the desktop strip keeps it.
  const tiles = useProblemTiles(allowed).filter((t) => t.key !== "svc");
  const [viewsOpen, setViewsOpen] = useState(false);
  const [problem, setProblem] = useState<Tile | null>(null);
  // A tile that scrolls to a card: once the card is in the page (after the view and the data have rendered) go to it.
  // The card a tile wants to scroll to; dropped after 8 s so a card that never renders (no access, feed failed) cannot leave it pending.
  const scrollTo = useRef<{ id: string; until: number } | null>(null);
  const goToCard = (id: string): boolean => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.style.scrollMarginTop = "80px";
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  };
  useEffect(() => {
    const want = scrollTo.current;
    if (want && (goToCard(want.id) || Date.now() > want.until)) scrollTo.current = null;
  });
  useEffect(() => {
    if (!(logWant && onPeople && peopleView)) return;
    // A timer, not requestAnimationFrame: frames do not run while the tab is in the background, so the drill would open late.
    // eslint-disable-next-line no-restricted-syntax -- one-shot deferral inside an effect (defers the setState past the commit)
    const id = window.setTimeout(() => { setLogSignal((n) => n + 1); setLogWant(false); }, 0);
    return () => window.clearTimeout(id);
  }, [logWant, onPeople, peopleView]);
  useEffect(() => {
    if (!(effWant && onPeople && peopleView)) return;
    // A timer, not requestAnimationFrame: frames do not run while the tab is in the background, so the drill would open late.
    // eslint-disable-next-line no-restricted-syntax -- one-shot deferral inside an effect (defers the setState past the commit)
    const id = window.setTimeout(() => { setEffSignal((n) => n + 1); setEffWant(false); }, 0);
    return () => window.clearTimeout(id);
  }, [effWant, onPeople, peopleView]);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const closeViews = useCallback(() => setViewsOpen(false), []);
  const closeProblem = useCallback(() => setProblem(null), []);

  const setView = (v: DashView) => {
    setParams((prev) => { const n = new URLSearchParams(prev); n.set("view", v); return n; });
    setViewsOpen(false);
  };
  const onTile = (t: Tile) => {
    // On Operations the overdue tile scrolls to the list behind its number (as on the desktop), not away from the dashboard.
    if (t.key === "overdue" && onOps && opsView) {
      if (opsSub === "overview" && goToCard("ops-overdue")) return;
      scrollTo.current = { id: "ops-overdue", until: Date.now() + 8000 };
      setSub("overview");
      return;
    }
    // Customer sets overdue: the Sales card behind the number (scroll to it, switching to Sales first when needed).
    if (t.key === "overdueSets" && allowed.includes("sales")) {
      if (onSales && goToCard("sales-overdue-sets")) return;
      scrollTo.current = { id: "sales-overdue-sets", until: Date.now() + 8000 };
      if (!onSales) setView("sales");
      return;
    }
    // Not in: the Employees attendance log for the tile's own day (same roster rule as the tile: headcount workers, not
    // outsourced, who have ever clocked in). Period and view change in ONE URL update, so Back returns to where you were.
    if (t.key === "absent" && t.date && allowed.includes("people") && peopleView) {
      setParams((prev) => { const n = writePeriod(prev, { mode: "monthly", month: t.date!.slice(0, 7), day: t.date }); n.set("view", "people"); return n; });
      setDrillDate(t.date);
      setLogWant(true);
      return;
    }
    // Efficiency: workers under 75% on the tile's day (Employees > Efficiency drill; same rule as the tile).
    if (t.key === "eff" && t.date && allowed.includes("people") && peopleView) {
      setDrillDate(t.date);
      if (!onPeople) setParams((prev) => { const n = new URLSearchParams(prev); n.set("view", "people"); return n; });
      setEffWant(true);
      return;
    }
    const d = problemDest(t.key);
    if (d.kind === "route" && isNavAllowed(d.navGate)) navigate(d.to);
    else setProblem(t);
  };
  const refresh = () => { data.refresh(); setRefreshedAt(new Date()); };
  const firstAllowed = allowed[0];
  const firstLabel = DASHBOARD_VIEWS.find((v) => v.key === firstAllowed)?.label ?? "";

  return (
    <HomeTop>
      {/* Home v10 sets no line-height (browser `normal`); the /m shell inherits 1.5. Scoped to this screen's content. */}
      <div style={{ lineHeight: "normal" }}>
      {/* Today's problems: restored for Home Sales v12 (owner 2026-11-20, supersedes the 2026-11-11 removal). */}
      <ProblemsSection tiles={tiles} onTap={onTile} />
      <ViewBar
        sticky={view !== "sales"}
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
              <FloorLivePhone period={period} today={today} onPeriodChange={setPeriod} />
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
          <EmpView access={peopleAccess} period={period} today={today} logSignal={logSignal} drill={{ logDate: drillDate, effSignal, effDate: drillDate }} />
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
      {problem ? <ProblemSheet tile={problem} onClose={closeProblem} onOpen={(to) => { setProblem(null); navigate(to); }} isNavAllowed={isNavAllowed} /> : null}
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
