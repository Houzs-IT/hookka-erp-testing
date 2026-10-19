// DashboardScreen — the /m/dashboard/:tab shell: header (back + period chip),
// a tab DROPDOWN (native <select>: one 44px row and the OS picker, instead of a
// six-pill strip stacked on each tab's own sub-tab pills), and the active tab
// from TAB_REGISTRY. It owns nothing
// tab-specific: tabs, their data and their states live behind the registry.
//
// URL: tab in the path (/m/dashboard/sales), period in the query string
// (?mode=ytd&month=2026-07&day=2026-07-12 — same scheme as the desktop page).
// Tab changes push history (Back walks tabs); period changes replace it.
import { useCallback } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { usePermissions } from "@/lib/use-permission";
import { MobileHeader } from "../../components";
import { useStickyBelowHeader } from "../../lib/header-geometry";
import { M } from "../../theme";
import { DASHBOARD_NAV_HREF, MOBILE_TABS, isMobileTab, type MobileTabKey } from "./dashboard-m-lib";
import { useDashboardFeed, useDashboardPeriod } from "./hooks";
import { PeriodChip } from "./PeriodChip";
import { MState } from "./primitives";
import { TAB_REGISTRY } from "./registry";
import { TONE, useProblemTiles } from "../../../dashboards/use-problem-tiles";
import { quarterOfPeriod, type Period } from "../../../dashboards/dashboard-shared-lib";

export function DashboardScreen() {
  const { tab } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { isNavAllowed, dashboardTabs, loading: permsLoading } = usePermissions();
  // Tab-restricted role (role-policy.ts DASHBOARD_TABS_BY_ROLE): only its tabs
  // are offered, a bare /m/dashboard lands on the first, and any other tab
  // reached by URL shows "Under maintenance". Same rule as the desktop page.
  const tabs = dashboardTabs ? MOBILE_TABS.filter((t) => dashboardTabs.includes(t.key)) : MOBILE_TABS;
  const landing = tabs[0]?.key ?? "sales";
  const { feed, months } = useDashboardFeed();
  // Newest day that carries data: the period sheet anchors its presets to it.
  const latestDay = (feed?.sales?.byDay ?? []).reduce((m, d) => (d.date > m ? d.date : m), "");
  const { period: rawPeriod, setPeriod } = useDashboardPeriod(months, tab);
  const stickyTop = useStickyBelowHeader();
  // Only Employees has a Day view (same rule as the desktop page): elsewhere a
  // picked day, or a range that is not a calendar quarter, reads as its month.
  const dayTab = tab === "people";
  const period: Period = dayTab
    ? rawPeriod
    : rawPeriod.mode === "range" && !quarterOfPeriod(rawPeriod)
      ? { mode: "monthly", month: rawPeriod.month }
      : rawPeriod.day ? { ...rawPeriod, day: undefined } : rawPeriod;
  // "Today's problems" — the same four tiles as the desktop strip.
  const problems = useProblemTiles(tabs.map((t) => t.key));

  const openTab = useCallback(
    (key: MobileTabKey) => navigate(`/m/dashboard/${key}${search}`),
    [navigate, search],
  );

  // Wait for the permission set (first visit only; it is cached after), so a
  // restricted role never lands on, or fetches for, a tab it may not see.
  if (permsLoading) return null;
  if (!isMobileTab(tab)) return <Navigate to={`/m/dashboard/${landing}${search}`} replace />;
  const blocked = !tabs.some((t) => t.key === tab);

  if (!isNavAllowed(DASHBOARD_NAV_HREF)) {
    return (
      <>
        <MobileHeader title="Dashboard" onBack={() => navigate("/m/more")} menu />
        <MState kind="empty" text="Your role doesn't have access to the dashboard." />
      </>
    );
  }

  const Tab = TAB_REGISTRY[tab];
  return (
    <>
      <MobileHeader
        title="Dashboard"
        onBack={() => navigate("/m/more")}
        menu
        trailing={<PeriodChip period={period} months={months} latestDay={latestDay} onChange={setPeriod} allowDay={dayTab} />}
      />
      {/* Sticky under the MobileHeader, like SubTabs. */}
      <div style={{ position: "sticky", top: stickyTop, zIndex: 30, padding: "8px 12px", backgroundColor: M.paper, borderBottom: `1px solid ${M.border}` }}>
        <select
          aria-label="Dashboard section"
          value={tab}
          onChange={(e) => openTab(e.target.value as MobileTabKey)}
          style={{
            width: "100%", minHeight: 44, padding: "0 12px", borderRadius: 11, border: `1px solid ${M.hairline}`,
            // 16px: iOS Safari zooms the whole page when a control under 16px takes focus.
            backgroundColor: M.card, color: M.raisin, fontSize: 16, fontWeight: 700,
          }}
        >
          {blocked && <option value={tab} disabled>Choose a section</option>}
          {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      {problems.length > 0 && (
        <div role="list" aria-label="Today's problems" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 12px 2px", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {problems.map((p) => (
            <button
              key={p.key}
              role="listitem"
              type="button"
              onClick={() => openTab(p.tab as MobileTabKey)}
              style={{
                flex: "0 0 auto", minWidth: 132, maxWidth: 170, textAlign: "left", padding: "9px 11px", borderRadius: 13,
                border: `1px solid ${M.hairline}`, borderTop: `3px solid ${TONE[p.tone].bar}`, backgroundColor: M.card, cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div style={{ fontSize: 19, fontWeight: 800, color: TONE[p.tone].value, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{p.value}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</div>
              {p.hint && <div style={{ fontSize: 10.5, color: M.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.hint}</div>}
            </button>
          ))}
        </div>
      )}
      {blocked ? (
        <MState kind="empty" text="Under maintenance" />
      ) : (
        <Tab period={period} setPeriod={setPeriod} months={months} openTab={openTab} />
      )}
    </>
  );
}
