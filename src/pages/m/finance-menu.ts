// ---------------------------------------------------------------------------
// The phone's Finance menu (finance v2, design "Hookka Reports Mobile"):
// three sections, each row a read-only screen under /m/finance/:screen, gated
// exactly like its desktop page (owner 2026-10-14: no permission = no row; a
// deep link without permission shows "No access" and the API still denies).
// ---------------------------------------------------------------------------
import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, ChartColumn, FileCheck2, FileSpreadsheet, HandCoins, Landmark, LayoutDashboard, Receipt, Scale } from "lucide-react";

export type FinanceScreen = "dashboard" | "cash" | "overview" | "pl" | "cashflow" | "bs" | "debtors" | "creditors" | "vouchers";

/** `sub`, `c` (icon colour) and `bg` (tile) are the Batch 3 prototype's menu row. */
export type FinanceRow = { screen: FinanceScreen; label: string; sub: string; icon: LucideIcon; c: string; bg: string; navGate: string };

export const FINANCE_MENU: { title: string; rows: FinanceRow[] }[] = [
  {
    title: "Finance",
    rows: [
      { screen: "dashboard", label: "Finance Dashboard", sub: "Income, salary, cost, cash and ratios", icon: LayoutDashboard, c: "#6B5C32", bg: "#F4EFE6", navGate: "/finance-dashboard" },
      { screen: "cash", label: "Daily Cash Position", sub: "What's in the bank today", icon: Landmark, c: "#2B5797", bg: "#E3EAF5", navGate: "/accounting?tab=dailycash" },
    ],
  },
  {
    title: "Reports",
    rows: [
      { screen: "overview", label: "Overview", sub: "Sales, profit and cost trends", icon: ChartColumn, c: "#1F9E89", bg: "#DDF1EC", navGate: "/accounting?tab=overview" },
      { screen: "pl", label: "P&L", sub: "Profit and loss statement", icon: FileSpreadsheet, c: "#6B4A6D", bg: "#F1E9F0", navGate: "/accounting?tab=pl" },
      { screen: "cashflow", label: "Cash Flow", sub: "Money in and out by month", icon: ArrowLeftRight, c: "#3E6570", bg: "#E0EDF0", navGate: "/accounting?tab=cashflow" },
      { screen: "bs", label: "Balance Sheet", sub: "Assets, liabilities and equity", icon: Scale, c: "#85600F", bg: "#FAEFCB", navGate: "/accounting?tab=bs" },
    ],
  },
  {
    title: "Debtors & Creditors",
    rows: [
      { screen: "debtors", label: "Debtor Aging", sub: "Who owes us, by month", icon: HandCoins, c: "#4F7C3A", bg: "#EEF3E4", navGate: "/accounting?tab=ar" },
      { screen: "creditors", label: "Creditor Aging", sub: "What we owe, by month", icon: Receipt, c: "#9A3A2D", bg: "#FBE7E3", navGate: "/accounting?tab=ap" },
    ],
  },
  {
    // The one screen that is not read-only: scan a bill into a draft voucher and walk it along the approval steps.
    title: "Payments",
    rows: [{ screen: "vouchers", label: "Payment Vouchers", sub: "Prepare, check and approve", icon: FileCheck2, c: "#6B5C32", bg: "#F4EFE6", navGate: "/accounting?tab=payments" }],
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
