// ---------------------------------------------------------------------------
// The Finance Dashboard on the phone (Batch 3 prototype "dashB"). Reads the
// desktop dashboard (/api/accounting/dashboard, monthly or by calendar
// quarter) and shows the last four periods that have happened (from July —
// the desktop's rule; the rows after the latest carry only a forecast,
// BUG-2026-10-17-308). Tapping a period chip or a bar chooses it for every
// card; the latest is chosen at first. The Cash Flow and Balance Sheet cards
// add the desktop's forecasts (/cashflow-forecast, /bs-forecast). When the
// server answers with its older copy it stays up with "Updating…" while the
// new figures are fetched (retryStale, src/lib/stale-refresh.ts).
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, CloudOff, LayoutDashboard } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { csCategories, salaryDeptSplit } from "@/lib/finance-dashboard-calc";
import { dashPeriods } from "@/lib/finance-chart-look";
import { bsForecastByBucket, cashForecastByBucket, dashBsForecast, dashCashForecast } from "@/lib/dashboard-forecast";
import type { BsForecastPayload } from "@/lib/forecast-bs";
import type { BsMonthEntry } from "@/lib/bs-monthly";
import type { CfStatementRow } from "@/lib/cashflow-card";
import { dashGap, monthName, phoneDashMonths, shortName, type DashLine } from "./m-finance-lib";
import { FinBanner, FinChips, FinScreen, FinSeg, FinSkel, FinState } from "./fin-kit";
import { F } from "./fin-format";
import { BalanceSheetCard, CashFlowCard, CostStructureCard, IncomeCard, RatiosCard, SalaryCard, type DashFullRow } from "./DashSections";

type DashResp = { success?: boolean; error?: string; data?: { rows: DashFullRow[] } };

export function DashScreen() {
  const navigate = useNavigate();
  const [line, setLine] = useState<DashLine>("sales");
  const [mode, setMode] = useState<"m" | "q">("m");
  const [pick, setPick] = useState<number | null>(null);
  const quarter = mode === "q";
  // retryStale: when the server first answers with its older copy (e.g. right
  // after a Forecast save), keep it up with "Updating…" and ask again until the
  // new figures arrive (owner 2026-11-10; src/lib/stale-refresh.ts).
  const month = useCachedJson<DashResp>(
    "/api/accounting/dashboard?granularity=month&periods=12",
    undefined,
    { retryStale: true },
  );
  const qtr = useCachedJson<DashResp>(quarter ? "/api/accounting/dashboard?granularity=quarter&periods=8" : null, undefined, { retryStale: true });
  const { data: resp, loading, error, updating, refresh } = quarter ? qtr : month;
  const rows = resp?.success ? resp.data?.rows ?? [] : [];
  const monthRows = month.data?.success ? month.data.data?.rows ?? [] : [];
  // The periods shown: the last four that have happened.
  const periods = quarter ? dashPeriods(rows, { span: 12, granularity: "quarter", explicit: false }) : phoneDashMonths(rows);
  const sel = pick !== null && pick < periods.length ? pick : periods.length - 1;
  const last = sel >= 0 ? periods[sel] : undefined;
  const failed = !!error || resp?.success === false;

  const actual = last?.actual ? last.actual[line] : null;
  const forecast = last?.forecast ? last.forecast[line] : null;
  const gap = dashGap(line, actual, forecast);
  // Which of the desktop's other sections have anything to show — its own rules.
  const split = salaryDeptSplit(periods);
  const showProdSalary = periods.some((r) => (r.actual?.labour ?? null) !== null);
  const showCostStructure = csCategories(periods).length > 0;

  // The desktop card's forecasts (read once; a forecast that cannot be read leaves its card without one).
  const { data: cfFc } = useCachedJson<{ success?: boolean; data?: { columns: { key: string }[]; rows: CfStatementRow[] } }>("/api/accounting/cashflow-forecast");
  const { data: bsFc } = useCachedJson<{ success?: boolean; data?: BsForecastPayload }>("/api/accounting/bs-forecast");
  const startYm = bsFc?.success && bsFc.data?.months?.length ? bsFc.data.startYm : null;
  const { data: bsOpen } = useCachedJson<{ success?: boolean; data?: { balanceSheet?: BsMonthEntry[] } }>(startYm ? `/api/accounting/pl?period=${startYm}` : null);
  const gran = quarter ? "quarter" : "month";
  const cashFc = useMemo(() => (cfFc?.success && cfFc.data ? cashForecastByBucket(dashCashForecast(cfFc.data), gran) : {}), [cfFc, gran]);
  const bsFcB = useMemo(
    () => (bsFc?.success && bsFc.data && bsOpen?.success && Array.isArray(bsOpen.data?.balanceSheet) ? bsForecastByBucket(dashBsForecast(bsFc.data, bsOpen.data.balanceSheet), gran) : {}),
    [bsFc, bsOpen, gran],
  );
  // The cost trend sheet lists the months that have happened (up to the last six).
  const trendRows = quarter ? periods : dashPeriods(monthRows, { span: 12, granularity: "month", explicit: false }).slice(-6);

  return (
    <FinScreen title="Finance Dashboard" onBack={() => navigate("/m/finance")}>
      {periods.length > 0 ? (
        <FinChips opts={periods.map((r, i) => ({ k: String(i), l: shortName(r).replace("*", " *") }))} cur={String(sel)} set={(k) => setPick(Number(k))} />
      ) : null}
      <FinSeg opts={[{ k: "m", l: "Monthly" }, { k: "q", l: "Quarterly" }]} cur={mode} set={(k) => { setMode(k); setPick(null); }} aria="Period" />
      {updating ? (
        <div role="status" aria-live="polite" data-testid="m-dash-updating" style={{ fontSize: 11.5, color: F.muted, textAlign: "right", marginTop: -4 }}>Updating…</div>
      ) : null}
      {loading && !resp ? (
        <FinSkel n={4} h={160} />
      ) : failed ? (
        <FinState icon={CloudOff} bg="#FBE7E3" c={F.neg} t="Couldn't load the dashboard." s={resp?.error || "The finance service didn't answer."} btn={{ l: "Try again", onTap: () => refresh() }} />
      ) : !last ? (
        <FinState icon={LayoutDashboard} bg={F.cream} c={F.gold} t="No months to show" s="The dashboard has no period with figures yet." />
      ) : (
        <>
          {last.partial ? <FinBanner tone="info" icon={Clock} t={`${monthName(last).replace(" *", "")} so far.`} s="Figures marked * are for a running period and will change." /> : null}
          <IncomeCard months={periods} sel={sel} onSel={setPick} line={line} setLine={setLine} quarter={quarter} actual={actual} forecast={forecast} gap={gap} />
          {showProdSalary && <SalaryCard title="Production Salary" months={periods} sel={sel} depts={split.prod} production test="dash-sal-prod" />}
          {split.non.length > 0 && <SalaryCard title="Non-Production Salary" months={periods} sel={sel} depts={split.non} production={false} test="dash-sal-non" />}
          {showCostStructure && <CostStructureCard month={last} rows={trendRows} sub={monthName(last)} />}
          <CashFlowCard month={last} forecast={cashFc[last.key] ?? null} onOpen={() => navigate("/m/finance/cashflow")} />
          <BalanceSheetCard month={last} forecast={bsFcB[last.key] ?? null} onOpen={() => navigate("/m/finance/bs")} />
          <RatiosCard month={last} />
        </>
      )}
    </FinScreen>
  );
}
