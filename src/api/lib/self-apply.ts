// ---------------------------------------------------------------------------
// self-apply.ts — run a module's runtime DDL so that a FAILURE is loud and
// RETRIED, instead of silent and permanent.
//
// Why this exists
// ---------------
// Migrations are inert on deploy in this repo (CLAUDE.md): a new column reaches
// production ONLY through an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` awaited at
// the top of the first write. Every one of those blocks was written as:
//
//     pending = (async () => {
//       for (const sql of stmts) {
//         try { await db.prepare(sql).run(); } catch { /* ignore */ }
//       }
//     })();
//
// Two things compound there. The catch swallows EVERY error unconditionally,
// and the memo is a module-scope promise set once per isolate boot — and it is
// still marked RESOLVED. So if the first write after an isolate boots hits a
// transient DB blip (a cold Hyperdrive pool, which this repo runs a keep-warm
// cron against precisely because it happens), the column is never applied and
// never retried for the life of that isolate. Every subsequent write in that
// isolate then fails on a missing column, and nothing anywhere says why.
//
// Houzs-ERP's `pg-migration-dropped-defaults` COE is the same lesson from the
// other direction: when the runtime path is the ONLY path, it cannot be
// best-effort.
//
// What this does differently
// --------------------------
//   * "already exists" / "does not exist" are EXPECTED — these statements are
//     written to be idempotent, and re-running them is the normal case.
//   * anything else is logged with the statement that failed, so the next
//     person sees a cause instead of a mystery missing column.
//   * a real failure THROWS, so the caller's memo can be cleared and the next
//     request retries. It does not silently continue.
//
// It deliberately does NOT change what the request does next: callers keep the
// existing behaviour of letting the write below surface the schema error with a
// clearer message. The only thing that changes is that the next request gets
// another chance.
// ---------------------------------------------------------------------------

/** Errors these statements are WRITTEN to produce — re-running is the normal case. */
const BENIGN =
  /already exists|does not exist|duplicate (column|object|key|table)|IF NOT EXISTS|IF EXISTS/i;

export function isBenignSelfApplyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return BENIGN.test(msg);
}

// Two prepared-statement shapes exist in this codebase: the D1-compat one that
// can `.run()` directly, and the narrower DbLike interfaces some modules declare
// locally, which require a `.bind()` first. Accept both — the adapter treats
// `.run()` and `.bind().run()` identically for a parameterless statement, and
// forcing 20 call sites to converge on one shape is a bigger change than this
// fix earns.
type Runnable = { run(): Promise<unknown>; all?: () => Promise<{ results?: unknown[] }> };
type Bindable = { bind(...args: unknown[]): Runnable };
type Runner = {
  prepare(sql: string): Partial<Runnable> & Partial<Bindable>;
};

// ---------------------------------------------------------------------------
// Skip what is already applied (BUG-2026-11-21: 500s right after a deploy).
//
// Postgres takes an ACCESS EXCLUSIVE lock for EVERY `ALTER TABLE`, including
// `ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS` that end up doing
// nothing. A deploy boots many isolates at once, each running its module's
// block on the hottest tables (sales_orders, job_cards, …): the ALTERs queue
// behind long reads, every later read queues behind the ALTERs, and some
// requests die on a lock timeout or a deadlock — which is not "benign", so the
// read that triggered it returned 500 until the isolates settled. One worse
// case: `ALTER COLUMN … TYPE TEXT USING …` rewrites the whole table every time.
//
// So before running, one read-only look at the catalog drops every statement
// whose effect is already there. A warm database runs no DDL at all; a
// genuinely missing column still gets added exactly as before. Statements this
// does not recognise run as before, and if the catalog read itself fails the
// whole list runs as before.
// ---------------------------------------------------------------------------
const ADD_COLUMN = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/i;
const DROP_COLUMN = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+"?(\w+)"?\s*;?\s*$/i;
const COLUMN_TYPE_TEXT = /^\s*ALTER\s+TABLE\s+"?(\w+)"?\s+ALTER\s+COLUMN\s+"?(\w+)"?\s+TYPE\s+TEXT\b/i;
const CREATE_INDEX = /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/i;
const DROP_INDEX = /^\s*DROP\s+INDEX\s+IF\s+EXISTS\s+"?(\w+)"?\s*;?\s*$/i;
const CREATE_TABLE = /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/i;

/** The adapter stores camelCase columns snake_case; unquoted names fold to lower case. */
function columnNames(name: string): string[] {
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return [...new Set([snake, name.toLowerCase()])];
}

type Catalog = {
  tables: Set<string>;
  columns: Map<string, string>; // "table.column" -> data_type
  indexes: Set<string>;
};

/**
 * Which statements still need to run, given the catalog. Exported for tests.
 * A statement is dropped only when the catalog PROVES it would change nothing.
 */
export function statementsStillNeeded(stmts: string[], cat: Catalog): string[] {
  return stmts.filter((sql) => {
    let m = ADD_COLUMN.exec(sql);
    if (m) {
      const t = m[1].toLowerCase();
      return !(cat.tables.has(t) && columnNames(m[2]).some((c) => cat.columns.has(`${t}.${c}`)));
    }
    m = DROP_COLUMN.exec(sql);
    if (m) {
      const t = m[1].toLowerCase();
      return cat.tables.has(t) && columnNames(m[2]).some((c) => cat.columns.has(`${t}.${c}`));
    }
    m = COLUMN_TYPE_TEXT.exec(sql);
    if (m) {
      const t = m[1].toLowerCase();
      const type = columnNames(m[2]).map((c) => cat.columns.get(`${t}.${c}`)).find((x) => x != null);
      return !(type && type.toLowerCase() === "text");
    }
    m = CREATE_INDEX.exec(sql);
    if (m) return !cat.indexes.has(m[1].toLowerCase());
    m = DROP_INDEX.exec(sql);
    if (m) return cat.indexes.has(m[1].toLowerCase());
    m = CREATE_TABLE.exec(sql);
    if (m) return !cat.tables.has(m[1].toLowerCase());
    return true;
  });
}

/** Tables the recognised statements touch (the catalog read is scoped to them). */
function tablesOf(stmts: string[]): string[] {
  const out = new Set<string>();
  for (const sql of stmts) {
    const m = ADD_COLUMN.exec(sql) || DROP_COLUMN.exec(sql) || COLUMN_TYPE_TEXT.exec(sql) || CREATE_TABLE.exec(sql);
    if (m) out.add(m[1].toLowerCase());
  }
  return [...out];
}

async function readCatalog(db: Runner, tables: string[]): Promise<Catalog | null> {
  const rows = async (sql: string, args: unknown[]): Promise<Record<string, unknown>[]> => {
    const stmt = db.prepare(sql);
    const bound = typeof stmt.bind === "function" ? stmt.bind(...args) : (stmt as Runnable);
    if (typeof bound.all !== "function") throw new Error("self-apply: catalog read needs all()");
    const res = await bound.all();
    return (res?.results ?? []) as Record<string, unknown>[];
  };
  try {
    const cat: Catalog = { tables: new Set(), columns: new Map(), indexes: new Set() };
    if (tables.length > 0) {
      const ph = tables.map(() => "?").join(",");
      for (const r of await rows(
        `SELECT table_name AS "t", column_name AS "c", data_type AS "d"
           FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name IN (${ph})`,
        tables,
      )) {
        const t = String(r.t ?? "").toLowerCase();
        if (!t) continue;
        cat.tables.add(t);
        cat.columns.set(`${t}.${String(r.c ?? "").toLowerCase()}`, String(r.d ?? ""));
      }
    }
    for (const r of await rows(
      `SELECT indexname AS "i" FROM pg_indexes WHERE schemaname = current_schema()`,
      [],
    )) {
      cat.indexes.add(String(r.i ?? "").toLowerCase());
    }
    return cat;
  } catch (err) {
    console.warn("[self-apply] catalog read failed; running every statement", err);
    return null;
  }
}

function runnableFor(stmt: Partial<Runnable> & Partial<Bindable>): Runnable {
  if (typeof stmt.run === "function") return stmt as Runnable;
  if (typeof stmt.bind === "function") return stmt.bind();
  throw new Error("self-apply: prepared statement can neither run() nor bind()");
}

/**
 * Run one module's self-applied DDL.
 *
 * Every statement is attempted even if an earlier one fails, so a permission
 * problem on one ALTER cannot mask the rest — that part of the original
 * best-effort loop was right and is kept.
 *
 * @throws if any statement failed for a reason that is NOT benign. The caller
 *         is expected to clear its memo in the rejection path so the next
 *         request retries; see `ensurePendingMigrations` in
 *         routes/sales-orders/_helpers.ts for the shape.
 */
export async function runSelfApply(
  db: Runner,
  label: string,
  stmts: string[],
): Promise<void> {
  const failures: { sql: string; msg: string }[] = [];
  const cat = await readCatalog(db, tablesOf(stmts));
  const todo = cat ? statementsStillNeeded(stmts, cat) : stmts;
  for (const sql of todo) {
    try {
      await runnableFor(db.prepare(sql)).run();
    } catch (err) {
      if (isBenignSelfApplyError(err)) continue;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ sql, msg });
      // Log per statement: which ALTER failed is the whole diagnosis.
      console.error(`[self-apply:${label}] FAILED: ${sql}\n  → ${msg}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `self-apply "${label}" failed on ${failures.length} statement(s); ` +
        `first: ${failures[0].sql} → ${failures[0].msg}`,
    );
  }
}

/**
 * For READ paths: run the module's self-apply, but never fail the read on it.
 * A list or a stats card should not 500 because a concurrent isolate holds a
 * DDL lock (BUG-2026-11-21); the failure is logged and the memo is already
 * cleared by the module, so the next request retries. Write paths keep
 * awaiting the self-apply directly so a missing column still stops them.
 */
export async function selfApplyForRead(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[self-apply:${label}] skipped for a read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The memo wrapper the call sites need: run once per isolate, but DROP the memo
 * if the round failed so the next request tries again.
 *
 * `getMemo`/`setMemo` rather than an internal map because the existing call
 * sites export their promise (tests and other modules await it), and changing
 * that binding is a bigger blast radius than this fix is worth.
 */
export function memoizeSelfApply(
  getMemo: () => Promise<void> | null,
  setMemo: (p: Promise<void> | null) => void,
  run: () => Promise<void>,
): Promise<void> {
  const hit = getMemo();
  if (hit) return hit;
  const p = run().catch((err) => {
    // The failed round must not be remembered as done — that is the entire bug.
    setMemo(null);
    throw err;
  });
  setMemo(p);
  return p;
}
