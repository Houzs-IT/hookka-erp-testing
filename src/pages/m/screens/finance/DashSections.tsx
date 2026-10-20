// ---------------------------------------------------------------------------
// The Finance Dashboard's other five sections on the phone (owner 2026-10-19,
// asked why the phone showed only two: 「要」 — bring them over): Production
// Salary, Non-Production Salary, Cost Structure, Balance Sheet and Financial
// Ratios. Each card shows the desktop card's figures for the month the Income
// Statement card shows (the latest with actual figures), read from the same
// /api/accounting/dashboard payload and worked out by the same code
// (src/lib/finance-dashboard-calc.ts) — the phone never has numbers of its own.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  csAmount, csCategories, csForecastAmt, csForecastSales, csLineProdRev, csLineSales, pctOf, salaryCardMonth,
  type CsLine, type CsMeasure, type DashCalcRow,
} from "@/lib/finance-dashboard-calc";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { dashMonthLabel, fmtMoney } from "./m-finance-lib";

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
};

const RED = "#9A3A2D";
const tick = { fontSize: 11, fill: "#4B5563" };
const compact = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
};
const money = (sen: number | null) => (sen === null ? "-" : fmtMoney(sen));
const pct2 = (v: number | null) => (v === null ? "-" : `${v.toFixed(2)}%`);
/** "% of sales / % of production", the desktop's pair. */
const pctPair = (p: number | null, pp: number | null) => (p === null && pp === null ? "" : `${pct2(p)} / ${pct2(pp)}`);

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>{title}</span>
      {sub && <span style={{ fontSize: 11.5, color: M.muted, textAlign: "right" }}>{sub}</span>}
    </div>
  );
}

/** One figure line: label left, amount right, a small note under the amount. */
function Line2({ label, value, note, bold, first, tone, test }: {
  label: ReactNode; value: string; note?: string; bold?: boolean; first?: boolean; tone?: string; test?: string;
}) {
  return (
    <div data-m-fin={test} style={{ display: "flex", justifyContent: "space-between", gap: 10, minHeight: 36, alignItems: "center", padding: "4px 0", borderTop: first ? "none" : `1px solid ${M.hairline}`, fontSize: 14, color: M.raisin, fontWeight: bold ? 700 : 400 }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: tone }}>
        {value}
        {note && <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: M.muted }}>{note}</span>}
      </span>
    </div>
  );
}

/** The last four months as bars, the forecast (if any) as a dashed line — the Income Statement card's chart. */
function MiniTrend({ points }: { points: { label: string; actual: number | null; forecast?: number | null; partial: boolean }[] }) {
  return (
    <div style={{ height: 140, marginTop: 10 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#EEF1F5" />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={{ stroke: "#CBD5E1" }} tickLine={false} tickFormatter={compact} width={38} />
          <Bar dataKey="actual" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
            {points.map((d) => <Cell key={d.label} fill={d.partial ? "#5AA49B" : "#B8D8D3"} />)}
          </Bar>
          {points.some((p) => p.forecast !== null && p.forecast !== undefined) && (
            <Line dataKey="forecast" stroke="#C0392B" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: "#FFFFFF" }} connectNulls isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const lastFour = (rows: DashFullRow[], at: number) => rows.slice(Math.max(0, at - 3), at + 1);
const shortLabel = (r: DashFullRow) => `${dashMonthLabel(r.key, false)}${r.partial ? "*" : ""}`;

/**
 * A salary card — the desktop SalaryDeptCard for one month. `fallbackLabour`:
 * the production card falls back to the P&L labour bucket where a month has no
 * department figure; the non-production card never borrows (shows "-").
 */
export function SalaryCard({ title, note, rows, at, depts, fallbackLabour, denominators, test }: {
  title: string; note: string; rows: DashFullRow[]; at: number; depts: string[];
  fallbackLabour: boolean; denominators: boolean; test: string;
}) {
  const monthOf = (r: DashFullRow) =>
    salaryCardMonth(r, depts, fallbackLabour ? { amount: r.actual?.labour ?? null, forecast: r.forecast?.labour ?? null } : null);
  const last = rows[at];
  const m = monthOf(last);
  const sales = last.actual?.sales ?? null;
  const fcSales = last.forecast?.sales ?? null;
  const prod = last.productionRevenue?.total ?? null;
  const gap = m.amount !== null && m.forecast !== null ? { sen: m.amount - m.forecast, bad: m.amount > m.forecast } : null;
  // RM / head and RM / unit divide the P&L labour bucket, as the desktop table does.
  const labour = last.actual?.labour ?? null;
  const headcount = last.labourBase?.headcount ?? null;
  const units = last.labourBase?.unitsCompleted ?? null;
  const per = (base: number | null) => (labour !== null && base !== null && base > 0 ? Math.round(labour / base) : null);
  const shown = m.byDept.filter((d) => d.amount !== null || d.forecast !== null);
  return (
    <MobileCard>
      <CardTitle title={`${title} · ${dashMonthLabel(last.key, true)}`} sub="RM · % of sales / % of production" />
      <div style={{ fontSize: 11.5, color: M.muted, marginTop: 4 }}>{note}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span data-m-fin={`${test}-total`} style={{ fontSize: 24, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{money(m.amount)}</span>
        {gap && (
          <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 9px", background: gap.bad ? "#FBEDEC" : "#EEF5E9", color: gap.bad ? RED : "#27500A", fontVariantNumeric: "tabular-nums" }}>
            {gap.sen > 0 ? "+" : "−"}{fmtMoney(Math.abs(gap.sen))} vs fcst
          </span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: M.muted }}>
        <span>{pctPair(pctOf(m.amount, sales), pctOf(m.amount, prod))}</span>
        <span>{m.forecast === null ? "" : `Forecast ${fmtMoney(m.forecast)}${pctOf(m.forecast, fcSales) === null ? "" : ` · ${pct2(pctOf(m.forecast, fcSales))}`}`}</span>
      </div>
      <MiniTrend
        points={lastFour(rows, at).map((r) => {
          const x = monthOf(r);
          return { label: shortLabel(r), actual: x.amount === null ? null : x.amount / 100, forecast: x.forecast === null ? null : x.forecast / 100, partial: r.partial };
        })}
      />
      <div style={{ marginTop: 6 }}>
        {shown.map((d, i) => (
          <Line2
            key={d.dept}
            first={i === 0}
            test={`${test}-dept`}
            label={d.dept}
            value={money(d.amount)}
            note={[pctPair(pctOf(d.amount, sales), pctOf(d.amount, prod)), d.forecast === null ? "" : `fcst ${fmtMoney(d.forecast)}`].filter(Boolean).join(" · ")}
          />
        ))}
        {denominators && (
          <>
            <Line2 label="Headcount" value={headcount === null ? "-" : String(headcount)} tone="#3E6570" />
            <Line2 label="RM / head" value={money(per(headcount))} tone="#3E6570" />
            <Line2 label="Units completed" value={units === null ? "-" : String(units)} tone="#4F7C3A" />
            <Line2 label="RM / unit" value={money(per(units))} tone="#4F7C3A" />
          </>
        )}
      </div>
      {denominators && (
        <div style={{ fontSize: 11.5, color: RED, marginTop: 6 }}>
          ⚠ RM / unit uses completed-batch quantities, which run high — so this cost runs low. RM / head is unaffected.
        </div>
      )}
    </MobileCard>
  );
}

const CS_MEASURES: { key: CsMeasure; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "purchase", label: "Purchase" },
  { key: "closing", label: "Closing Stock" },
];
const CS_LINES: { key: CsLine; label: string }[] = [
  { key: "all", label: "All" },
  { key: "bedframe", label: "Bedframe" },
  { key: "sofa", label: "Sofa" },
];
const selectBox = { display: "flex", alignItems: "center", gap: 6, minHeight: 40, padding: "0 10px", border: `1px solid ${M.border}`, borderRadius: 12, background: "#F7F8FA", flex: 1 } as const;
const selectEl = { flex: 1, minHeight: 38, border: "none", background: "transparent", fontSize: 14, fontWeight: 600, color: M.raisin, minWidth: 0 } as const;

/** Cost Structure — the desktop card's table for one month, every material with its share of sales / of production. */
export function CostStructureCard({ rows, at }: { rows: DashFullRow[]; at: number }) {
  const [measure, setMeasure] = useState<CsMeasure>("spend");
  const [line, setLine] = useState<CsLine>("all");
  const last = rows[at];
  const cats = csCategories(rows);
  const sales = csLineSales(last, line);
  const prod = csLineProdRev(last, line);
  const fcSales = csForecastSales(last, line);
  // The desktop table's rule for each material and for the TOTAL row (every
  // material, not only the ones shown; the plan for all of them).
  let sum = 0;
  let fcSum: number | null = null;
  const lines: { cat: string; amt: number; fc: number | null; pct: number | null; ppct: number | null; fcPct: number | null }[] = [];
  for (const cat of cats) {
    const amt = csAmount(last, cat, measure, line);
    const fc = measure === "spend" ? csForecastAmt(last, cat, line) : null; // the plan is spend-side
    sum += amt;
    if (fc !== null) fcSum = (fcSum ?? 0) + fc;
    lines.push({
      cat, amt, fc,
      pct: sales > 0 ? Math.round((amt / sales) * 10000) / 100 : null,
      ppct: pctOf(amt, prod),
      fcPct: fc !== null && fcSales !== null && fcSales > 0 ? Math.round((fc / fcSales) * 10000) / 100 : null,
    });
  }
  return (
    <MobileCard>
      <CardTitle title={`Cost Structure · ${dashMonthLabel(last.key, true)}`} sub="RM · % of sales / % of production" />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <label style={selectBox}>
          <select aria-label="Cost structure measure" value={measure} onChange={(e) => setMeasure(e.target.value as CsMeasure)} style={selectEl}>
            {CS_MEASURES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <label style={selectBox}>
          <select aria-label="Cost structure product line" value={line} onChange={(e) => setLine(e.target.value as CsLine)} style={selectEl}>
            {CS_LINES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <Line2 first label="Sales revenue" value={fmtMoney(sales)} bold note={fcSales === null ? undefined : `fcst ${fmtMoney(fcSales)}`} />
        <Line2 label="Production revenue" value={money(prod)} bold />
        {/* A material with nothing this month (and no plan) is left out — the TOTAL counts every one. */}
        {lines.filter((l) => l.amt !== 0 || l.fc !== null).map((l) => (
          <Line2
            key={l.cat}
            test="dash-cs-line"
            label={l.cat}
            value={l.amt === 0 ? "-" : fmtMoney(l.amt)}
            note={[l.amt === 0 ? "" : pctPair(l.pct, l.ppct), l.fc === null ? "" : `fcst ${fmtMoney(l.fc)}${l.fcPct === null ? "" : ` · ${pct2(l.fcPct)}`}`].filter(Boolean).join(" · ")}
          />
        ))}
        <Line2
          test="dash-cs-total"
          label="TOTAL"
          bold
          value={fmtMoney(sum)}
          note={[pctPair(pctOf(sum, sales), pctOf(sum, prod)), fcSum === null ? "" : `fcst ${fmtMoney(fcSum)}${pctOf(fcSum, fcSales) === null ? "" : ` · ${pct2(pctOf(fcSum, fcSales))}`}`].filter(Boolean).join(" · ")}
        />
      </div>
    </MobileCard>
  );
}

/** Balance Sheet — the month-end totals the desktop card charts. */
export function BalanceSheetCard({ rows, at }: { rows: DashFullRow[]; at: number }) {
  const last = rows[at];
  const bs = last.balanceSheet ?? null;
  const debt = last.ratios?.debtToAssetPct ?? null;
  const trend = lastFour(rows, at).filter((r) => r.balanceSheet);
  return (
    <MobileCard>
      <CardTitle title={`Balance Sheet · ${dashMonthLabel(last.key, true)}`} sub="RM, month end" />
      {!bs ? (
        <div style={{ fontSize: 13, color: M.muted, marginTop: 8 }}>Balances start at the opening date — nothing before it.</div>
      ) : (
        <>
          <div style={{ marginTop: 8 }}>
            <Line2 first test="dash-bs-assets" label="Total assets" value={fmtMoney(bs.assets)} bold />
            <Line2 test="dash-bs-liabilities" label="Total liabilities" value={fmtMoney(bs.liabilities)} />
            <Line2 label="Equity" value={fmtMoney(bs.equity)} />
            <Line2 label="Debt to assets" value={pct2(debt)} tone={RED} />
          </div>
          <MiniTrend points={trend.map((r) => ({ label: shortLabel(r), actual: r.balanceSheet!.assets / 100, forecast: r.balanceSheet!.liabilities / 100, partial: r.partial }))} />
          <div style={{ fontSize: 11.5, color: M.muted }}>Bars: total assets · dashed line: total liabilities.</div>
        </>
      )}
    </MobileCard>
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

/** Financial Ratios — the desktop card's six tabs as one list for the month. */
export function RatiosCard({ rows, at }: { rows: DashFullRow[]; at: number }) {
  const last = rows[at];
  return (
    <MobileCard>
      <CardTitle title={`Financial Ratios · ${dashMonthLabel(last.key, true)}`} />
      <div style={{ marginTop: 8 }}>
        {RATIOS.map((r, i) => {
          const v = last.ratios?.[r.key] ?? null;
          return (
            <Line2
              key={r.key}
              first={i === 0}
              test="dash-ratio"
              label={r.label}
              value={v === null ? "-" : `${v.toFixed(2)}${r.pct ? "%" : ""}`}
              tone={v !== null && v < 0 ? RED : undefined}
            />
          );
        })}
      </div>
    </MobileCard>
  );
}
