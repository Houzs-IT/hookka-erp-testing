// working-hours-print.ts — the Working Hours "Print" report (HK-0125 Phase 2, step 1 of the "..." menu). Pure.
//
// Same report as desktop's Working Hours tab (employees.tsx `handlePrint` -> shared `printReport`): title "Working Hours",
// a filter line, three cards (Total Hours / Workers / Entries) and ONE table row per ENTRY (Employee, Department, Category,
// Hours, Notes; a Date column when more than one day can appear). It prints EVERY entry matching the active date, employee
// search and department filters — not just the first five cards on screen. With a department filter on, only that
// department's entries print (desktop filters per entry); the day total on a card is never what is printed.
import type { YmdRange } from "./employees-dates";
import { applyFilters, type WhFilters, type WhRow } from "./working-hours-model";

export type PrintSpec = {
  title: string;
  filterSummary: string;
  orientation: "portrait";
  cards: { label: string; value: string }[];
  columns: { header: string; align?: "right" }[];
  /** One string per column, same order as `columns`. */
  rows: string[][];
  entries: number;
};

/** 13/11/2026 — desktop's `formatDateDMY`. */
export function dmy(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd;
}

/** The period the report covers: the picked work date, else the whole month window the list is showing. */
export function printPeriod(filters: WhFilters, window: YmdRange): string {
  if (filters.date) return dmy(filters.date);
  return window.from === window.to ? dmy(window.from) : `${dmy(window.from)} – ${dmy(window.to)}`;
}

export function buildWorkingHoursPrint(input: {
  rows: readonly WhRow[];
  filters: WhFilters;
  window: YmdRange;
  deptName: (code: string) => string;
}): PrintSpec {
  const { filters } = input;
  const multiDay = !filters.date;
  const matching = applyFilters(input.rows, filters);

  const body: string[][] = [];
  let totalHours = 0;
  const workers = new Set<string>();
  for (const r of matching) {
    for (const s of r.segs) {
      if (filters.dept && s.deptCode !== filters.dept) continue;
      const h = Number(s.hours) || 0;
      totalHours += h;
      workers.add(r.workerId);
      const cells = [r.name, s.deptName || input.deptName(s.deptCode), s.category || "—", `${h.toFixed(1)}h`, s.notes || ""];
      body.push(multiDay ? [dmy(r.date), ...cells] : cells);
    }
  }

  const parts = [printPeriod(filters, input.window)];
  if (filters.dept) parts.push(`Department: ${input.deptName(filters.dept)}`);
  if (filters.q.trim()) parts.push(`Search: "${filters.q.trim()}"`);

  const columns: PrintSpec["columns"] = [
    ...(multiDay ? [{ header: "Date" }] : []),
    { header: "Employee" },
    { header: "Department" },
    { header: "Category" },
    { header: "Hours", align: "right" as const },
    { header: "Notes" },
  ];

  return {
    title: "Working Hours",
    filterSummary: parts.join(" · "),
    orientation: "portrait",
    cards: [
      { label: "Total Hours", value: `${totalHours.toFixed(1)}h` },
      { label: "Workers", value: String(workers.size) },
      { label: "Entries", value: String(body.length) },
    ],
    columns,
    rows: body,
    entries: body.length,
  };
}
