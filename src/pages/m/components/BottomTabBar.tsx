// BottomTabBar — floating glass 5-slot navigation for the phone shell.
//
// Owner 2026-10-12 (phone nav shell), Products added 2026-10-13: 5 equal flat tabs
//   Home · Sales · Products · Delivery · Procurement.
// Every other module is reached from the left NavDrawer (hamburger in the header).
//
// 2026-11-27: restyled to the floating glass pill (design_handoff_bottom_bar_glass,
// Style B). The pill floats M_TAB_BAR.bottom px above the safe-area inset; page
// content and every ResponsiveActionDock derive their clearance from M_TAB_BAR,
// so change the numbers there, not here.
//   • Active tab = 46×30 taupe-gradient capsule, white icon (stroke 2.2),
//     taupe label 700. Inactive = no capsule, --m-nav-inactive icon (1.8) + label 600.
//   • A route that is not a tab destination lights no tab.
// Phone only (MobileLayout renders it when layout.hasBottomNavigation); tablets
// keep the LeftRail. Width is capped at 560px and centred.
import { useLocation, useNavigate } from "react-router-dom";
import { M_TAB_BAR } from "../lib/tab-bar";
import { TABS, activeTabFor } from "../nav";

const ACTIVE_BG = "linear-gradient(145deg, #A08C5B, #6B5C32)";
const ACTIVE_SHADOW = "inset 0 1px 0 rgba(255,255,255,.25), 0 6px 14px -6px rgba(107,92,50,.7)";
const PILL_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,.4), 0 0 0 1px rgba(201,169,97,.22), 0 18px 36px -14px rgba(31,29,27,.45)";

export function BottomTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = activeTabFor(pathname);

  return (
    <nav
      aria-label="Main"
      className="m-tabbar-pill"
      style={{
        position: "fixed",
        left: `calc(${M_TAB_BAR.side} + env(safe-area-inset-left, 0px))`,
        right: `calc(${M_TAB_BAR.side} + env(safe-area-inset-right, 0px))`,
        bottom: M_TAB_BAR.bottom,
        maxWidth: 560,
        marginInline: "auto",
        zIndex: 50,
        height: M_TAB_BAR.height,
        boxSizing: "border-box",
        padding: "5px 6px",
        borderRadius: 24,
        display: "flex",
        alignItems: "center",
        boxShadow: PILL_SHADOW,
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => navigate(t.path)}
            aria-label={t.label}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              height: 54,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              style={{
                width: 46,
                height: 30,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isActive ? ACTIVE_BG : "transparent",
                boxShadow: isActive ? ACTIVE_SHADOW : "none",
                transition: "background-color 160ms ease, box-shadow 160ms ease",
              }}
            >
              <Icon
                size={19}
                strokeWidth={isActive ? 2.2 : 1.8}
                color={isActive ? "#FFFFFF" : "var(--m-nav-inactive)"}
                aria-hidden
              />
            </span>
            <span
              style={{
                maxWidth: "100%",
                // 10.5px from 375px up; shrinks to 9.5px on 320–360px phones so
                // "Procurement" still fits its fifth of the pill.
                fontSize: "clamp(9.5px, 2.8vw, 10.5px)",
                fontWeight: isActive ? 700 : 600,
                color: isActive ? "var(--m-nav-active-label)" : "var(--m-nav-inactive)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
