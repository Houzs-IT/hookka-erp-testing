// State + derived numbers of the /m Home Employees view. Hooks only; every figure comes from emp-lib.ts (the
// desktop's maths) over the desktop's own feed and endpoints (emp-data.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { monthsOf } from "../../../dashboards/use-production-revenue";
import { shiftMonth, stepDay, type Period } from "../../../dashboards/dashboard-shared-lib";
import { useEmpFeed, useEmpMoney, type EmpAccess } from "./emp-data";
import {
  buildWindow, dayLog, departmentsOf, deptRowsOf, deptTotalOf, foldProgressive, headlineOf, latestDay, mainChartPoints, monthLog, npChartPoints, npData,
  periodDays, presenceOn, rankSplit, rosterOf, sumWindow, workerRows, type EmpSlice, type EmpWorker, type Win,
} from "./emp-lib";

export type LogPick = "today" | "yday" | "month" | null;
export type Sheet =
  | { type: "tile"; kind: "salary" | "eff" } | { type: "depts" } | { type: "dept"; dept: string } | { type: "worker"; id: string }
  | { type: "rank"; half: "upper" | "lower" } | { type: "np" } | { type: "log" }
  | { type: "logRow"; id: string | null; name: string; date: string } | { type: "logm"; id: string };

const EMPTY: EmpSlice = { workers: [], attendance: [], performance: { byDay: [] } };
/** empty = the question was answered and there is nothing to compute from (no hour entries): not a zero. */
export type MoneyStatus = "denied" | "loading" | "error" | "ready" | "empty";

export function useEmpModel({ access, period, today, logSignal }: { access: EmpAccess; period: Period; today: string; logSignal: number }) {
  const feed = useEmpFeed(access);
  const employee = feed.employee ?? EMPTY;
  const target = feed.target;

  const [win, setWin] = useState<Win>("period");
  const [dept, setDept] = useState("ALL");
  const [stack, setStack] = useState<Sheet[]>([]);
  const [chSel, setChSel] = useState<string | null>(null);
  const [npSel, setNpSel] = useState<string | null>(null);
  const [hide, setHide] = useState<Record<string, boolean>>({});
  const [npHide, setNpHide] = useState<Record<string, boolean>>({});
  const [npView, setNpView] = useState<"people" | "dept">("people");
  const [rkHalf, setRkHalf] = useState<"upper" | "lower">("upper");
  const periodKey = JSON.stringify(period);
  const [lp, setLp] = useState<{ pick: LogPick; key: string }>({ pick: null, key: periodKey });
  const logPick: LogPick = lp.key === periodKey ? lp.pick : null;
  const setLogPick = (pick: LogPick) => setLp({ pick, key: periodKey });

  const allDays = useMemo(() => [...employee.performance.byDay].sort((a, b) => (a.date < b.date ? -1 : 1)), [employee]);
  const days = useMemo(() => periodDays(allDays, period), [allDays, period]);
  const W = useMemo(() => buildWindow(days, period, win), [days, period, win]);
  const workerById = useMemo(() => new Map<string, EmpWorker>(employee.workers.map((w) => [w.id, w])), [employee]);
  const { roster, outsourced } = useMemo(() => rosterOf(employee), [employee]);
  const depts = useMemo(() => departmentsOf(employee.workers), [employee]);

  const prevYmGuess = W.anchor ? W.anchor.slice(0, 7) : "";
  const revMonths = useMemo(() => {
    if (!prevYmGuess) return [] as string[];
    const prevYm = shiftMonth(prevYmGuess, -1);
    return [...new Set([prevYm, ...monthsOf(period, today)])].sort();
  }, [prevYmGuess, period, today]);
  const money = useEmpMoney({ access, from: W.range.from, to: W.range.to, anchor: W.anchor, winFrom: W.winFrom, winTo: W.winTo, revMonths, today });
  const costByWorkerDay = money.labour.byWorkerDay;
  const costByDept = money.labour.byWorkerDayDept;
  const hourEntries = money.labour.entries;

  const totals = useMemo(() => sumWindow(allDays, (d) => W.winDates.has(d), costByWorkerDay, outsourced, money.revenue.byDay), [allDays, W.winDates, costByWorkerDay, outsourced, money.revenue.byDay]);
  const prev = useMemo(() => (money.prevYm ? sumWindow(allDays, (d) => d.startsWith(money.prevYm), money.prevLabour.byWorkerDay, outsourced, money.revenue.byDay) : null), [allDays, money.prevYm, money.prevLabour.byWorkerDay, outsourced, money.revenue.byDay]);
  const head = headlineOf({ totals, prev, costByDept, winDates: W.winDates, revenueKnown: money.revenue.status === "ready" });
  const pres = useMemo(() => presenceOn(employee, roster, W.anchor), [employee, roster, W.anchor]);

  const rows = useMemo(() => workerRows(days, W.winDates, workerById, dept, costByWorkerDay), [days, W.winDates, workerById, dept, costByWorkerDay]);
  const split = useMemo(() => rankSplit(rows, outsourced), [rows, outsourced]);
  const progByDept = useMemo(() => foldProgressive(money.prog.byDeptCategory), [money.prog.byDeptCategory]);
  const deptRows = useMemo(() => deptRowsOf({ days, winDates: W.winDates, workerById, costByWorkerDay, costByDept, hourEntries, progByDept, outsourced }), [days, W.winDates, workerById, costByWorkerDay, costByDept, hourEntries, progByDept, outsourced]);
  const deptTotal = useMemo(() => deptTotalOf(deptRows), [deptRows]);
  const chart = useMemo(() => mainChartPoints(days, costByWorkerDay), [days, costByWorkerDay]);
  const npPoints = useMemo(() => npChartPoints(days), [days]);
  const np = useMemo(() => npData(days, W.winDates, workerById), [days, W.winDates, workerById]);

  // Attendance log: opens on the anchor day; Today / Yesterday / This month chips (desktop AttendanceLogCard).
  const logDay = logPick === "today" ? today : logPick === "yday" ? stepDay(today, -1, today) : logPick === "month" ? null : W.anchor;
  const monthYm = (W.anchor || today).slice(0, 7);
  const dayL = useMemo(() => (logDay ? dayLog(employee, logDay) : null), [employee, logDay]);
  const monthL = useMemo(() => (logPick === "month" ? monthLog(employee, monthYm) : null), [employee, logPick, monthYm]);

  // Present box / Today's problems "Not in" ask for the log.
  const seen = useRef(logSignal);
  useEffect(() => {
    if (logSignal !== seen.current) { seen.current = logSignal; setLp({ pick: null, key: periodKey }); setStack([{ type: "log" }]); }
  }, [logSignal, periodKey]);

  // ---- money text with its own denied / loading states ------------------------------------------------------------
  const labourState = money.labourState;
  const salaryStatus: MoneyStatus = labourState === "none" ? "empty" : labourState;
  const rm = (sen: number) => formatCurrency(Math.round(sen));
  const salaryText = (sen: number | null) => (salaryStatus === "denied" ? "No access" : salaryStatus === "error" || salaryStatus === "empty" ? "—" : salaryStatus === "loading" || sen == null ? "…" : rm(sen));
  // One short line for a salary that could not be shown, so "—" always says why.
  const salaryNote: string | null = salaryStatus === "empty" ? "No hour entries logged for this window"
    : salaryStatus === "error" ? `Could not load ${money.labourWhy || "the salary inputs"}, so no salary is shown` : null;
  const revNote: string | null = money.revenue.status === "error" ? "Revenue could not be loaded" : null;
  const revStatus: MoneyStatus = money.revenue.status;
  const revText = (sen: number | null) => (revStatus === "denied" ? "No access" : revStatus === "error" ? "—" : revStatus === "loading" || sen == null ? "…" : rm(sen));
  const outStatus: MoneyStatus = money.prog.status;
  const outText = (sen: number) => (outStatus === "denied" ? "No access" : outStatus === "error" ? "—" : outStatus === "loading" ? "…" : rm(Math.round(sen / 100) * 100));

  return {
    feed, employee, target, access, today, period, latest: latestDay(days),
    win, setWin, dept, setDept, depts, W, workerById, roster, outsourced,
    money, totals, head, pres, rows, split, deptRows, deptTotal, chart, npPoints, np, hourEntries, costByWorkerDay,
    logPick, setLogPick, logDay, monthYm, dayL, monthL,
    stack, push: (s: Sheet) => setStack((x) => [...x, s]), open: (s: Sheet) => setStack([s]), back: () => setStack((x) => x.slice(0, -1)), replaceTop: (s: Sheet) => setStack((x) => [...x.slice(0, -1), s]), close: () => setStack([]),
    chSel, setChSel, npSel, setNpSel, hide, setHide, npHide, setNpHide, npView, setNpView, rkHalf, setRkHalf,
    canSalary: money.canSalary, salaryStatus, salaryText, salaryNote, revNote, revStatus, revText, outStatus, outText, rm,
  };
}
export type EmpModel = ReturnType<typeof useEmpModel>;
