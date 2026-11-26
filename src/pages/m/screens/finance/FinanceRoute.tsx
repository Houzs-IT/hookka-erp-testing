// ---------------------------------------------------------------------------
// /m/finance and /m/finance/:screen — the phone's Finance app (Batch 3
// prototype "Finance (standalone)"). The menu lists only the rows the role may
// open (the desktop gates, owner 2026-10-14: no permission = no row) and only
// screens the phone has; a screen the role may not open says so instead of
// rendering (the API would refuse it anyway). The report screens read only;
// Payment Vouchers is the one screen that writes (its approval ladder, edit,
// scan-to-draft and documents, gated by the same permissions as the desktop).
// Every screen backs out to this menu.
// ---------------------------------------------------------------------------
import { type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { usePermissions } from "@/lib/use-permission";
import { allowedFinanceMenu, financeRowFor, type FinanceScreen } from "../../finance-menu";
import { SwipeBack } from "./finance-shell";
import { FinLabel, FinMenu, FinScreen, FinState } from "./fin-kit";
import { F } from "./fin-format";
import { AgingScreen } from "./AgingScreen";
import { OverviewScreen } from "./OverviewScreen";
import { PlScreen } from "./PlScreen";
import { CashFlowScreen } from "./CashFlowScreen";
import { BalanceSheetScreen } from "./BalanceSheetScreen";
import { DashScreen } from "./DashScreen";
import { CashScreen } from "./CashScreen";
import { VoucherDetailScreen, VoucherListScreen } from "./VoucherScreens";

const toMenu = "/m/finance";

// The screens the phone has; the menu shows these only.
const SCREENS: Partial<Record<FinanceScreen, (back: () => void) => ReactNode>> = {
  dashboard: () => <DashScreen />,
  cash: () => <CashScreen />,
  overview: () => <OverviewScreen />,
  pl: () => <PlScreen />,
  cashflow: () => <CashFlowScreen />,
  bs: () => <BalanceSheetScreen />,
  debtors: (back) => <AgingScreen side="debtor" onBack={back} />,
  creditors: (back) => <AgingScreen side="creditor" onBack={back} />,
  vouchers: () => <VoucherListScreen />,
};

/** "No access" in the prototype's state card, under a header that backs out. */
export function FinanceNoAccessScreen({ title, note, onBack }: { title: string; note?: string; onBack: () => void }) {
  return (
    <FinScreen title={title} onBack={onBack}>
      <FinState icon={Lock} bg={F.track} c={F.muted} t="No access" s={note ?? "You don't have permission for this page."} />
    </FinScreen>
  );
}

export default function FinanceRoute() {
  const { screen, id } = useParams();
  const navigate = useNavigate();
  const { isNavAllowed } = usePermissions();
  const back = () => navigate(toMenu);

  if (screen) {
    const row = financeRowFor(screen, isNavAllowed);
    if (!row) return <FinanceNoAccessScreen title="Finance" onBack={back} />;
    if (row.screen === "vouchers" && id) return <VoucherDetailScreen id={id} />;
    const render = SCREENS[row.screen];
    if (!render) return <FinanceNoAccessScreen title={row.label} note="Not on the phone yet — open it on the desktop." onBack={back} />;
    // A swipe from the left edge backs out to this menu (the iPhone home-screen app).
    return <SwipeBack onBack={back}>{render(back)}</SwipeBack>;
  }

  const menu = allowedFinanceMenu(isNavAllowed)
    .map((s) => ({ ...s, rows: s.rows.filter((r) => !!SCREENS[r.screen]) }))
    .filter((s) => s.rows.length > 0);
  return (
    <FinScreen title="Finance" menu onBack={() => navigate("/m/more")}>
      {menu.length === 0 ? (
        <FinState icon={Lock} bg={F.track} c={F.muted} t="No finance pages for your role" s="Ask an admin if you need access to Finance." />
      ) : (
        menu.map((section) => [
          <FinLabel key={`${section.title}-l`} l={section.title.toUpperCase()} />,
          <FinMenu
            key={`${section.title}-m`}
            items={section.rows.map((r) => ({ key: r.screen, l: r.label, s: r.sub, icon: r.icon, c: r.c, bg: r.bg, onTap: () => navigate(`${toMenu}/${r.screen}`) }))}
          />,
        ])
      )}
    </FinScreen>
  );
}
