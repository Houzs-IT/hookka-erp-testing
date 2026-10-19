// ---------------------------------------------------------------------------
// The phone's Finance menu (finance v2, design "Hookka Reports Mobile"):
// three sections, each row a read-only screen under /m/finance/:screen, gated
// exactly like its desktop page (owner 2026-10-14: no permission = no row; a
// deep link without permission shows "No access" and the API still denies).
// ---------------------------------------------------------------------------
import type { LucideIcon } from "lucide-react";
import { BarChart3, Landmark, LayoutGrid, TrendingUp, ArrowDownUp, Scale, HandCoins, Receipt } from "lucide-react";

export type FinanceScreen = "dashboard" | "cash" | "overview" | "pl" | "cashflow" | "bs" | "debtors" | "creditors";

export type FinanceRow = { screen: FinanceScreen; label: string; icon: LucideIcon; navGate: string };

export const FINANCE_MENU: { title: string; rows: FinanceRow[] }[] = [
  {
    title: "Finance",
    rows: [
      { screen: "dashboard", label: "Finance Dashboard", icon: BarChart3, navGate: "/finance-dashboard" },
      { screen: "cash", label: "Daily Cash Position", icon: Landmark, navGate: "/accounting?tab=dailycash" },
    ],
  },
  {
    title: "Reports",
    rows: [
      { screen: "overview", label: "Overview", icon: LayoutGrid, navGate: "/accounting?tab=overview" },
      { screen: "pl", label: "P&L", icon: TrendingUp, navGate: "/accounting?tab=pl" },
      { screen: "cashflow", label: "Cash Flow", icon: ArrowDownUp, navGate: "/accounting?tab=cashflow" },
      { screen: "bs", label: "Balance Sheet", icon: Scale, navGate: "/accounting?tab=bs" },
    ],
  },
  {
    title: "Debtors & Creditors",
    rows: [
      { screen: "debtors", label: "Debtor Aging", icon: HandCoins, navGate: "/accounting?tab=ar" },
      { screen: "creditors", label: "Creditor Aging", icon: Receipt, navGate: "/accounting?tab=ap" },
    ],
  },
];

/** The menu as a role sees it: allowed rows only, empty sections dropped. */
export function allowedFinanceMenu(isAllowed: (href: string) => boolean) {
  return FINANCE_MENU.map((s) => ({ ...s, rows: s.rows.filter((r) => isAllowed(r.navGate)) })).filter((s) => s.rows.length > 0);
}

/** Every gate in the menu — the More row shows when any one is allowed. */
export const FINANCE_NAV_GATES: string[] = FINANCE_MENU.flatMap((s) => s.rows.map((r) => r.navGate));

/** Whether More shows the Finance row at all. */
export function anyFinanceAllowed(isAllowed: (href: string) => boolean): boolean {
  return FINANCE_MENU.some((s) => s.rows.some((r) => isAllowed(r.navGate)));
}

/** The row for a screen slug, if it exists and the role may open it. */
export function financeRowFor(screen: string | undefined, isAllowed: (href: string) => boolean): FinanceRow | null {
  for (const s of FINANCE_MENU) for (const r of s.rows) if (r.screen === screen) return isAllowed(r.navGate) ? r : null;
  return null;
}
