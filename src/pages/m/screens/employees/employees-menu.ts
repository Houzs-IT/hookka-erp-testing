// employees-menu.ts — what the Employees "..." menu offers per section (Employees 3.dc.html `openMore`, HK-0125). Pure.
//
// HTML: the bottom sheet is titled "Employees" on Overview and with the section's name elsewhere; its rows are an icon tile and a
// label, no chevron. Item ORDER and LABELS follow the HTML per section (`S.XX.more`). Which items exist was checked against the
// desktop Employees page (owner 2026-11-17):
//   Overview               no menu (owner: the button is removed)
//   Working Hours          Copy yesterday · Copy from another date · Print
//   Attendance             no menu (desktop has no print / export there)
//   Labor Cost             Settle month · Print report            (the standalone "Regenerate payslips" is not offered)
//   Efficiency Overview    Print report
//   Department Labor       Print report · Department QR poster
//   Employee Performance   Print Report                           (the selected employee)
//   Department Performance Print Report · Daily Efficiency (A4)
//   Payroll                Export CSV · Print Report · Calculation Guide   (no Print on the payslip detail)
// A section REGISTERS the items that are ready right now (permission held, data loaded); an item that is not registered is not
// shown, and a section with nothing registered gets no "..." button at all. Employee Master is desktop-only.

export type MenuAction =
  | "copy-yesterday"
  | "copy-from"
  | "print"
  | "settle-month"
  | "qr-poster"
  | "efficiency-a4"
  | "export-csv"
  | "calc-guide";

export type MenuIcon = "CopyPlus" | "Copy" | "Printer" | "Wand" | "QrCode" | "FileText" | "Download";

/** What a section hands the shell for one action. `busy` shows the row greyed with `note` (data still preparing). */
export type MenuEntry = { run: () => void; busy?: boolean; note?: string };
export type MenuRegistry = Partial<Record<MenuAction, MenuEntry>>;

export type MenuItem = { action: MenuAction; label: string; icon: MenuIcon; busy?: boolean; note?: string };

type Def = { action: MenuAction; label: string; icon: MenuIcon };

/** The HTML's order and wording per section. */
export const SECTION_MENU: Record<string, readonly Def[]> = {
  "working-hours": [
    { action: "copy-yesterday", label: "Copy yesterday", icon: "CopyPlus" },
    { action: "copy-from", label: "Copy from another date", icon: "Copy" },
    { action: "print", label: "Print", icon: "Printer" },
  ],
  "labor-cost": [
    { action: "settle-month", label: "Settle month", icon: "Wand" },
    { action: "print", label: "Print report", icon: "Printer" },
  ],
  efficiency: [{ action: "print", label: "Print report", icon: "Printer" }],
  "department-labor": [
    { action: "print", label: "Print report", icon: "Printer" },
    { action: "qr-poster", label: "Department QR poster", icon: "QrCode" },
  ],
  "employee-performance": [{ action: "print", label: "Print Report", icon: "Printer" }],
  "department-performance": [
    { action: "print", label: "Print Report", icon: "Printer" },
    { action: "efficiency-a4", label: "Daily Efficiency (A4)", icon: "FileText" },
  ],
  payroll: [
    { action: "export-csv", label: "Export CSV", icon: "Download" },
    { action: "print", label: "Print Report", icon: "Printer" },
    { action: "calc-guide", label: "Calculation Guide", icon: "Printer" },
  ],
};

/** The rows of the sheet: the section's items, in the HTML's order, that the section has registered. */
export function menuItems(section: string, registry: MenuRegistry): MenuItem[] {
  const out: MenuItem[] = [];
  for (const d of SECTION_MENU[section] ?? []) {
    const e = registry[d.action];
    if (e) out.push({ ...d, busy: e.busy, note: e.note });
  }
  return out;
}

/** "Employees" on Overview, the section's own name elsewhere. */
export function menuTitle(section: string, sectionLabel: string | undefined): string {
  return section === "overview" || !sectionLabel ? "Employees" : sectionLabel;
}

/**
 * The Daily Efficiency Report (A4) URL — desktop's Department Performance button opens it for the "To" date, all departments,
 * ignoring that tab's filters. `workers:read` is the gate the server enforces on it.
 */
export const efficiencyReportUrl = (to: string): string => `/api/reports/efficiency?date=${encodeURIComponent(to)}`;
