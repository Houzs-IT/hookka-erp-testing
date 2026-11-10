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
//
// A source that fails returns { ok: false, error } — the page prints the
// reason on that section and the Notes page lists it; it never renders as 0.
// Shaping is pure and lives in src/lib/board-report.ts.
// ---------------------------------------------------------------------------
import type { Context } from "hono";
import type { Env } from "../worker";
import { makeInProcessGet, type InProcessResult } from "./in-process-get";
import { hasPermission } from "./rbac";
import { getOrgId } from "./tenant";
import { buildServiceSlice } from "./dashboard-service-slice";
import { defectRates, NOT_OUR_FAULT_CAUSES } from "./service-issue-stats";
import { collectWorkforce, resolvePeriod } from "./operations-report";
import {
  addMonths,
  boardWindows,
  notesKey,
  parseNotes,
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
    const wf = await collectWorkforce(db, getOrgId(c), resolvePeriod("monthly", `${month}-01`));
    return {
      ok: true,
      data: {
        activeWorkers: wf.activeWorkers,
        topEfficiency: wf.topEfficiency.map((x) => ({ name: x.name, pct: x.pct })),
        bottomEfficiency: wf.bottomEfficiency.map((x) => ({ name: x.name, pct: x.pct })),
      },
    };
  });

  const notes = (async () => {
    try {
      const row = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(notesKey(month)).first<{ value: string }>();
      return parseNotes(row?.value ?? null);
    } catch {
      return parseNotes(null);
    }
  })();

  const [dashboard, plMonthly, plCur, plPrev, cashflow, cashForecast, ov, revCur, revPrev, newModels, defectsR, workforceR, notesR] = await Promise.all([
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
    defects,
    workforce,
    notes,
  ]);

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
    notes: notesR,
  };
}
