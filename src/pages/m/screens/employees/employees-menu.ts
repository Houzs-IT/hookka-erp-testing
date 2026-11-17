// employees-menu.ts — what the Employees "..." menu offers per section (Employees 3.dc.html `openMore`, HK-0125). Pure.
//
// HTML: the bottom sheet is titled "Employees" on Overview and with the section's name elsewhere; its rows are an icon tile
// and a label, no chevron. Item order follows the HTML. Employee Master is NOT offered on the phone (owner 2026-11-16: it is
// desktop-only). A section with no ready item gets NO "..." button at all (menuItems returns []).
//
// Step 1 (owner-approved 2026-11-16) — only items whose destination is READY are offered:
//   Overview      Daily Efficiency Report ONLY (owner 2026-11-16: Departments, Public holidays and Pay rules are desktop-only)
//   Working Hours Print (needs at least one entry to print)
//   Attendance    nothing yet: Print (new content), both Copy actions and every maintenance edit are held for review
// An item that needs a permission is simply not shown without it (the server enforces it as well).

export type MenuAction =
  | "efficiency-report"
  | "print-working-hours";

export type MenuIcon = "FileText" | "Printer";
export type MenuItem = { action: MenuAction; label: string; icon: MenuIcon };

/** What is ready right now (permissions and loaded data). */
export type MenuReady = {
  /** `workers:read` — the Daily Efficiency Report endpoint's gate. */
  canWorkersRead: boolean;
  /** Working Hours has at least one entry matching its filters to print. */
  canPrintWorkingHours: boolean;
};

const EFFICIENCY: MenuItem = { action: "efficiency-report", label: "Daily Efficiency Report", icon: "FileText" };
const PRINT_WH: MenuItem = { action: "print-working-hours", label: "Print", icon: "Printer" };

export function menuItems(section: string, ready: MenuReady): MenuItem[] {
  const items: MenuItem[] = [];
  if (section === "overview") {
    if (ready.canWorkersRead) items.push(EFFICIENCY);
  } else if (section === "working-hours") {
    if (ready.canPrintWorkingHours) items.push(PRINT_WH);
  }
  return items;
}

/** "Employees" on Overview, the section's own name elsewhere. */
export function menuTitle(section: string, sectionLabel: string | undefined): string {
  return section === "overview" || !sectionLabel ? "Employees" : sectionLabel;
}

/**
 * The Daily Efficiency Report URL. NO `date`: the server then uses the previous working day (Sundays and public holidays
 * skipped) — the same default as the Efficiency Overview list, so both name the same day. Desktop passes its "To" date,
 * which defaults to the end of the month.
 */
export const EFFICIENCY_REPORT_URL = "/api/reports/efficiency";
