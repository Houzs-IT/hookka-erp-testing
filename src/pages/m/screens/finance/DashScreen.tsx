// ---------------------------------------------------------------------------
// The Finance Dashboard on the phone, as the owner's phone design draws it
// ("Hookka Finance Mobile"; owner 2026-10-20 「手机版的和我之前设计的也有不一
// 样」). Reads the desktop dashboard (/api/accounting/dashboard?granularity=
// month&periods=12) and shows the last four months that have happened (from
// July — the desktop's rule): the Income Statement — one line at a time from
// the Show picker, the chosen month's figure, its pill against the forecast,
// the four months as bars with the forecast as a smooth red dashed line; then
// Production / Non-Production Salary, Cost Structure and Cash Flow as the
// design draws them, and Balance Sheet / Financial Ratios (owner 2026-10-19
// 「要」) in the same look. Tapping a month (a bar, or a row in a month list)
// chooses it for every card; the latest is chosen at first.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { csCategories, pctOf, salaryDeptSplit } from "@/lib/finance-dashboard-calc";
import { FinanceHeader, FinanceNote } from "./finance-shell";
import { MOBILE_DASH_LINES, dashGap, monthName, phoneDashMonths, rmWhole, shortName, type DashLine } from "./m-finance-lib";
import {
  BalanceSheetCard, CashFlowCard, CostStructureCard, DashCard, Kpi, MiniBars, RatiosCard, SalaryCard, ShowSelect,
  type DashFullRow,
} from "./DashSections";

type Slice = Record<DashLine, number>;
type DashRow = DashFullRow & {
  actual: Slice | null;
  forecast: Slice | null;
};

export function DashScreen() {
  const [line, setLine] = useState<DashLine>("sales");
  const [pick, setPick] = useState<number | null>(null);
  const { data: resp, loading, error } = useCachedJson<{ success?: boolean; error?: string; data?: { rows: DashRow[] } }>(
    "/api/accounting/dashboard?granularity=month&periods=12",
  );
  const rows = resp?.success ? resp.data?.rows ?? [] : [];
  // The months shown: the last four that have happened (the rows after the
  // latest are the months ahead that carry only a forecast — BUG-2026-10-17-308).
  const months = phoneDashMonths(rows);
  const sel = pick !== null && pick < months.length ? pick : months.length - 1;
  const last = sel >= 0 ? months[sel] : undefined;
  const failed = !!error || resp?.success === false;
  const label = MOBILE_DASH_LINES.find((l) => l.key === line)?.label ?? line;
  const actual = last?.actual ? last.actual[line] : null;
  const forecast = last?.forecast ? last.forecast[line] : null;
  const gap = dashGap(line, actual, forecast);
  const sales = last?.actual?.sales ?? null;
  // Which of the desktop's other sections have anything to show — its own rules.
  const split = salaryDeptSplit(months);
  const showProdSalary = months.some((r) => (r.actual?.labour ?? null) !== null);
  const showCostStructure = csCategories(months).length > 0;

  return (
    <>
      <FinanceHeader title="Finance Dashboard" />
      <div style={{ padding: "0 0 28px" }}>
        {loading && !resp ? (
          <FinanceNote>Loading…</FinanceNote>
        ) : failed ? (
          <FinanceNote tone="error">{resp?.error || error || "Couldn't load the dashboard."}</FinanceNote>
        ) : !last ? (
          <FinanceNote>No months to show.</FinanceNote>
        ) : (
          <>
            <p style={{ margin: "10px 16px 0", minHeight: 16, fontSize: 11, color: "#9C6F1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {last.partial ? `* ${monthName(last).replace(" *", "")} is still running — figures are so far.` : ""}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px" }}>
              <DashCard title="Income Statement" note="RM · % of sales">
                <ShowSelect caption="Show" label="Income statement line" value={line} options={MOBILE_DASH_LINES} onChange={setLine} />
                <Kpi
                  test="dash-actual"
                  label={`${label} · ${monthName(last)}`}
                  value={rmWhole(actual)}
                  negative={(actual ?? 0) < 0}
                  sub={line === "sales" ? `Production revenue ${rmWhole(last.productionRevenue?.total ?? null)}` : (() => { const p = pctOf(actual, sales); return p === null ? "" : `${p.toFixed(2)}% of sales`; })()}
                  vs={gap ? { text: `${gap.sen > 0 ? "+" : ""}${rmWhole(gap.sen)} vs fcst`, good: !gap.bad, forecast: rmWhole(forecast) } : null}
                />
                <MiniBars
                  labels={months.map(shortName)}
                  values={months.map((r) => (r.actual ? r.actual[line] : null))}
                  forecast={months.map((r) => (r.forecast ? r.forecast[line] : null))}
                  sel={sel}
                  onSel={setPick}
                />
              </DashCard>

              {showProdSalary && (
                <SalaryCard
                  title="Production Salary"
                  note="750-0010 · 0020 · 0030 · 0040"
                  months={months} sel={sel} onSel={setPick} depts={split.prod} fallbackLabour denominators test="dash-sal-prod"
                />
              )}
              {split.non.length > 0 && (
                <SalaryCard
                  title="Non-Production Salary"
                  note="clocked-hours share"
                  months={months} sel={sel} onSel={setPick} depts={split.non} fallbackLabour={false} denominators={false} test="dash-sal-non"
                />
              )}
              {showCostStructure && <CostStructureCard months={months} sel={sel} onSel={setPick} />}
              <CashFlowCard month={last} />
              <BalanceSheetCard month={last} />
              <RatiosCard month={last} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
