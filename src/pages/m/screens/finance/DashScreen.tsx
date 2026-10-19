// ---------------------------------------------------------------------------
// The Finance Dashboard on the phone (finance v2 mobile, part C). Reads the
// desktop dashboard (/api/accounting/dashboard?granularity=month&periods=12)
// and shows one Income Statement line at a time, picked from a dropdown — the
// desktop card's own tabs (FIN_DASH_LINES, the same list as PL_TABS there):
// the latest month's figure, its forecast and the gap, its % of revenue, and
// the last four months as bars with the forecast as a dashed line. A cash
// card follows with the month's operating / investing / financing flows.
// Since 2026-10-19 (owner 「要」) the desktop's other sections follow in its
// order — Production / Non-Production Salary and Cost Structure before the
// cash card, Balance Sheet and Financial Ratios after it (DashSections.tsx).
// ---------------------------------------------------------------------------
import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileCard } from "../../components";
import { M } from "../../theme";
import { FinanceHeader, FinanceNote } from "./finance-shell";
import { FIN_DASH_LINES, dashAnchorIndex, dashGap, dashMonthLabel, type DashLine, fmtMoney } from "./m-finance-lib";
import { csCategories, salaryDeptSplit } from "@/lib/finance-dashboard-calc";
import { BalanceSheetCard, CostStructureCard, RatiosCard, SalaryCard, type DashFullRow } from "./DashSections";

type Slice = Record<DashLine, number>;
type DashRow = DashFullRow & {
  actual: Slice | null;
  forecast: Slice | null;
  cashFlow: { operating: number; investing: number; financing: number; net: number; freeCashFlow: number };
};

const tick = { fontSize: 11, fill: "#4B5563" };
const compact = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
};

export function DashScreen() {
  const [line, setLine] = useState<DashLine>("sales");
  const { data: resp, loading, error } = useCachedJson<{ success?: boolean; error?: string; data?: { rows: DashRow[] } }>(
    "/api/accounting/dashboard?granularity=month&periods=12",
  );
  const rows = resp?.success ? resp.data?.rows ?? [] : [];
  // The latest month with actual figures — the rows after it are the months
  // ahead that carry only a forecast (BUG-2026-10-17-308).
  const at = dashAnchorIndex(rows);
  const last = at >= 0 ? rows[at] : undefined;
  const monthName = last ? dashMonthLabel(last.key, true) : "";
  const failed = !!error || resp?.success === false;
  const label = FIN_DASH_LINES.find((l) => l.key === line)?.label ?? line;
  const actual = last?.actual ? last.actual[line] : null;
  const forecast = last?.forecast ? last.forecast[line] : null;
  const gap = dashGap(line, actual, forecast);
  const sales = last?.actual?.sales ?? null;
  const pctOfRevenue = actual !== null && sales ? (actual / sales) * 100 : null;
  // Which of the desktop's other sections have anything to show — its own rules.
  const split = salaryDeptSplit(rows);
  const showProdSalary = rows.some((r) => (r.actual?.labour ?? null) !== null);
  const showCostStructure = csCategories(rows).length > 0;
  const chart = rows.slice(Math.max(0, at - 3), at + 1).map((r) => ({
    label: `${dashMonthLabel(r.key, false)}${r.partial ? "*" : ""}`,
    actual: r.actual ? r.actual[line] / 100 : null,
    forecast: r.forecast ? r.forecast[line] / 100 : null,
    partial: r.partial,
  }));

  return (
    <>
      <FinanceHeader title="Finance Dashboard" />
      <div style={{ padding: "12px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && !resp ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{resp?.error || error || "Couldn't load the dashboard."}</FinanceNote>
        ) : !last ? (
          <FinanceNote>No months to show.</FinanceNote>
        ) : (
          <>
            {last.partial && <div style={{ fontSize: 12.5, color: "#7A5B12" }}>* {monthName} is still running — figures are so far.</div>}
            <MobileCard>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>Income Statement</span>
                <span style={{ fontSize: 11.5, color: M.muted }}>RM · % of sales</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, marginTop: 10, padding: "0 12px", border: `1px solid ${M.border}`, borderRadius: 12, background: "#F7F8FA" }}>
                <span style={{ fontSize: 12.5, color: M.muted }}>Show</span>
                <select
                  aria-label="Income statement line"
                  value={line}
                  onChange={(e) => setLine(e.target.value as DashLine)}
                  style={{ flex: 1, minHeight: 42, border: "none", background: "transparent", fontSize: 15, fontWeight: 600, color: M.raisin }}
                >
                  {FIN_DASH_LINES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </label>
              <div style={{ fontSize: 12, color: M.muted, marginTop: 12 }}>{label} · {monthName}{last.partial ? " *" : ""}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span data-m-fin="dash-actual" style={{ fontSize: 26, fontWeight: 700, color: (actual ?? 0) < 0 ? "#9A3A2D" : M.raisin, fontVariantNumeric: "tabular-nums" }}>
                  {actual === null ? "—" : fmtMoney(actual)}
                </span>
                {gap && (
                  <span data-m-fin="dash-gap" style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 9px", background: gap.bad ? "#FBEDEC" : "#EEF5E9", color: gap.bad ? "#9A3A2D" : "#27500A", fontVariantNumeric: "tabular-nums" }}>
                    {gap.sen > 0 ? "+" : "−"}{fmtMoney(Math.abs(gap.sen))} vs fcst
                  </span>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: M.muted }}>
                <span>
                  {line === "sales" && last.productionRevenue ? `Production revenue ${fmtMoney(last.productionRevenue.total)}` : pctOfRevenue !== null && line !== "sales" ? `${pctOfRevenue.toFixed(1)}% of sales` : ""}
                </span>
                <span>{forecast === null ? "" : `Forecast ${fmtMoney(forecast)}`}</span>
              </div>
              <div style={{ height: 170, marginTop: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#EEF1F5" />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                    <YAxis tick={tick} axisLine={{ stroke: "#CBD5E1" }} tickLine={false} tickFormatter={compact} width={38} />
                    <Bar dataKey="actual" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                      {chart.map((d) => <Cell key={d.label} fill={d.partial ? "#5AA49B" : "#B8D8D3"} />)}
                    </Bar>
                    <Line dataKey="forecast" stroke="#C0392B" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: "#FFFFFF" }} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </MobileCard>

            {showProdSalary && (
              <SalaryCard
                title="Production Salary"
                note="750-0010 SALARIES · 750-0020 EPF · 750-0030 SOCSO · 750-0040 EIS"
                rows={rows} at={at} depts={split.prod} fallbackLabour denominators test="dash-sal-prod"
              />
            )}
            {split.non.length > 0 && (
              <SalaryCard
                title="Non-Production Salary"
                note="Warehouse · Repair · Maintenance · Shortfall · R&D — actual = clocked-hours share of payroll"
                rows={rows} at={at} depts={split.non} fallbackLabour={false} denominators={false} test="dash-sal-non"
              />
            )}
            {showCostStructure && <CostStructureCard rows={rows} at={at} />}

            <MobileCard>
              <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>Cash Flow · {monthName}</div>
              {(
                [
                  ["Operating", last.cashFlow.operating],
                  ["Investing", last.cashFlow.investing],
                  ["Financing", last.cashFlow.financing],
                  ["Net change", last.cashFlow.net],
                  ["Free cash flow", last.cashFlow.freeCashFlow],
                ] as const
              ).map(([k, v], i) => (
                <div key={k} data-m-fin={`dash-cf-${k}`} style={{ display: "flex", justifyContent: "space-between", minHeight: 36, alignItems: "center", borderTop: i ? `1px solid ${M.hairline}` : "none", fontWeight: k === "Net change" ? 700 : 400, fontSize: 14, color: M.raisin }}>
                  <span>{k}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: v < 0 ? "#9A3A2D" : undefined }}>{fmtMoney(v)}</span>
                </div>
              ))}
            </MobileCard>

            <BalanceSheetCard rows={rows} at={at} />
            <RatiosCard rows={rows} at={at} />
          </>
        )}
      </div>
    </>
  );
}
