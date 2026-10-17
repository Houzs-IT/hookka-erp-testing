// ---------------------------------------------------------------------------
// /m/finance and /m/finance/:screen — the phone's Finance app (finance v2,
// design "Hookka Reports Mobile"). The menu lists only the rows the role may
// open (the desktop gates, owner 2026-10-14: no permission = no row) and only
// screens the phone has; a screen the role may not open says so instead of
// rendering (the API would refuse it anyway). Every screen is read-only and
// backs out to this menu.
// ---------------------------------------------------------------------------
import { type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { MobileHeader, MobileCard } from "../../components";
import { M } from "../../theme";
import { usePermissions } from "@/lib/use-permission";
import { allowedFinanceMenu, financeRowFor, type FinanceScreen } from "../../finance-menu";
import { FinanceNoAccess, FinanceNote, FinanceSectionLabel } from "./finance-shell";
import { AgingScreen } from "./AgingScreen";
import { OverviewScreen } from "./OverviewScreen";
import { PlScreen } from "./PlScreen";
import { CashFlowScreen } from "./CashFlowScreen";
import { BalanceSheetScreen } from "./BalanceSheetScreen";
import { DashScreen } from "./DashScreen";
import { CashScreen } from "./CashScreen";

// The screens the phone has so far; the menu shows these only.
const SCREENS: Partial<Record<FinanceScreen, () => ReactNode>> = {
  dashboard: () => <DashScreen />,
  cash: () => <CashScreen />,
  overview: () => <OverviewScreen />,
  pl: () => <PlScreen />,
  cashflow: () => <CashFlowScreen />,
  bs: () => <BalanceSheetScreen />,
  debtors: () => <AgingScreen side="debtor" />,
  creditors: () => <AgingScreen side="creditor" />,
};

export default function FinanceRoute() {
  const { screen } = useParams();
  const navigate = useNavigate();
  const { isNavAllowed } = usePermissions();

  if (screen) {
    const row = financeRowFor(screen, isNavAllowed);
    if (!row) return <FinanceNoAccess title="Finance" />;
    const render = SCREENS[row.screen];
    if (!render) return <FinanceNoAccess title={row.label} note="Not on the phone yet — open it on the desktop." />;
    return <>{render()}</>;
  }

  const menu = allowedFinanceMenu(isNavAllowed)
    .map((s) => ({ ...s, rows: s.rows.filter((r) => !!SCREENS[r.screen]) }))
    .filter((s) => s.rows.length > 0);
  return (
    <>
      <MobileHeader title="Finance" onBack={() => navigate("/m/more")} />
      <div style={{ padding: "6px 14px 24px" }}>
        {menu.length === 0 && <FinanceNote>No finance pages for your role.</FinanceNote>}
        {menu.map((section) => (
          <section key={section.title}>
            <FinanceSectionLabel>{section.title}</FinanceSectionLabel>
            <MobileCard padded={false} radius={16}>
              {section.rows.map((r, i) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.screen}
                    type="button"
                    onClick={() => navigate(`/m/finance/${r.screen}`)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      minHeight: 50,
                      padding: "13px 15px",
                      background: "none",
                      border: "none",
                      borderBottom: i === section.rows.length - 1 ? "none" : `1px solid ${M.divider}`,
                      cursor: "pointer",
                      textAlign: "left",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <Icon size={19} color={M.taupe} strokeWidth={1.8} />
                    <span style={{ flex: 1, fontSize: 15, color: M.raisin }}>{r.label}</span>
                    <ChevronRight size={18} color={M.faint} />
                  </button>
                );
              })}
            </MobileCard>
          </section>
        ))}
      </div>
    </>
  );
}
