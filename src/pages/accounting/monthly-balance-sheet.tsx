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
import { FC_CASH, forecastBsEntries } from "@/lib/forecast-bs";
import { useFiscalYears } from "./use-fiscal-years";
import { orgIdParam } from "./shared";

const labelOfYm = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });

export function MonthlyBalanceSheet({ company, toolbar }: { company: string; toolbar?: ReactNode }) {
  const fiscal = useFiscalYears();
  const curYm = todayYmdMY().slice(0, 7);
  const years = useMemo(() => fiscal?.years ?? [], [fiscal]);
  const [pick, setPick] = useState<string | null>(null);
  // The year shown: the one picked, else the current one.
  const fy = years.find((y) => y.startYm === pick) ?? years.find((y) => y.startYm <= curYm && curYm <= y.endYm) ?? years[years.length - 1];
  const months = useMemo(() => (fy ? fyMonthsShown(fy, curYm) : []), [fy, curYm]);
  const monthsKey = months.join(",");

  // Each month's sheet, three at a time; a month that fails is named.
  const [byMonth, setByMonth] = useState<Record<string, BsMonthEntry[]>>({});
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    if (!monthsKey) return;
    let live = true;
    const queue = monthsKey.split(",");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new year / company starts empty
    setByMonth({});
    setFailed([]);
    const worker = async () => {
      while (queue.length && live) {
        const ym = queue.shift()!;
        try {
          const r = await fetch(`/api/accounting/pl?period=${ym}${orgIdParam(company)}`);
          const j = (await r.json()) as { success?: boolean; data?: { balanceSheet?: BsMonthEntry[] } };
          if (!live) return;
          if (j?.success && Array.isArray(j.data?.balanceSheet)) {
            const entries = j.data.balanceSheet;
            setByMonth((p) => ({ ...p, [ym]: entries }));
          } else setFailed((p) => [...p, ym]);
        } catch {
          if (live) setFailed((p) => [...p, ym]);
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { live = false; };
  }, [monthsKey, company]);

  // Forecast (owner 2026-11-11 「…是不是可以做forecast balance sheet?」, start
  // point 「可以」 = last month-end's actual sheet): the months ahead, rolled
  // forward from last month-end's sheet by GET /bs-forecast (src/lib/forecast-bs.ts),
  // newest first on the left as on the Monthly P&L. The current year only.
  // The forecast is the whole business's, so it shows on the all-companies sheet.
  const isCurrentFy = !!fy && fy.startYm <= curYm && curYm <= fy.endYm && company === "";
  const [forecastOn, setForecastOn] = useState(false);
  type BsForecastResp = { startYm: string; months: string[]; deltas: Record<string, Record<string, number>>; accounts: Record<string, { name: string; section: string }>; salaryAccount: string };
  const [fc, setFc] = useState<BsForecastResp | null>(null);
  const [fcOpening, setFcOpening] = useState<BsMonthEntry[] | null>(null);
  const [fcError, setFcError] = useState<string | null>(null);
  const showForecast = forecastOn && isCurrentFy;
  useEffect(() => {
    if (!showForecast || fc) return;
    let live = true;
    fetch("/api/accounting/bs-forecast", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ success?: boolean; error?: string; data?: BsForecastResp }>)
      .then(async (j) => {
        if (!live) return;
        if (!j?.success || !j.data) { setFcError(j?.error || "The forecast could not be loaded"); return; }
        const data = j.data;
        // Last month-end's actual sheet: the forecast's start.
        const r = await fetch(`/api/accounting/pl?period=${data.startYm}${orgIdParam(company)}`);
        const pj = (await r.json()) as { success?: boolean; data?: { balanceSheet?: BsMonthEntry[] } };
        if (!live) return;
        if (!pj?.success || !Array.isArray(pj.data?.balanceSheet)) { setFcError("Last month-end's Balance Sheet could not be loaded"); return; }
        setFcOpening(pj.data.balanceSheet);
        setFc(data);
      })
      .catch(() => { if (live) setFcError("The forecast could not be loaded"); });
    return () => { live = false; };
  }, [showForecast, fc, company]);
  // A forecast column's key ("f:YYYY-MM") and its sheet: the start's sheet
  // with the movements so far; the salaries owed at the start are paid in the
  // first month.
  const fcKeys = useMemo(() => (showForecast && fc ? [...fc.months].reverse().map((ym) => `f:${ym}`) : []), [showForecast, fc]);
  const fcByKey = useMemo(() => {
    const out: Record<string, BsMonthEntry[]> = {};
    if (!showForecast || !fc || !fcOpening) return out;
    const owed = fcOpening.find((e) => e.accountCode === fc.salaryAccount && e.category === "CURRENT_LIABILITY")?.balance ?? 0;
    const cum: Record<string, number> = {};
    fc.months.forEach((ym, i) => {
      const step = { ...(fc.deltas[ym] ?? {}) };
      if (i === 0 && owed > 0) {
        step[fc.salaryAccount] = (step[fc.salaryAccount] ?? 0) + owed;
        step[FC_CASH] = (step[FC_CASH] ?? 0) - owed;
      }
      for (const [code, sen] of Object.entries(step)) cum[code] = (cum[code] ?? 0) + sen;
      out[`f:${ym}`] = forecastBsEntries(fcOpening, cum, fc.accounts);
    });
    return out;
  }, [showForecast, fc, fcOpening]);
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
          {isCurrentFy && (
            <label className="inline-flex items-center gap-1.5 text-xs text-[#4B5563]" title="The months ahead, rolled forward from last month-end's sheet by the Forecast P&L and the documents' payment terms">
              <input type="checkbox" checked={forecastOn} onChange={(e) => setForecastOn(e.target.checked)} className="accent-[#6B5C32]" />
              Forecast
            </label>
          )}
        </ReportToolbar>
      </FinanceTitleActions>
      {showForecast && fcError && <p className="text-xs text-[#9A3412]">{fcError} — reload the page to try again.</p>}
      {showForecast && !fc && !fcError && <p className="text-xs text-[#6B7280]">Working out the forecast…</p>}
      {failed.length > 0 && (
        <p className="text-xs text-[#9A3412]">Could not load {failed.map(labelOfYm).join(", ")} — reload the page to try again.</p>
      )}
      {!fy ? (
        <p className="py-12 text-center text-sm text-[#6B7280]">Loading the financial years…</p>
      ) : months.length === 0 ? (
        <p className="py-12 text-center text-sm text-[#6B7280]">{fy.name} has not started yet.</p>
      ) : (
        <ReportFrame
          company={COMPANY.HOOKKA.name}
          title={`Monthly Balance Sheet — ${fy.name}`}
          note={`All figures RM · each column is that month-end's Balance Sheet (this month: so far) · brackets = negative · stock = the P&L's closing stock${showForecast && fc ? ` · forecast columns: ${labelOfYm(fc.startYm)}'s month-end sheet moved by the Forecast P&L and the documents' payment terms; stock and other balances stay as they were` : ""}`}
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
