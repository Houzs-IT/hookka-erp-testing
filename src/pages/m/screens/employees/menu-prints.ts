// menu-prints.ts — the printable reports behind the Employees "..." menu (HK-0125). Pure: rows in, a PrintDoc out.
//
// Each builder mirrors the desktop Employees page's `handlePrint` for the same tab (employees.tsx): the same title, the same
// header and column wording, the same colours and the same "—" rules, over the rows the phone screen already shows (so a
// search / filter on screen is what prints). Money and hours use the shared desktop formatters. A report never carries what its
// screen withholds: Labor Cost's revenue columns print only when `canSeeRevenue` (revenue-figures:read), exactly like desktop.
//
// `runPrintDoc` (run-print.ts) hands a PrintDoc to the shared `printReport`; keeping the two apart keeps these builders testable.
import { formatCurrency, formatHours } from "../../../../lib/utils";
import { dmy } from "./working-hours-print";
import type { EffRow } from "./efficiency-model";
import type { DlRow, CostMode } from "./department-labor-model";
import type { BreakdownRow } from "./employee-performance-model";
import type { DpDaily, DpTotals } from "./department-performance-model";
import type { LcResult, LcRow } from "./labor-cost-model";

export type PrintCellObj = { text: string; bold?: boolean; color?: string; align?: "left" | "right" | "center" };
export type PrintCell = string | number | PrintCellObj;
export type PrintDoc = {
  title: string;
  subtitle?: string;
  filterSummary: string;
  orientation: "portrait" | "landscape";
  /** Tighter table for a very wide report (the Payroll sheet). */
  dense?: boolean;
  cards: { label: string; value: string; color?: string }[];
  sections: {
    title?: string;
    note?: string;
    columns: { header: string; align?: "left" | "right" | "center"; width?: string }[];
    /** One cell per column, same order as `columns`. */
    rows: PrintCell[][];
    emptyText?: string;
  }[];
};

const DASH = "—";
const GREEN = "#15803D";
const AMBER = "#9C6F1E";
const RED = "#9A3A2D";

/** "13/11/2026" for one day, "01/11/2026 – 13/11/2026" for a range (desktop's `dateRangeLabel`). */
export const rangeLabel = (from: string, to: string): string => (from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`);

const hrs = (minutes: number): string => (minutes > 0 ? formatHours(Math.round(minutes)) : DASH);
const catName = (c: string | null | undefined): string => (c ? c.charAt(0) + c.slice(1).toLowerCase() : "");

// ---- Efficiency Overview ----------------------------------------------------------------------------------------------------------

/** Desktop colours for a printed efficiency: green from 100%, amber from 60%, red below. */
export const printEffColor = (pct: number): string => (pct >= 100 ? GREEN : pct >= 60 ? AMBER : RED);

export function efficiencyPrint(rows: readonly EffRow[], range: { from: string; to: string }): PrintDoc {
  const present = rows.filter((r) => r.totalHours > 0).length;
  const totalHrs = rows.reduce((s, r) => s + r.totalHours, 0);
  const effs = rows.map((r) => r.eff).filter((v): v is number => v !== null);
  const avg = effs.length ? effs.reduce((s, v) => s + v, 0) / effs.length : 0;
  return {
    title: "Efficiency Overview",
    filterSummary: rangeLabel(range.from, range.to),
    orientation: "portrait",
    cards: [
      { label: "Workers", value: String(rows.length) },
      { label: "Present", value: `${present} / ${rows.length}` },
      { label: "Total Working Hours", value: `${totalHrs.toFixed(1)}h` },
      { label: "Avg Efficiency", value: `${avg.toFixed(1)}%`, color: printEffColor(avg) },
    ],
    sections: [
      {
        columns: [
          { header: "Employee" },
          { header: "Total", align: "right" },
          { header: "Production Time", align: "right" },
          { header: "Prod Hrs", align: "right" },
          { header: "Non-Prod Hrs", align: "right" },
          { header: "Efficiency %", align: "right" },
          { header: "Days", align: "center" },
        ],
        rows: rows.map((r): PrintCell[] => [
          `${r.empNo ? `${r.empNo} — ` : ""}${r.name}`,
          r.totalHours > 0 ? `${r.totalHours.toFixed(1)}h (${r.days}d)` : DASH,
          r.earnedMin !== null ? hrs(r.earnedMin) : DASH,
          hrs(r.prodHours * 60),
          hrs(r.nonProdHours * 60),
          r.eff === null ? DASH : { text: `${r.eff.toFixed(1)}%`, bold: true, color: printEffColor(r.eff) },
          r.days,
        ]),
      },
    ],
  };
}

// ---- Department Labor ---------------------------------------------------------------------------------------------------------------

export function departmentLaborPrint(input: { rows: readonly DlRow[]; mode: CostMode; range: { from: string; to: string }; category: string }): PrintDoc {
  const { rows, mode } = input;
  const money = mode !== "unavailable";
  const split = mode === "payroll"; // desktop: the Labor (incl. EPF) / Under-recorded split shows for a full finished month, no category
  const sen = (v: number): string => (v > 0 ? formatCurrency(v) : DASH);
  const columns: PrintDoc["sections"][number]["columns"] = [
    { header: "Department" },
    { header: "Total Hours", align: "right" },
    { header: "Workers", align: "center" },
  ];
  if (money) columns.push({ header: "Sofa", align: "right" }, { header: "Bedframe", align: "right" }, { header: "Accessory", align: "right" }, { header: "Category Total", align: "right" });
  if (money && split) columns.push({ header: "Labor (incl. EPF)", align: "right" }, { header: "Under-recorded", align: "right" });
  if (money) columns.push({ header: split ? "Total" : "Estimated Labor Cost", align: "right" });
  return {
    title: "Department Labor",
    filterSummary: `${rangeLabel(input.range.from, input.range.to)} · ${input.category ? catName(input.category) : "All categories"}`,
    orientation: "landscape",
    cards: [],
    sections: [
      {
        columns,
        rows: rows.map((r): PrintCell[] => {
          const cells: PrintCell[] = [`${r.deptName} (${r.isProduction ? "Prod" : "Non-prod"})`, r.totalHours > 0 ? `${r.totalHours.toFixed(1)}h` : DASH, r.workerIds.length > 0 ? r.workerIds.length : DASH];
          if (money) cells.push(sen(r.sofaSen), sen(r.bedframeSen), sen(r.accessorySen), sen(r.catTotalSen));
          if (money && split) cells.push(sen(r.laborSen), sen(r.underSen));
          if (money) cells.push(sen(r.costSen));
          return cells;
        }),
      },
    ],
  };
}

// ---- Employee Performance ----------------------------------------------------------------------------------------------------------------

export function employeePerformancePrint(input: {
  workerLabel: string;
  range: { from: string; to: string };
  /** The six tiles on screen, in order: Hours worked, Non-Production Hours, Extra Production Time, Efficiency, Days Present, Total OT. */
  tiles: readonly { v: string }[];
  effPct: number | null;
  rows: readonly BreakdownRow[];
}): PrintDoc {
  const t = (i: number): string => input.tiles[i]?.v ?? DASH;
  return {
    title: "Employee Performance",
    subtitle: input.workerLabel,
    filterSummary: rangeLabel(input.range.from, input.range.to),
    orientation: "portrait",
    cards: [
      { label: "Production Hrs", value: t(0) },
      { label: "Non-Production Hrs", value: t(1) },
      { label: "Extra Production Time", value: t(2) },
      { label: "Efficiency", value: t(3), color: input.effPct !== null ? printEffColor(input.effPct) : undefined },
      { label: "Days Present", value: t(4) },
      { label: "Total OT", value: t(5) },
    ],
    sections: [
      {
        columns: [
          { header: "Date" },
          { header: "Product / Item" },
          { header: "Completion Date" },
          { header: "Department" },
          { header: "Qty", align: "center" },
          { header: "Total JC Time", align: "right" },
          { header: "Status" },
        ],
        rows: input.rows.map((r): PrintCell[] => [
          dmy(r.date),
          r.primary,
          r.completedDate ? dmy(r.completedDate) : DASH,
          r.dept,
          r.qty && r.qty > 0 ? r.qty : DASH,
          hrs(r.totalMin),
          r.status === "COMPLETED" ? { text: "COMPLETED", color: GREEN, bold: true } : r.statusLabel,
        ]),
      },
    ],
  };
}

// ---- Department Performance ----------------------------------------------------------------------------------------------------------------

const dpColor = (pct: number): string => (pct >= 80 ? "#4F7C3A" : pct >= 60 ? AMBER : RED);

export function departmentPerformancePrint(input: { totals: DpTotals | null; daily: readonly DpDaily[]; range: { from: string; to: string }; deptLabel: string; category: string }): PrintDoc {
  const { totals } = input;
  const avg = totals && totals.workingMinutes > 0 ? totals.efficiencyPct : null;
  const rows: PrintCell[][] = [];
  for (const d of input.daily) {
    const hasHours = d.workingMinutes > 0;
    rows.push([
      { text: dmy(d.date), bold: true },
      { text: hrs(d.workingMinutes), bold: true },
      { text: hrs(d.productionMinutes), bold: true },
      hasHours ? { text: `${d.efficiencyPct.toFixed(1)}%`, bold: true, color: dpColor(d.efficiencyPct) } : { text: DASH, bold: true },
    ]);
    for (const w of d.workers ?? []) {
      rows.push([
        { text: `    ↳ ${w.workerName ?? w.workerId}` },
        { text: hrs(w.workingMinutes) },
        { text: hrs(w.productionMinutes) },
        w.workingMinutes > 0 ? { text: `${w.efficiencyPct.toFixed(1)}%`, color: dpColor(w.efficiencyPct) } : { text: DASH },
      ]);
    }
  }
  return {
    title: "Department Performance",
    filterSummary: `${rangeLabel(input.range.from, input.range.to)} · ${input.deptLabel || "All departments"} · ${input.category ? catName(input.category) : "All categories"}`,
    orientation: "portrait",
    cards: [
      { label: "Workers", value: String(totals?.workerCount ?? 0) },
      { label: "Total Working Hrs", value: totals ? hrs(totals.workingMinutes) : DASH },
      { label: "Total Production Hrs", value: totals ? hrs(totals.productionMinutes) : DASH },
      { label: "Avg Efficiency", value: avg !== null ? `${avg.toFixed(1)}%` : DASH, color: avg !== null ? dpColor(avg) : undefined },
    ],
    sections: [
      {
        columns: [{ header: "Date / Worker" }, { header: "Working Hrs", align: "right" }, { header: "Production Hrs", align: "right" }, { header: "Efficiency %", align: "right" }],
        rows,
      },
    ],
  };
}

// ---- Labor Cost ----------------------------------------------------------------------------------------------------------------------------

/**
 * Desktop prints "Labor Cost vs Revenue": KPI cards + Payroll Reconciliation + Production Breakdown + Under-recorded Hours.
 * The phone prints the cards it can stand behind and the Production Breakdown; the reconciliation and under-recorded sections are
 * desktop-only (the phone does not compute them). Revenue (cards and the two revenue columns) prints only with revenue-figures:read.
 */
export function laborCostPrint(input: { result: LcResult; range: { from: string; to: string }; category: string; canSeeRevenue: boolean }): PrintDoc {
  const { result, canSeeRevenue } = input;
  const ok = result.mode === "ok";
  const money = (sen: number): string => (ok ? formatCurrency(sen) : "Unavailable");
  const sumOver = (pick: (r: LcRow) => boolean): number => result.overhead.filter(pick).reduce((s, r) => s + r.costSen, 0);
  const ratio = (r: LcRow): PrintCell => {
    if (!ok || !r.category || r.revenueSen <= 0) return DASH;
    const pct = (r.costSen / r.revenueSen) * 100;
    return { text: `${pct.toFixed(1)}%`, color: pct >= 35 ? RED : GREEN, bold: true };
  };
  const columns: PrintDoc["sections"][number]["columns"] = [
    { header: "Department" },
    { header: "Category" },
    { header: "Hours", align: "right" },
    { header: "Labor Cost", align: "right" },
  ];
  if (canSeeRevenue) columns.push({ header: "Department Revenue", align: "right" });
  columns.push({ header: "Cost / Revenue", align: "right" });
  return {
    title: "Labor Cost vs Revenue",
    filterSummary: `${rangeLabel(input.range.from, input.range.to)} · ${input.category ? catName(input.category) : "All categories"}`,
    orientation: "landscape",
    cards: [
      { label: "Production Labor Cost", value: money(result.productionSen) },
      { label: "Borrowed (Warehousing)", value: money(sumOver((r) => r.isWarehousing)), color: AMBER },
      { label: "Shortfall", value: money(sumOver((r) => r.isShortfall)), color: RED },
      { label: "Overhead (not in Production Labor Cost)", value: money(result.overheadSen) },
    ],
    sections: [
      {
        title: "Production Breakdown",
        columns,
        rows: result.production.map((r): PrintCell[] => {
          const cells: PrintCell[] = [r.deptName, r.category ? catName(r.category) : DASH, `${r.hours.toFixed(1)}h`, money(r.costSen)];
          if (canSeeRevenue) cells.push(r.category ? formatCurrency(r.revenueSen) : "n/a");
          cells.push(ratio(r));
          return cells;
        }),
        emptyText: "No production labour in the selected period.",
      },
    ],
  };
}
