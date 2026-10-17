// ---------------------------------------------------------------------------
// doc-import — the server half of the shared document importer (HK-0002).
//
// One runner for every document type. An adapter says how to load the stored
// documents and how to create / update one; the runner does the rest:
//
//   1. open ONE database transaction
//   2. adapter.load → planDocImport (src/lib/doc-import/core.ts) → validate
//   3. any error → roll back, report
//   4. apply every document through the adapter
//   5. dry run → roll back anyway (so the preview has exercised every route
//      guard the real apply will hit); execute → commit
//
// Adapters MUST write through the SAME route handlers the screens use. They do
// that with `ctx.callRoute(subApp, method, path, body)`, which runs the real
// Hono handler in-process on the transaction's DB, with the caller's identity
// (every c.var copied) — so status guards, GL restatement, billing drawdown,
// RBAC and audit are the existing code, not a copy of it. A non-2xx answer (or
// success:false) throws and the whole import rolls back.
// ---------------------------------------------------------------------------

import { Hono, type Context } from "hono";
import type { Env } from "../worker";
import {
  planDocImport,
  type CurrentDoc,
  type DocPlan,
  type ImportPlan,
  type ImportSpec,
  type Issue,
} from "../../lib/doc-import/core";

type Db = Env["Variables"]["DB"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SubApp = Hono<any>;

export type ImportCtx = {
  c: Context<Env>;
  /** The transaction-bound DB. */
  db: Db;
  /** Run a real route handler in-process on `db`. Resolves the JSON body;
   *  throws RouteRefusal on a non-2xx / success:false answer. */
  callRoute: (app: SubApp, method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;
};

export interface DocImportAdapter {
  /** Doc Type cells this adapter accepts, e.g. ["DI", "SI"]. */
  docTypes: string[];
  /** RBAC resource; create/update permission is required per plan. */
  resource: string;
  spec: ImportSpec;
  /** The stored documents among `docNos` (absent = not found = create). */
  load(ctx: ImportCtx, docNos: string[]): Promise<Map<string, CurrentDoc>>;
  /** Pure refusals beyond the core rules. */
  validate?(plan: ImportPlan): Issue[];
  create(ctx: ImportCtx, doc: DocPlan): Promise<{ id: string; docNo: string }>;
  update(ctx: ImportCtx, doc: DocPlan): Promise<void>;
}

export class RouteRefusal extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

class Rollback extends Error {}

/** A DB handle whose target can be swapped: the route's deferred side
 *  effects (fireCustomerNoticeBestEffort waits 10 s, then reads c.var.DB)
 *  must see the committed outer DB — or nothing, after a rollback. */
function lateBound(initial: object) {
  let target: object = initial;
  const proxy = new Proxy({} as object, {
    get(_t, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { proxy: proxy as Db, set: (t: object) => (target = t) };
}
const deadDb = new Proxy({} as object, {
  get() {
    return () => {
      throw new Error("doc-import: this work belonged to a rolled-back import");
    };
  },
});

function makeCallRoute(c: Context<Env>, db: Db): ImportCtx["callRoute"] {
  let execCtx: unknown;
  try {
    execCtx = c.executionCtx;
  } catch {
    // outside a Worker isolate (tests) — no waitUntil
  }
  const outerVars = Object.entries(c.var as Record<string, unknown>);
  return async (app, method, path, body) => {
    const wrap = new Hono<Env>();
    wrap.use("*", async (ic, next) => {
      for (const [k, v] of outerVars) ic.set(k as never, v as never);
      ic.set("DB", db);
      await next();
    });
    wrap.route("/x", app);
    // A sub-app's "/" mounts at "/x", not "/x/" (Hono is strict about the
    // trailing slash), so POST "/" must not become "/x/" — that 404s.
    const res = await wrap.request(
      `/x${path.replace(/^\/(?=\?|$)/, "")}`,
      {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      c.env,
      execCtx as never,
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 400 || json.success === false) {
      throw new RouteRefusal(String(json.error ?? `HTTP ${res.status}`), res.status);
    }
    return json;
  };
}

export type DocResult = {
  docNo: string | null;
  action: "create" | "update";
  rows: number[];
  lines: Array<{ row: number; lineId: string | null; action: "create" | "update"; changes: DocPlan["lines"][number]["changes"] }>;
  headerChanges: DocPlan["headerChanges"];
  result?: { id: string; docNo: string };
};

export type ImportResult = {
  success: boolean;
  mode: "dry-run" | "executed";
  docs: DocResult[];
  errors: Issue[];
  warnings: Issue[];
  /** Nothing was written (dry run, or refused). */
  rolledBack: boolean;
};

const summarise = (d: DocPlan): DocResult => ({
  docNo: d.docNo,
  action: d.action,
  rows: d.rows,
  headerChanges: d.headerChanges,
  lines: d.lines.map((l) => ({ row: l.row, lineId: l.lineId, action: l.action, changes: l.changes })),
});

/**
 * Plan (and with `execute`, apply) one sheet. All-or-nothing: the import runs
 * in one transaction; any refusal — from the planner, the adapter or a route —
 * rolls the whole file back.
 *
 * `checkPermission` runs after planning, once per action the plan needs, so a
 * user with update but not create rights can still preview an edit.
 */
export async function runDocImport(
  c: Context<Env>,
  adapter: DocImportAdapter,
  aoa: unknown[][],
  opts: {
    execute: boolean;
    checkPermission: (action: "create" | "update") => Promise<Response | null>;
    /** Refuse a file naming more documents than this (default 200). */
    maxDocs?: number;
  },
): Promise<ImportResult | Response> {
  const outer = c.var.DB as unknown as { transaction?: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> };
  if (typeof outer.transaction !== "function") {
    throw new Error("doc-import: this database adapter has no transaction() — refusing to import without one");
  }
  const bound = lateBound(c.var.DB as object);
  let denied: Response | null = null;
  let result: ImportResult | null = null;

  try {
    await outer.transaction(async (tx) => {
      bound.set(tx as object);
      const ctx: ImportCtx = { c, db: tx, callRoute: makeCallRoute(c, bound.proxy) };
      const docNos = [
        ...new Set(
          aoa
            .slice(1)
            .map((r) => String((r ?? [])[docNoColumn(aoa, adapter.spec)] ?? "").trim())
            .filter((n) => n && !/^new-/i.test(n)),
        ),
      ];
      const current = await adapter.load(ctx, docNos);
      const plan = planDocImport(aoa, current, adapter.spec);
      plan.errors.push(...(adapter.validate?.(plan) ?? []));
      const maxDocs = opts.maxDocs ?? 200;
      if (plan.docs.length > maxDocs) {
        plan.errors.push({ row: 1, message: `${plan.docs.length} documents is more than one import accepts (${maxDocs}). Split the file.` });
      }
      const docs = plan.docs.map(summarise);
      const done = (success: boolean, extra: Issue[] = []): ImportResult => ({
        success,
        mode: opts.execute ? "executed" : "dry-run",
        docs,
        errors: [...plan.errors, ...extra],
        warnings: plan.warnings,
        rolledBack: true,
      });
      if (plan.errors.length > 0) {
        result = done(false);
        throw new Rollback();
      }
      for (const action of ["create", "update"] as const) {
        if (plan.docs.some((d) => d.action === action)) {
          denied = await opts.checkPermission(action);
          if (denied) throw new Rollback();
        }
      }
      for (let i = 0; i < plan.docs.length; i++) {
        const d = plan.docs[i];
        try {
          if (d.action === "create") docs[i].result = await adapter.create(ctx, d);
          else if (d.headerChanges.length > 0 || d.lines.some((l) => l.changes.length > 0 || l.action === "create")) {
            await adapter.update(ctx, d);
            docs[i].result = { id: d.current!.id, docNo: d.current!.docNo };
          }
        } catch (e) {
          if (!(e instanceof RouteRefusal)) throw e;
          result = done(false, [{ row: d.rows[0] ?? 0, docNo: d.docNo ?? (d.key || "(new)"), message: e.message }]);
          throw new Rollback();
        }
      }
      result = done(true);
      if (!opts.execute) throw new Rollback(); // preview: everything ran, nothing stays
      result.rolledBack = false;
    });
    bound.set(c.var.DB as object); // committed — deferred work sees the real DB
  } catch (e) {
    bound.set(deadDb);
    if (!(e instanceof Rollback)) throw e;
  }
  if (denied) return denied;
  return result!;
}

function docNoColumn(aoa: unknown[][], spec: ImportSpec): number {
  const f = spec.fields.find((x) => x.key === "docNo")!;
  const names = [f.header, ...(f.aliases ?? [])].map((s) => s.toLowerCase());
  return (aoa[0] ?? []).findIndex((h) => names.includes(String(h ?? "").trim().toLowerCase()));
}
