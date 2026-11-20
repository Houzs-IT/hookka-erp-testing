// ---------------------------------------------------------------------------
// board-report-sources.ts — gathers what the monthly Board Report reads.
//
// Every figure comes from an endpoint the ERP already serves, called
// IN-PROCESS (src/api/lib/in-process-get.ts) with the caller's own session, so
// each route keeps its own permission gate, its own snapshot cache and its own
// maths. Nothing here computes a P&L, a balance sheet or a cash flow. The two
// pieces that have no endpoint of their own call the same library functions
// their dashboards call: defect rates (`defectRates` over `buildServiceSlice`,
// as the Defect rate card does) and per-worker efficiency
// (`collectWorkforce`, the Operations Report's section, workers:read only).
// The efficiency bands use the Employees insights page's own per-person figure
// (workforce-perf.ts `workerEfficiencyPcts` over `loadMonthPerfDays`, the
// rows the KPI card reads) and the shared thresholds in
// src/lib/efficiency-bands.ts. The stock-take check is
// GET /api/accounting/stock-take/check (accounting:read), in-process.
//
// A source that fails returns { ok: false, error } — the page prints the
// reason on that section and the Notes page lists it; it never renders as 0.
// Shaping is pure and lives in src/lib/board-report.ts.
// ---------------------------------------------------------------------------
import { employedDuring } from "../../lib/employment";
import type { Context } from "hono";
import type { Env } from "../worker";
import { makeInProcessGet, type InProcessResult } from "./in-process-get";
import { hasPermission } from "./rbac";
import { getOrgId } from "./tenant";
import { buildServiceSlice } from "./dashboard-service-slice";
import { defectRates, NOT_OUR_FAULT_CAUSES } from "./service-issue-stats";
import { collectWorkforce, resolvePeriod } from "./operations-report";
import { loadMonthPerfDays } from "./kpi-metrics";
import { workerEfficiencyPcts } from "./workforce-perf";
import { countEfficiencyBands, EFFICIENCY_MIN_RANK_MINUTES } from "../../lib/efficiency-bands";
import type { StockTakeCheck } from "../../lib/stock-take-check";
import {
  addMonths,
  boardWindows,
  monthEnd,
  notesKey,
  parseNotes,
  productionHeadcount,
  type HeadcountHours,
  type HeadcountPayload,
  type HeadcountPayslip,
  type BoardSources,
  type CfPayload,
  type DashPayload,
  type DefectsPayload,
  type NewModelsPayload,
  type OverviewPayload,
  type PlMonthlyPayload,
  type PlPayload,
  type RevSplitPayload,
  type Src,
  type WorkforcePayload,
} from "../../lib/board-report";

/** `{ success, data }` routes. */
const dataOf = <T,>(r: InProcessResult<{ data?: T }>): Src<T> =>
  r.ok ? (r.json.data !== undefined ? { ok: true, data: r.json.data } : { ok: false, error: "Empty response" }) : { ok: false, error: r.error };
/** `{ success, ...payload }` routes (the dashboard overview family). */
const bodyOf = <T,>(r: InProcessResult<T>): Src<T> => (r.ok ? { ok: true, data: r.json } : { ok: false, error: r.error });

async function guarded<T>(fn: () => Promise<Src<T>>): Promise<Src<T>> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadBoardSources(c: Context<Env>, month: string, todayYmd: string): Promise<BoardSources> {
  const w = boardWindows(month, todayYmd);
  const get = makeInProcessGet(c);
  const db = c.var.DB;
  const [{ default: accounting }, { default: overview }, { default: products }] = await Promise.all([
    import("../routes/accounting"),
    import("../routes/dashboard-overview"),
    import("../routes/products"),
  ]);

  const defects = guarded<DefectsPayload>(async () => {
    const allowed = (await hasPermission(c, "service-cases", "read")) || (await hasPermission(c, "dashboard", "read"));
    if (!allowed) return { ok: false, error: "Not available to your role (needs service-cases or dashboard read)" };
    const slice = await buildServiceSlice(db);
    const shipped = slice.shipped ?? [];
    const notOurs = [...NOT_OUR_FAULT_CAUSES];
    const total = (ms: string[]) => {
      const rows = defectRates(slice.cases, shipped, ms, notOurs);
      const units = rows.filter((x) => x.category !== "UNSPECIFIED").reduce((t, x) => t + x.units, 0);
      const cases = rows.reduce((t, x) => t + x.cases, 0);
      return { cases, units, rate: units > 0 ? Math.round((cases / units) * 1000) / 10 : null };
    };
    return {
      ok: true,
      data: {
        month: defectRates(slice.cases, shipped, [month], notOurs),
        prev: defectRates(slice.cases, shipped, [w.prev], notOurs),
        trend: Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5)).map((ym) => ({ ym, ...total([ym]) })),
      },
    };
  });

  const workforce = guarded<WorkforcePayload>(async () => {
    if (!(await hasPermission(c, "workers", "read"))) return { ok: false, error: "Not available to your role (needs workers read)" };
    const orgId = getOrgId(c);
    const wf = await collectWorkforce(db, orgId, resolvePeriod("monthly", `${month}-01`));
    // Bands: the Employees insights figure (useRankedPeople) — headcount
    // workers, at least an hour clocked, production ÷ working minutes summed
    // over the month. A failure here leaves the top/bottom lists in place.
    let bands: WorkforcePayload["bands"] = null;
    let bandsError: string | null = null;
    try {
      const [perfDays, ws] = await Promise.all([
        loadMonthPerfDays(db, orgId, month),
        db.prepare(`SELECT id AS "id", empNo AS "empNo", status AS "status", joinDate AS "joinDate", resignedAt AS "resignedAt" FROM workers`).all<{ id: string; empNo: string | null; status: string | null; joinDate: string | null; resignedAt: string | null }>(),
      ]);
      // The people employed in THAT month (one employment rule, owner
      // 2026-11-21) — a leaver stays in the month they worked.
      const counted = new Set((ws.results ?? []).filter((x) => employedDuring(x, `${month}-01`, `${month}-31`)).map((x) => String(x.id)));
      const people = workerEfficiencyPcts(perfDays, (d) => d.startsWith(month), (id) => counted.has(id), EFFICIENCY_MIN_RANK_MINUTES);
      bands = countEfficiencyBands(people.map((x) => x.pct));
    } catch (e) {
      bandsError = e instanceof Error ? e.message : String(e);
    }
    return {
      ok: true,
      data: {
        activeWorkers: wf.activeWorkers,
        topEfficiency: wf.topEfficiency.map((x) => ({ name: x.name, pct: x.pct })),
        bottomEfficiency: wf.bottomEfficiency.map((x) => ({ name: x.name, pct: x.pct })),
        bands,
        bandsError,
      },
    };
  });

  // Production headcount (owner review 2026-11-15): workers with a payslip in
  // a production department that month (hours clocked, for a month with no
  // payslips yet) — not everyone on the worker master. Payroll data, so the
  // same gate as the labour figures beside it.
  const headcount = guarded<HeadcountPayload>(async () => {
    if (!(await hasPermission(c, "accounting", "read"))) return { ok: false, error: "Not available to your role (needs accounting read)" };
    const orgId = getOrgId(c);
    const [slips, hours, depts] = await Promise.all([
      // Same predicate as the dashboard's payslip read; the month filter is
      // applied in productionHeadcount (period is read as text, YYYY-MM…).
      db.prepare("SELECT period, departmentCode, employeeId FROM payslips WHERE orgId = ? AND status != 'CANCELLED'")
        .bind(orgId).all<HeadcountPayslip>(),
      db.prepare("SELECT workerId, departmentCode, date, hours FROM working_hour_entries WHERE date >= ? AND date <= ?")
        .bind(`${w.prev}-01`, monthEnd(month)).all<HeadcountHours>(),
      db.prepare("SELECT code, is_production FROM departments").all<{ code: string | null; isProduction?: number | null; is_production?: number | null }>(),
    ]);
    const nonProd = new Set<string>();
    for (const r of depts.results ?? []) {
      const code = String(r.code ?? "").trim();
      if (code && Number(r.isProduction ?? r.is_production ?? 1) === 0) nonProd.add(code);
    }
    const cur = productionHeadcount(month, slips.results ?? [], hours.results ?? [], nonProd);
    const prev = productionHeadcount(w.prev, slips.results ?? [], hours.results ?? [], nonProd);
    return { ok: true, data: { cur: cur.n, prev: prev.n, basis: cur.basis } };
  });

  const notes = (async () => {
    try {
      const row = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(notesKey(month)).first<{ value: string }>();
      return parseNotes(row?.value ?? null);
    } catch {
      return parseNotes(null);
    }
  })();

  const [dashboard, plMonthly, plCur, plPrev, cashflow, cashForecast, ov, revCur, revPrev, newModels, stockTake, defectsR, workforceR, notesR] = await Promise.all([
    get<{ data?: DashPayload }>(accounting, `/dashboard?granularity=month&from=${w.dashFrom}&to=${w.dashTo}`).then(dataOf),
    get<{ data?: PlMonthlyPayload }>(accounting, `/pl-monthly?anchor=${month}`).then(dataOf),
    get<{ data?: PlPayload }>(accounting, `/pl?period=${month}`).then(dataOf),
    get<{ data?: PlPayload }>(accounting, `/pl?period=${w.prev}`).then(dataOf),
    get<{ data?: CfPayload }>(accounting, `/cashflow-statement?period=${month}`).then(dataOf),
    get<{ data?: CfPayload }>(accounting, `/cashflow-forecast?period=${w.running}`).then(dataOf),
    get<OverviewPayload>(overview, `/?period=${month}`).then(bodyOf),
    get<RevSplitPayload>(overview, `/revenue-split?period=${month}`).then(bodyOf),
    get<RevSplitPayload>(overview, `/revenue-split?period=${w.prev}`).then(bodyOf),
    get<{ data?: NewModelsPayload }>(products, `/new-models?from=${w.newModelsFrom}&to=${w.newModelsTo}`).then(dataOf),
    get<{ data?: StockTakeCheck }>(accounting, `/stock-take/check?ym=${month}`).then(dataOf),
    defects,
    workforce,
    notes,
  ]);
  const headcountR = await headcount;

  return {
    dashboard,
    plMonthly,
    plCur,
    plPrev,
    cashflow,
    cashForecast,
    overview: ov,
    revSplitCur: revCur,
    revSplitPrev: revPrev,
    newModels,
    defects: defectsR,
    workforce: workforceR,
    stockTake,
    headcount: headcountR,
    notes: notesR,
  };
}
