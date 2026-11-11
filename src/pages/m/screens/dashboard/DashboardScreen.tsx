// DashboardScreen — the /m/dashboard/:tab shell: header (back + period chip),
// the section strip (Sales · Operations · Employees · Service · OCR,
// the desktop's tabs; it replaced a dropdown 2026-10-23), the active tab's own
// sub-page pills, and the active tab from TAB_REGISTRY. It owns nothing
// tab-specific: tabs, their data and their states live behind the registry.
//
// URL: tab in the path (/m/dashboard/sales), period in the query string
// (?mode=ytd&month=2026-07&day=2026-07-12 — same scheme as the desktop page).
// Tab changes push history (Back walks tabs); period changes replace it.
import { useCallback } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { usePermissions } from "@/lib/use-permission";
import { MobileHeader } from "../../components";
import { M } from "../../theme";
import { DASHBOARD_NAV_HREF, MOBILE_TABS, isMobileTab, type MobileTabKey } from "./dashboard-m-lib";
import { useDashboardFeed, useDashboardPeriod } from "./hooks";
import { PeriodChip } from "./PeriodChip";
import { MState } from "./primitives";
import { TAB_REGISTRY } from "./registry";
import { quarterOfPeriod, type Period } from "../../../dashboards/dashboard-shared-lib";

/**
 * The dashboard itself — section strip and the active tab (no problem tiles — owner 2026-11-11) —
 * shared by /m/dashboard/:tab and the phone Home (owner 2026-10-24: "Home 应该
 * 要有全部各种各样的 dashboard"), so both show the same figures. `tab` and
 * `openTab` come from the caller: the URL on the dashboard page, local state
 * on Home. `showPeriod` renders the period chip in the strip row (Home has no
 * MobileHeader to carry it).
 */
export function DashboardBody({ tab, openTab, stickyTop, showPeriod = false }: {
  tab: MobileTabKey;
  openTab: (key: MobileTabKey) => void;
  stickyTop: number;
  showPeriod?: boolean;
}) {
  const { dashboardTabs } = usePermissions();
  const tabs = dashboardTabs ? MOBILE_TABS.filter((t) => dashboardTabs.includes(t.key)) : MOBILE_TABS;
  const { feed, months } = useDashboardFeed();
  // Newest day that carries data: the period sheet anchors its presets to it.
  const latestDay = (feed?.sales?.byDay ?? []).reduce((m, d) => (d.date > m ? d.date : m), "");
  const { period: rawPeriod, setPeriod } = useDashboardPeriod(months, tab);
  // Day view on Employees and Operations (same rule as the desktop page):
  // elsewhere a picked day reads as its month, and outside Employees a range
  // that is not a calendar quarter reads as its month.
  const dayTab = tab === "people" || tab === "operations";
  const period: Period = tab === "people"
    ? rawPeriod
    : rawPeriod.mode === "range" && !quarterOfPeriod(rawPeriod)
      ? { mode: "monthly", month: rawPeriod.month }
      : rawPeriod.day && !dayTab ? { ...rawPeriod, day: undefined } : rawPeriod;

  const blocked = !tabs.some((t) => t.key === tab);
  const Tab = TAB_REGISTRY[tab];
  const chip = <PeriodChip period={period} months={months} latestDay={latestDay} onChange={setPeriod} allowDay={dayTab} />;
  return (
    <>
      <div style={{ position: "sticky", top: stickyTop, zIndex: 30, padding: "8px 12px", backgroundColor: M.paper, borderBottom: `1px solid ${M.border}` }}>
        {showPeriod && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>{chip}</div>}
        {/* The section strip, like the desktop's Sales · Operations · … tabs
            (owner 2026-10-23: the dropdown hid them). Scrolls sideways on a
            narrow phone; the active one scrolls into view. */}
        <div role="tablist" aria-label="Dashboard section" style={{ display: "flex", gap: 4, overflowX: "auto", padding: 3, borderRadius: 12, border: `1px solid ${M.hairline}`, backgroundColor: M.card, scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {blocked && <span style={{ alignSelf: "center", padding: "0 8px", fontSize: 12, color: M.muted, whiteSpace: "nowrap" }}>Choose a section</span>}
          {tabs.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={on}
                ref={on ? (el) => el?.scrollIntoView?.({ block: "nearest", inline: "center" }) : undefined}
                onClick={() => openTab(t.key)}
                style={{
                  flexShrink: 0, minHeight: 38, padding: "6px 13px", borderRadius: 9, whiteSpace: "nowrap",
                  border: `1px solid ${on ? M.taupe : "transparent"}`, backgroundColor: on ? "#FFFFFF" : "transparent",
                  color: on ? M.raisin : M.muted, fontSize: 12.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
                  boxShadow: on ? "0 1px 2px rgba(0,0,0,0.06)" : undefined, cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Today's problems removed from the phone dashboard (owner 2026-11-11:
          the tiles crowded every tab on a narrow screen; desktop keeps them). */}
      {blocked ? (
        <MState kind="empty" text="Under maintenance" />
      ) : (
        <Tab period={period} setPeriod={setPeriod} months={months} openTab={openTab} />
      )}
    </>
  );
}

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
  const { period: rawPeriod, setPeriod } = useDashboardPeriod(months, tab);
  const dayTab = tab === "people" || tab === "operations";
  const period: Period = tab === "people"
    ? rawPeriod
    : rawPeriod.mode === "range" && !quarterOfPeriod(rawPeriod)
      ? { mode: "monthly", month: rawPeriod.month }
      : rawPeriod.day && !dayTab ? { ...rawPeriod, day: undefined } : rawPeriod;
  const latestDay = (feed?.sales?.byDay ?? []).reduce((m, d) => (d.date > m ? d.date : m), "");

  const openTab = useCallback(
    (key: MobileTabKey) => navigate(`/m/dashboard/${key}${search}`),
    [navigate, search],
  );

  // Wait for the permission set (first visit only; it is cached after), so a
  // restricted role never lands on, or fetches for, a tab it may not see.
  if (permsLoading) return null;
  if (!isMobileTab(tab)) return <Navigate to={`/m/dashboard/${landing}${search}`} replace />;

  if (!isNavAllowed(DASHBOARD_NAV_HREF)) {
    return (
      <>
        <MobileHeader title="Dashboard" onBack={() => navigate("/m/more")} />
        <MState kind="empty" text="Your role doesn't have access to the dashboard." />
      </>
    );
  }

  return (
    <>
      <MobileHeader
        title="Dashboard"
        onBack={() => navigate("/m/more")}
        trailing={<PeriodChip period={period} months={months} latestDay={latestDay} onChange={setPeriod} allowDay={dayTab} />}
      />
      {/* Sticky under the MobileHeader (minHeight 52), like SubTabs. */}
      <DashboardBody tab={tab} openTab={openTab} stickyTop={52} />
    </>
  );
}
