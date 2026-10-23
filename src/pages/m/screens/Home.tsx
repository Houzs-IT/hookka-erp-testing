// ---------------------------------------------------------------------------
// MobileHome — the /m start page (owner 2026-10-24: "按理我应该要有全部各种各样
// 的 dashboard … delivery、receive、staff 这些都不需要 … 重新排版").
//
// Header (greeting · search · notifications), the install offer, one quick
// action (New SO), then the dashboard itself — DashboardBody, the SAME section
// strip, Today's problems and tabs as /m/dashboard and the desktop merged
// dashboard. The phone used to carry its own KPI grid and analytics cards
// (~2,600 lines) that had drifted from the desktop; rendering the shared body
// means a number on Home is the number on the Dashboard, by construction.
//
// The section picked here is local to Home (it does not change the URL path);
// the period lives in the query string, as on /m/dashboard.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Plus, Search as SearchIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { usePermissions } from "@/lib/use-permission";
import { FormSheet, InstallAppCard } from "../components";
import { GlobalSearchSheet } from "../components/GlobalSearchSheet";
import { M, M_ACCENT } from "../theme";
import { type FormSpec } from "../config/form-types";
import { newSalesOrderSpec } from "../config/forms";
import { DashboardBody } from "./dashboard/DashboardScreen";
import { DASHBOARD_NAV_HREF, MOBILE_TABS, type MobileTabKey } from "./dashboard/dashboard-m-lib";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning,";
  if (h < 18) return "Good afternoon,";
  return "Good evening,";
}

const ROUND_BTN = {
  width: 42,
  height: 42,
  borderRadius: "50%",
  backgroundColor: M.card,
  border: `1px solid ${M.hairline}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
} as const;

export default function MobileHome() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const firstName = (user?.displayName || "there").split(" ")[0];
  const { isNavAllowed, dashboardTabs, loading: permsLoading } = usePermissions();
  const tabs = dashboardTabs ? MOBILE_TABS.filter((t) => dashboardTabs.includes(t.key)) : MOBILE_TABS;
  const [picked, setPicked] = useState<MobileTabKey | null>(null);
  const tab = picked && tabs.some((t) => t.key === picked) ? picked : (tabs[0]?.key ?? "sales");
  const [formSpec, setFormSpec] = useState<FormSpec | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const canDashboard = !permsLoading && isNavAllowed(DASHBOARD_NAV_HREF);

  return (
    <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* ===== Header — brand · greeting · search · notifications ===== */}
      <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: "#1F1D1B", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <span style={{ fontWeight: 800, color: "#fff", fontSize: 19 }}>H</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: M.muted }}>{greeting()}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: M.raisin, letterSpacing: "-0.3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {firstName}
          </div>
        </div>
        <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" style={ROUND_BTN}>
          <SearchIcon size={20} strokeWidth={1.75} color={M.ink} />
        </button>
        <button type="button" aria-label="Notifications" onClick={() => navigate("/m/announcements")} style={ROUND_BTN}>
          <Bell size={20} strokeWidth={1.75} color={M.ink} />
        </button>
      </div>

      <div style={{ padding: "0 16px" }}>
        {/* One-tap install offer (hidden once installed or dismissed). */}
        <InstallAppCard dismissible />
        {/* The one quick action kept (owner: Delivery / Receive / Staff not needed). */}
        <button
          type="button"
          onClick={() => setFormSpec(newSalesOrderSpec())}
          style={{
            marginTop: 12, width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
            borderRadius: 14, border: `1px solid ${M.border}`, backgroundColor: M.card, cursor: "pointer",
            WebkitTapHighlightColor: "transparent", textAlign: "left",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 11, background: M_ACCENT.gold.bg }}>
            <Plus size={20} strokeWidth={1.75} color={M_ACCENT.gold.fg} />
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: M.raisin }}>New sales order</span>
          <ChevronRight size={18} strokeWidth={1.75} color={M.muted} />
        </button>
      </div>

      {/* ===== The dashboard — every section, same as /m/dashboard ===== */}
      <div style={{ marginTop: 12 }}>
        {canDashboard ? (
          <DashboardBody tab={tab} openTab={setPicked} stickyTop={0} showPeriod />
        ) : !permsLoading ? (
          <p style={{ padding: "24px 16px", fontSize: 13, color: M.muted, textAlign: "center" }}>
            Your role doesn't have access to the dashboard.
          </p>
        ) : null}
      </div>

      {/* New SO sheet: on save it closes and opens the new order. */}
      <FormSheet
        open={formSpec != null}
        onClose={() => setFormSpec(null)}
        spec={formSpec}
        onSaved={(to) => {
          setFormSpec(null);
          if (to) navigate(to);
        }}
      />
      <GlobalSearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
