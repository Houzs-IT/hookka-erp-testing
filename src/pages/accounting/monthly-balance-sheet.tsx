// ---------------------------------------------------------------------------
// Monthly Balance Sheet (owner 2026-11-11 「balance sheet 我也想要看monthly 的
// 可以吗？」): the financial year's month-end sheets side by side, newest first,
// as the Monthly P&L lays its months. Each column is that month's own Balance
// Sheet (GET /api/accounting/pl?period=YYYY-MM — the route the Balance Sheet
// reads, snapshot-cached), so a column always equals the single sheet; the
// current month is "so far". Accounts that share a Chart of Accounts parent sit
// under it with their subtotal, as on the Balance Sheet (groupBsEntries).
// The layout and totals: src/lib/bs-monthly.ts.
// ---------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { FinanceTitleActions } from "@/components/finance/title-actions";
import { ReportFrame, ReportToolbar } from "@/components/finance/report-shell";
import { COMPANY } from "@/lib/constants";
import { fmtAmt } from "@/lib/finance-reports";
import { todayYmdMY } from "@/lib/utils";
import { groupBsEntries } from "@/lib/bs-groups";
import { buildBsMatrix, fyMonthsShown, type BsMatrixRow, type BsMonthEntry } from "@/lib/bs-monthly";
import type { BsSection } from "@/lib/bs-section";
import { forecastBsSheets, fyForecastMonths, type BsForecastPayload } from "@/lib/forecast-bs";
import { NO_STALE_RUN, planStaleRetry } from "@/lib/stale-refresh";
import { useFiscalYears } from "./use-fiscal-years";
import { orgIdParam } from "./shared";

const labelOfYm = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });

const wait = (msDelay: number) =>
  new Promise<void>((done) => {
    // eslint-disable-next-line no-restricted-syntax -- the wait for a report copy to rebuild (planStaleRetry); the caller's `live()` drops a late answer
    setTimeout(done, msDelay);
  });

/** One month-end's sheet. A month answered from the report's older copy while
 *  it rebuilds (`stale`) is handed over as such and asked again, as the single
 *  sheet does (src/lib/stale-refresh.ts) — prod 2026-11-11: a column read
 *  mid-rebuild did not match the sheet until asked again. False when the
 *  month cannot be read. */
async function loadSheet(
  ym: string,
  company: string,
  live: () => boolean,
  onCopy: (entries: BsMonthEntry[], stale: boolean) => void,
): Promise<boolean> {
  let run = NO_STALE_RUN;
  for (;;) {
    const r = await fetch(`/api/accounting/pl?period=${ym}${orgIdParam(company)}`);
    const j = (await r.json()) as { success?: boolean; stale?: unknown; data?: { balanceSheet?: BsMonthEntry[] } };
    if (!live()) return true;
    if (!j?.success || !Array.isArray(j.data?.balanceSheet)) return false;
    const next = planStaleRetry(run, j);
    run = next.run;
    onCopy(j.data.balanceSheet, next.retryInMs !== null);
    if (next.retryInMs === null) return true;
    await wait(next.retryInMs);
    if (!live()) return true;
  }
}

export function MonthlyBalanceSheet({ company, toolbar }: { company: string; toolbar?: ReactNode }) {
  const fiscal = useFiscalYears();
  const curYm = todayYmdMY().slice(0, 7);
  const years = useMemo(() => fiscal?.years ?? [], [fiscal]);
  const [pick, setPick] = useState<string | null>(null);
  // The year shown: the one picked, else the current one.
  const fy = years.find((y) => y.startYm === pick) ?? years.find((y) => y.startYm <= curYm && curYm <= y.endYm) ?? years[years.length - 1];
  const months = useMemo(() => (fy ? fyMonthsShown(fy, curYm) : []), [fy, curYm]);
  const monthsKey = months.join(",");

  // Each month's sheet, three at a time; a month that fails is named; a month
  // being refreshed shows "Updating…" (loadSheet).
  const [byMonth, setByMonth] = useState<Record<string, BsMonthEntry[]>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    let live = true;
    const queue = monthsKey ? monthsKey.split(",") : [];
    const stale = new Set<string>();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new year / company starts empty
    setByMonth({});
    setFailed([]);
    setUpdating(false);
    const worker = async () => {
      while (queue.length && live) {
        const ym = queue.shift()!;
        let ok = false;
        try {
          ok = await loadSheet(ym, company, () => live, (entries, isStale) => {
            setByMonth((p) => ({ ...p, [ym]: entries }));
            if (isStale) stale.add(ym);
            else stale.delete(ym);
            setUpdating(stale.size > 0);
          });
        } catch {
          ok = false;
        }
        if (!ok && live) setFailed((p) => [...p, ym]);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { live = false; };
  }, [monthsKey, company]);

  // Forecast (owner 2026-11-11 「…是不是可以做forecast balance sheet?」, start
  // point 「可以」 = last month-end's actual sheet): the months ahead, rolled
  // forward from last month-end's sheet by GET /bs-forecast (src/lib/forecast-bs.ts)
  // to the last month the Forecast P&L has figures for, newest first on the left
  // as on the Monthly P&L. The columns follow the year picked, to its year end
  // (owner 2026-11-11 「根据fye 显示forecast 的数据可以吗？」): this year and the
  // years ahead. The forecast is the whole business's, so it shows on the
  // all-companies sheet.
  const canForecast = !!fy && fy.endYm >= curYm && company === "";
  const [forecastOn, setForecastOn] = useState(false);
  const [fc, setFc] = useState<BsForecastPayload | null>(null);
  const [fcError, setFcError] = useState<string | null>(null);
  const showForecast = forecastOn && canForecast;
  useEffect(() => {
    if (!showForecast || fc) return;
    let live = true;
    fetch("/api/accounting/bs-forecast", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ success?: boolean; error?: string; data?: BsForecastPayload }>)
      .then((j) => {
        if (!live) return;
        if (!j?.success || !j.data) { setFcError(j?.error || "The forecast could not be loaded"); return; }
        setFcError(null);
        setFc(j.data);
      })
      .catch(() => { if (live) setFcError("The forecast could not be loaded"); });
    return () => { live = false; };
  }, [showForecast, fc]);

  // Last month-end's actual sheet is the forecast's start: its own column when
  // the year shows it (kept current above), else read here the same way.
  const fcStartYm = fc?.startYm ?? "";
  const startInYear = !!fcStartYm && months.includes(fcStartYm);
  const [fcOpening, setFcOpening] = useState<BsMonthEntry[] | null>(null);
  const [openingUpdating, setOpeningUpdating] = useState(false);
  const [openingFailed, setOpeningFailed] = useState(false);
  useEffect(() => {
    if (!showForecast || !fcStartYm || startInYear) return;
    let live = true;
    loadSheet(fcStartYm, company, () => live, (entries, isStale) => {
      setFcOpening(entries);
      setOpeningUpdating(isStale);
    })
      .then((ok) => { if (!ok && live) setOpeningFailed(true); })
      .catch(() => { if (live) setOpeningFailed(true); });
    return () => { live = false; };
  }, [showForecast, fcStartYm, startInYear, company]);
  const opening = fc ? (startInYear ? byMonth[fc.startYm] : fcOpening) ?? null : null;

  // Every forecast month's sheet (the salaries owed at the start paid in the
  // first month; customers' invoices collected up to the trade debtors on the
  // start's sheet), and the ones inside the year picked as columns "f:YYYY-MM".
  const fcSheets = useMemo(() => (showForecast && fc && opening ? forecastBsSheets(fc, opening) : {}), [showForecast, fc, opening]);
  const fcYms = useMemo(() => (showForecast && fc && fy ? fyForecastMonths(fy, fc.months) : []), [showForecast, fc, fy]);
  const fcKeys = useMemo(() => fcYms.map((ym) => `f:${ym}`), [fcYms]);
  const fcByKey = useMemo(() => {
    const out: Record<string, BsMonthEntry[]> = {};
    for (const ym of fcYms) if (fcSheets[ym]) out[`f:${ym}`] = fcSheets[ym];
    return out;
  }, [fcYms, fcSheets]);
  const cols = useMemo(() => [...fcKeys, ...months], [fcKeys, months]);
  const all = useMemo(() => ({ ...byMonth, ...fcByKey }), [byMonth, fcByKey]);
  const matrix = useMemo(() => buildBsMatrix(cols, all), [cols, all]);
  const loaded = (i: number) => !!all[cols[i]];
  const amt = (v: number, i: number) => (loaded(i) ? fmtAmt(v) : "…");
  const nums = (vals: number[]) =>
    vals.map((v, i) => (
      <td key={cols[i]} data-cell={`num split${cols[i].startsWith("f:") ? " fc fp" : ""}`} data-neg={loaded(i) && v < 0 ? "" : undefined}>{amt(v, i)}</td>
    ));
  const span = cols.length + 1;

  // A section: heading, its accounts (parents with their subtotal), total.
  const section = (key: BsSection, title: string) => {
    const s = matrix.sections[key];
    const items = groupBsEntries(s.rows.map((r) => ({ ...r, balance: 0 })));
    const rowOf = new Map(s.rows.map((r) => [r.accountCode, r] as const));
    const line = (r: BsMatrixRow, under: boolean) => (
      <tr key={r.accountCode} data-row="line">
        <td data-cell="stick" style={{ paddingLeft: under ? 52 : 32 }}>
          <span className="mr-2 text-[11px] text-[#9CA3AF] tabular-nums">{r.accountCode === "NP-CURRENT" ? "" : r.accountCode}</span>
          {r.accountName}
        </td>
        {nums(r.values)}
      </tr>
    );
    return (
      <>
        <tr data-row="grp"><td colSpan={span}>{title}</td></tr>
        {items.map((it) => {
          if (it.kind === "line") return line(rowOf.get(it.entry.accountCode)!, false);
          const members = it.members.map((m) => rowOf.get(m.accountCode)!);
          const sub = cols.map((_, i) => members.reduce((t, m) => t + m.values[i], 0));
          return (
            <Fragment key={`g-${it.code}`}>
              <tr data-row="sub">
                <td data-cell="stick" style={{ paddingLeft: 32 }}>
                  <span className="mr-2 text-[11px] text-[#9CA3AF] tabular-nums">{it.code}</span>
                  {it.name}
                </td>
                {nums(sub)}
              </tr>
              {members.map((m) => line(m, true))}
            </Fragment>
          );
        })}
        <tr data-row="sub">
          <td data-cell="stick" style={{ paddingLeft: 26 }}>Total {title.replace("Less: ", "")}</td>
          {nums(s.totals)}
        </tr>
      </>
    );
  };
  const outOfBalance = matrix.diff.some((d, i) => loaded(i) && d !== 0);
  const lastFcYm = fc?.months[fc.months.length - 1];

  return (
    <div className="space-y-4">
      <FinanceTitleActions>
        <ReportToolbar>
          {toolbar}
          <select
            aria-label="Financial year"
            value={fy?.startYm ?? ""}
            onChange={(e) => setPick(e.target.value)}
            className="h-8 rounded-md border border-[#E2DDD8] bg-white px-2 text-xs text-[#4B5563]"
          >
            {years.map((y) => (
              <option key={y.startYm} value={y.startYm}>{y.name}</option>
            ))}
          </select>
          {canForecast && (
            <label className="inline-flex items-center gap-1.5 text-xs text-[#4B5563]" title="The months ahead in this financial year, rolled forward from last month-end's sheet by the Forecast P&L and the documents' payment terms, to the last month the Forecast P&L has figures for">
              <input type="checkbox" checked={forecastOn} onChange={(e) => setForecastOn(e.target.checked)} className="accent-[#6B5C32]" />
              Forecast
            </label>
          )}
        </ReportToolbar>
      </FinanceTitleActions>
      {(updating || (showForecast && openingUpdating)) && <p className="text-xs text-[#6B7280]">Updating… a month's figures are being refreshed.</p>}
      {showForecast && fcError && <p className="text-xs text-[#9A3412]">{fcError} — reload the page to try again.</p>}
      {showForecast && openingFailed && <p className="text-xs text-[#9A3412]">Last month-end's Balance Sheet could not be loaded — reload the page to try again.</p>}
      {showForecast && !fc && !fcError && <p className="text-xs text-[#6B7280]">Working out the forecast…</p>}
      {showForecast && fc && !lastFcYm && (
        <p className="text-xs text-[#6B7280]">The Forecast P&amp;L has no figures from {labelOfYm(curYm)} on, so there is nothing to forecast yet.</p>
      )}
      {showForecast && fc && lastFcYm && fcYms.length === 0 && fy && (
        <p className="text-xs text-[#6B7280]">No forecast months in {fy.name} — the Forecast P&amp;L has figures up to {labelOfYm(lastFcYm)}.</p>
      )}
      {failed.length > 0 && (
        <p className="text-xs text-[#9A3412]">Could not load {failed.map(labelOfYm).join(", ")} — reload the page to try again.</p>
      )}
      {!fy ? (
        <p className="py-12 text-center text-sm text-[#6B7280]">Loading the financial years…</p>
      ) : cols.length === 0 ? (
        <p className="py-12 text-center text-sm text-[#6B7280]">
          {fy.name} has not started yet.{canForecast && !forecastOn ? " Tick Forecast to see its months ahead." : ""}
        </p>
      ) : (
        <ReportFrame
          company={COMPANY.HOOKKA.name}
          title={`Monthly Balance Sheet — ${fy.name}`}
          note={`All figures RM · each column is that month-end's Balance Sheet (this month: so far) · brackets = negative · stock = the P&L's closing stock${fc && fcKeys.length ? ` · forecast columns: ${labelOfYm(fc.startYm)}'s month-end sheet moved by the Forecast P&L and the documents' payment terms, to the last month the Forecast P&L has figures for; customers' invoices are collected up to the trade debtors on that sheet; stock and other balances stay as they were` : ""}`}
        >
          <table data-col-resize="first" data-fin-report data-fin-fit>
            <thead>
              <tr>
                <th data-cell="stick" className="min-w-[280px]">Account</th>
                {cols.map((k) => (
                  k.startsWith("f:")
                    ? <th key={k} data-cell="num split fc fp">{labelOfYm(k.slice(2))} · forecast</th>
                    : <th key={k} data-cell="num split">{labelOfYm(k)}{k === curYm ? " (so far)" : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section("FIXED_ASSET", "Fixed Assets (Net)")}
              <tr data-row="sec"><td colSpan={span}>CURRENT ASSETS LESS CURRENT LIABILITIES</td></tr>
              {section("CURRENT_ASSET", "Current Assets")}
              {section("CURRENT_LIABILITY", "Less: Current Liabilities")}
              <tr data-row="res">
                <td data-cell="stick">Net Current Assets</td>
                {nums(matrix.netCurrent)}
              </tr>
              <tr data-row="fin">
                <td data-cell="stick">FIXED ASSETS + CURRENT ASSETS − CURRENT LIABILITIES</td>
                {nums(matrix.left)}
              </tr>
              <tr data-row="sec"><td colSpan={span}>FINANCED BY</td></tr>
              {section("EQUITY", "Equity")}
              {section("LONG_TERM_LIABILITY", "Non-Current Liabilities")}
              <tr data-row="fin">
                <td data-cell="stick">TOTAL EQUITY + NON-CURRENT LIABILITIES</td>
                {nums(matrix.right)}
              </tr>
              {outOfBalance && (
                <tr data-row="sub">
                  <td data-cell="stick">Out of balance</td>
                  {nums(matrix.diff)}
                </tr>
              )}
            </tbody>
          </table>
        </ReportFrame>
      )}
    </div>
  );
}
