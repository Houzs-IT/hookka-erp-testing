// BottomTabBar — fixed 5-slot bottom navigation for the phone shell.
//
// Owner 2026-10-12 (phone nav shell), Products added 2026-10-13: 5 equal flat tabs
//   Home · Sales · Products · Delivery · Procurement.
// The raised centre "More" button is gone; every other module is reached from
// the left NavDrawer (hamburger in the header).
//   • Active tab = taupe icon+label (stroke 2.2, weight 700); inactive = muted
//     #A89F8D. A route that is not a tab destination lights no tab.
// Centered to the phone content width.
import { useLocation, useNavigate } from "react-router-dom";
import { M, M_MAX_WIDTH } from "../theme";
import { TABS, activeTabFor } from "../nav";

export function BottomTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = activeTabFor(pathname);

  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: "flex",
        justifyContent: "center",
        backgroundColor: M.card,
        borderTop: `1px solid ${M.border}`,
        boxShadow: "0 -2px 12px rgba(31,29,27,0.06)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: M_MAX_WIDTH,
          display: "flex",
          alignItems: "stretch",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {TABS.map((t) => {
          const isActive = t.key === active;
          const Icon = t.icon;
          // Design source: active = taupe; inactive = #A89F8D.
          const color = isActive ? M.taupe : "#A89F8D";
          return (
            <button
              key={t.key}
              onClick={() => navigate(t.path)}
              aria-label={t.label}
              aria-current={isActive ? "page" : undefined}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                minHeight: 56,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 2px 6px",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Icon size={23} strokeWidth={isActive ? 2.2 : 1.75} color={color} />
              <span
                style={{
                  maxWidth: "100%",
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 500,
                  color,
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
      </div>
    </nav>
  );
}
