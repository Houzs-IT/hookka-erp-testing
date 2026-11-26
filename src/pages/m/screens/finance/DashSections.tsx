// ---------------------------------------------------------------------------
// The Finance Dashboard's cards on the phone (Batch 3 prototype: dashB /
// costCard / cfSummary). Every figure is the desktop dashboard's, from the
// same /api/accounting/dashboard payload and the same module
// (src/lib/finance-dashboard-calc.ts); the Cash Flow and Balance Sheet
// forecasts are the desktop card's (/cashflow-forecast, /bs-forecast through
// src/lib/dashboard-forecast.ts). The phone has no numbers of its own — the
// kit only draws them.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { ArrowLeftRight, FileSpreadsheet, HardHat, Minus, Percent, PieChart, Scale, TrendingDown, TrendingUp, Users } from "lucide-react";
import {
  csAmount, csCategories, csForecastAmt, csForecastSales, csLineProdRev, csLineSales, pctOf as pctOf2, salaryCardMonth,
  type CsLine, type CsMeasure, type DashCalcRow,
} from "@/lib/finance-dashboard-calc";
import { CS_COLOURS } from "@/lib/finance-chart-look";
import type { DashBsFigures, DashCashFigures } from "@/lib/dashboard-forecast";
import { cfSectionTotals, dashGap, monthName, shareWidths, shortName, MOBILE_DASH_LINES, type DashLine } from "./m-finance-lib";
import { FinCard, FinSheet, type Row } from "./fin-kit";
import { F, barGeometry, rm, rmShort, tile, valColour } from "./fin-format";

/** A dashboard row as the phone reads it (a subset of the endpoint's row). */
export type DashFullRow = DashCalcRow & {
  key: string;
  label: string;
  partial: boolean;
  labourBase?: { headcount: number | null; unitsCompleted: number | null };
  balanceSheet?: { assets: number; liabilities: number; equity: number; currentAssets: number; currentLiabilities: number; inventory: number } | null;
  ratios?: {
    grossMarginPct: number | null; netMarginPct: number | null;
    currentRatio: number | null; quickRatio: number | null;
    debtToAssetPct: number | null; roePct: number | null; roaPct: number | null;
  };
  cashFlow?: { net: number; inflow?: number; outflow?: number; lines?: { label: string; section: string; value: number }[] };
  actual: (Record<DashLine, number> & { sales: number; labour: number }) | null;
  forecast: (Record<DashLine, number> & { sales: number; labour: number }) | null;
};

const p2 = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const GOLDS = ["#6B5C32", "#8B7A4E", "#A08C5B", "#C9A961", "#CDBE98", "#E6DCC7"];
const BLUES = ["#2B5797", "#5B7FB8", "#A9BEDD", "#7E98C2", "#C9D6EA", "#4A6FA8"];

// ---- Income Statement ------------------------------------------------------------
export function IncomeCard({ months, sel, onSel, line, setLine, quarter, actual, forecast, gap }: {
  months: DashFullRow[]; sel: number; onSel: (i: number) => void; line: DashLine; setLine: (l: DashLine) => void; quarter: boolean;
  actual: number | null; forecast: number | null; gap: ReturnType<typeof dashGap>;
}) {
  const last = months[sel];
  const sales = last.actual?.sales ?? null;
  const values = months.map((r) => (r.actual ? r.actual[line] : null));
  const fc = months.map((r) => (r.forecast ? r.forecast[line] : null));
  const geo = barGeometry(values, fc);
  return (
    <FinCard
      test="dash-income"
      title="Income Statement"
      icon={FileSpreadsheet}
      sub={`${quarter ? "Quarter " : ""}${monthName(last)}`}
      chips={{ opts: MOBILE_DASH_LINES.map((l) => ({ k: l.key, l: l.label })), cur: line, set: (k) => setLine(k as DashLine) }}
      val={{
        v: rm(actual),
        c: valColour(actual),
        s: line === "sales" ? `Production revenue ${rm(last.productionRevenue?.total ?? null)}` : `${p2(pctOf2(actual, sales))} of sales`,
        d: gap ? `${gap.sen >= 0 ? "+" : "−"}${rm(Math.abs(gap.sen))} vs forecast ${rm(forecast)}` : undefined,
        dc: gap ? (gap.bad ? F.neg : F.pos) : undefined,
        di: gap ? (gap.sen >= 0 ? TrendingUp : TrendingDown) : undefined,
      }}
      bars={months.map((r, i) => ({
        l: shortName(r),
        sel: i === sel,
        v: rmShort(values[i]),
        vneg: (values[i] ?? 0) < 0,
        h: geo[i].h,
        fh: geo[i].fh,
        c: i === sel ? "linear-gradient(180deg,#8B7A4E,#6B5C32)" : F.sand,
        aria: `${monthName(r)}: ${rm(values[i])}${fc[i] != null ? `, forecast ${rm(fc[i])}` : ""}`,
        onTap: () => onSel(i),
      }))}
      barLegend
    />
  );
}

// ---- Salary ------------------------------------------------------------------------
export function SalaryCard({ title, months, sel, depts, production, test }: {
  title: string; months: DashFullRow[]; sel: number; depts: string[]; production: boolean; test: string;
}) {
  const last = months[sel];
  const m = salaryCardMonth(last, depts, production ? { amount: last.actual?.labour ?? null, forecast: last.forecast?.labour ?? null } : null);
  const sales = last.actual?.sales ?? null;
  const gap = m.amount !== null && m.forecast !== null ? m.amount - m.forecast : null;
  const labour = last.actual?.labour ?? null;
  const per = (base: number | null) => (labour !== null && base !== null && base > 0 ? Math.round(labour / base) : null);
  const head = last.labourBase?.headcount ?? null;
  const units = last.labourBase?.unitsCompleted ?? null;
  const widths = shareWidths(m.byDept.map((d) => d.amount));
  const pal = production ? GOLDS : BLUES;
  return (
    <FinCard
      test={test}
      title={title}
      icon={production ? HardHat : Users}
      sub={monthName(last)}
      val={{
        v: rm(m.amount),
        s: production ? `${p2(pctOf2(m.amount, sales))} of sales · ${p2(pctOf2(m.amount, last.productionRevenue?.total ?? null))} of production` : `${p2(pctOf2(m.amount, sales))} of sales`,
        d: gap === null ? undefined : production ? `${gap <= 0 ? "Under" : "Over"} forecast by ${rm(Math.abs(gap))}` : `${gap <= 0 ? "On or under" : "Over"} forecast`,
        dc: gap === null ? undefined : gap <= 0 ? F.pos : F.neg,
        di: gap === null ? undefined : production ? (gap <= 0 ? TrendingDown : TrendingUp) : Minus,
      }}
      stack={widths.some((w) => w > 0) ? widths.map((w, i) => ({ w, c: pal[i % pal.length] })) : undefined}
      tiles={production ? [
        tile("Headcount", head === null ? "—" : String(head)),
        tile("RM per head", rm(per(head))),
        tile("Units completed", units === null ? "—" : units.toLocaleString("en-MY")),
        tile("RM per unit", rm(per(units))),
      ] : undefined}
      note={production ? "⚠ Units completed run high (double-counted batches), so RM / unit runs low. RM / head is unaffected." : undefined}
    />
  );
}

// ---- Cost Structure ----------------------------------------------------------------------
const MEASURE_WORD: Record<CsMeasure, string> = { spend: "spent on materials", purchase: "purchased", closing: "closing stock" };

/** The cost card (shared with P&L › Cost structure view): measure segment,
 *  line chips, total, share bar, one row per material — a row opens that
 *  material's months. `rows` are the periods the trend sheet lists. */
export function CostStructureCard({ month, rows, sub }: { month: DashFullRow; rows: DashFullRow[]; sub: string }) {
  const [meas, setMeas] = useState<CsMeasure>("spend");
  const [line, setLine] = useState<CsLine>("all");
  const [trend, setTrend] = useState<string | null>(null);
  const cats = csCategories(rows.length ? rows : [month]);
  const amounts = cats.map((c) => csAmount(month, c, meas, line));
  const total = amounts.reduce((s, v) => s + v, 0);
  const widths = shareWidths(amounts);
  let plan: number | null = null;
  if (meas === "spend") for (const c of cats) { const f = csForecastAmt(month, c, line); if (f !== null) plan = (plan ?? 0) + f; }
  const pct = pctOf2(total, csLineSales(month, line));
  const ppct = pctOf2(total, csLineProdRev(month, line));
  const fpct = pctOf2(plan, csForecastSales(month, line));
  const tRows: Row[] = trend
    ? rows.map((r, i) => ({ key: r.key, l: monthName(r), v: rm(csAmount(r, trend, meas, line)), w: 600, bt: i ? undefined : "none" }))
    : [];
  return (
    <>
      <FinCard
        test="dash-cs"
        title="Cost Structure"
        icon={PieChart}
        sub={sub}
        seg={{ opts: [{ k: "spend", l: "Spend" }, { k: "purchase", l: "Purchase" }, { k: "closing", l: "Closing stock" }], cur: meas, set: (k) => setMeas(k as CsMeasure) }}
        chips={{ opts: [{ k: "all", l: "All" }, { k: "bedframe", l: "Bedframe" }, { k: "sofa", l: "Sofa" }], cur: line, set: (k) => setLine(k as CsLine) }}
        val={{
          v: rm(total),
          s: MEASURE_WORD[meas],
          d: meas === "spend" && pct !== null ? `${p2(pct)} of sales · ${p2(ppct)} of production${fpct !== null ? ` · plan ${p2(fpct)}` : ""}` : undefined,
          dc: meas === "spend" && pct !== null && fpct !== null ? (pct > fpct ? F.neg : F.pos) : F.body,
        }}
        stack={widths.some((w) => w > 0) ? widths.map((w, i) => ({ w, c: CS_COLOURS[i % CS_COLOURS.length] })) : undefined}
        rows={cats.length ? cats.map((c, i) => ({
          key: c,
          l: c,
          s: total ? `${((amounts[i] / total) * 100).toFixed(1)}% of total` : "—",
          v: rm(amounts[i]),
          rail: CS_COLOURS[i % CS_COLOURS.length],
          go: true,
          onTap: () => setTrend(c),
        })) : undefined}
        empty={cats.length ? undefined : "No material figures for this period."}
      />
      <FinSheet open={!!trend} onClose={() => setTrend(null)} title={`${trend ?? ""} · trend`} sub={`${rows.length} period${rows.length === 1 ? "" : "s"} · ${MEASURE_WORD[meas]}`}
        rows={tRows.map((r) => ({ key: r.key, l: r.l, v: String(r.v ?? ""), w: 600 }))}
        note="Same figures as the desktop Cost Structure card." />
    </>
  );
}

// ---- Cash Flow ---------------------------------------------------------------------------
const normSection = (s: string) => s.replace(/_/g, " ").trim().toUpperCase();
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

export function CashFlowCard({ month, forecast, onOpen }: { month: DashFullRow; forecast: { pnl?: DashCashFigures; docs?: DashCashFigures } | null; onOpen: () => void }) {
  const [view, setView] = useState<"sum" | "det">("sum");
  const [basis, setBasis] = useState<"pnl" | "docs">("pnl");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const cf = month.cashFlow;
  const net = cf?.net ?? null;
  const sections = cfSectionTotals(cf?.lines);
  const rows: Row[] = [];
  for (const s of sections) {
    const op = view === "det" || !!open[s.name];
    rows.push({ key: s.name, l: s.name, w: 700, v: rm(s.value), vc: valColour(s.value), chev: true, open: op, onTap: () => setOpen((o) => ({ ...o, [s.name]: !op })) });
    if (op) {
      const by = new Map<string, number>();
      for (const l of cf?.lines ?? []) if (sentence(normSection(l.section)) === s.name) by.set(l.label, (by.get(l.label) ?? 0) + l.value);
      for (const [label, v] of by) if (Math.round(v) !== 0) rows.push({ key: `${s.name}/${label}`, l: label, pl: 32, fs: 12.5, w: 500, v: rm(v), vc: valColour(v), vw: 600, mh: 40 });
    }
  }
  const fcNet = forecast?.[basis]?.net ?? null;
  return (
    <FinCard
      test="dash-cf"
      title="Cash Flow"
      icon={ArrowLeftRight}
      sub={monthName(month)}
      seg={{ opts: [{ k: "sum", l: "Summary" }, { k: "det", l: "Detail" }], cur: view, set: (k) => setView(k as "sum" | "det") }}
      chips={{ opts: [{ k: "pnl", l: "Forecast P&L" }, { k: "docs", l: "Open documents" }], cur: basis, set: (k) => setBasis(k as "pnl" | "docs") }}
      tiles={[
        tile("Net change", rm(net), { c: valColour(net), tint: (net ?? 0) < 0 ? "rgba(251,231,227,.9)" : "rgba(238,243,228,.9)", rail: (net ?? 0) < 0 ? F.neg : F.pos, span: 2, s: fcNet === null ? "No forecast for this period" : `Forecast ${rm(fcNet)}` }),
        tile("Cash in", rm(cf?.inflow ?? null), { rail: F.pos }),
        tile("Cash out", cf?.outflow == null ? "—" : rm(-Math.abs(cf.outflow)), { c: F.neg, rail: F.neg }),
      ]}
      rows={rows.length ? rows : undefined}
      btn={{ l: "Open Cash Flow", onTap: onOpen }}
    />
  );
}

// ---- Balance Sheet + Ratios ------------------------------------------------------------------
export function BalanceSheetCard({ month, forecast, onOpen }: { month: DashFullRow; forecast: DashBsFigures | null; onOpen: () => void }) {
  const bs = month.balanceSheet ?? null;
  const debt = month.ratios?.debtToAssetPct ?? null;
  const fcEq = forecast ? forecast.equity ?? forecast.assets - forecast.liabilities : null;
  return (
    <FinCard
      test="dash-bs"
      title="Balance Sheet"
      icon={Scale}
      sub={`As at ${monthName(month)}`}
      tiles={bs ? [
        tile("Total assets", rm(bs.assets), forecast ? { s: `Forecast ${rm(forecast.assets)}` } : {}),
        tile("Total liabilities", rm(bs.liabilities), forecast ? { s: `Forecast ${rm(forecast.liabilities)}` } : {}),
        tile("Equity", rm(bs.equity), fcEq !== null ? { c: valColour(bs.equity), s: `Gap ${bs.equity - fcEq >= 0 ? "+" : "−"}${rm(Math.abs(bs.equity - fcEq))}`, sc: bs.equity - fcEq >= 0 ? F.pos : F.neg } : { c: valColour(bs.equity) }),
        tile("Debt to assets", p2(debt), forecast?.debtPct != null ? { s: `Forecast ${p2(forecast.debtPct)}` } : {}),
      ] : undefined}
      empty={bs ? undefined : "Balances start at the opening date — nothing before it."}
      btn={{ l: "Open Balance Sheet", onTap: onOpen }}
    />
  );
}

const RATIOS: { key: keyof NonNullable<DashFullRow["ratios"]>; label: string; pct: boolean }[] = [
  { key: "grossMarginPct", label: "Gross margin", pct: true },
  { key: "netMarginPct", label: "Net margin", pct: true },
  { key: "currentRatio", label: "Current ratio", pct: false },
  { key: "quickRatio", label: "Quick ratio", pct: false },
  { key: "roePct", label: "ROE", pct: true },
  { key: "roaPct", label: "ROA", pct: true },
];

export function RatiosCard({ month }: { month: DashFullRow }) {
  return (
    <FinCard
      test="dash-ratio"
      title="Financial Ratios"
      icon={Percent}
      sub={monthName(month)}
      cols={3}
      tiles={RATIOS.map((r) => {
        const v = month.ratios?.[r.key] ?? null;
        return tile(r.label, v === null ? "—" : r.pct ? `${v.toFixed(1)}%` : v.toFixed(2), { c: v !== null && v < 0 ? F.neg : F.ink });
      })}
    />
  );
}
