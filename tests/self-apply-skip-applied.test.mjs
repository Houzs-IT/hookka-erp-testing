// BUG-2026-11-21: right after a deploy, list reads returned fast 500s for a few
// minutes. Every cold isolate re-ran its module's ALTER TABLEs, and Postgres
// takes an ACCESS EXCLUSIVE lock even for an ADD COLUMN IF NOT EXISTS that
// changes nothing (and `ALTER COLUMN … TYPE TEXT USING …` rewrote
// wip_cascade_log every time). The locks queued behind long reads, reads queued
// behind them, and lock timeouts / deadlocks surfaced as 500s.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { statementsStillNeeded, runSelfApply, selfApplyForRead } = await import("../src/api/lib/self-apply.ts");

const cat = {
  tables: new Set(["job_cards", "sales_orders", "wip_cascade_log"]),
  columns: new Map([
    ["job_cards.distributed_at", "text"],
    ["sales_orders.hold_reason", "text"],
    ["wip_cascade_log.org_id", "text"],
  ]),
  indexes: new Set(["idx_wip_cascade_log_jc"]),
};

test("a warm database runs no DDL at all", () => {
  const stmts = [
    "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS distributedAt TEXT",
    "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS hold_reason TEXT",
    "ALTER TABLE wip_cascade_log\n         ALTER COLUMN org_id TYPE TEXT USING org_id::text",
    "CREATE TABLE IF NOT EXISTS wip_cascade_log (id UUID PRIMARY KEY)",
    "CREATE INDEX IF NOT EXISTS idx_wip_cascade_log_jc ON wip_cascade_log (org_id)",
    "DROP INDEX IF EXISTS uniq_wip_cascade_log_transition",
    "ALTER TABLE sales_orders DROP COLUMN IF EXISTS is_project_order",
  ];
  assert.deepEqual(statementsStillNeeded(stmts, cat), []);
});

test("anything genuinely missing, or not recognised, still runs", () => {
  const stmts = [
    "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS qr_token TEXT", // missing column
    "ALTER TABLE new_table ADD COLUMN IF NOT EXISTS x TEXT", // missing table
    "CREATE INDEX IF NOT EXISTS ix_new ON job_cards (qr_token)", // missing index
    "DROP INDEX IF EXISTS idx_wip_cascade_log_jc", // present -> drop runs
    "ALTER TABLE sales_orders DROP COLUMN IF EXISTS hold_reason", // present -> drop runs
    "UPDATE sales_orders SET sales_org_code = 'HOOKKA' WHERE sales_org_code IS NULL", // not DDL we parse
  ];
  assert.deepEqual(statementsStillNeeded(stmts, cat), stmts);
});

test("a type flip runs only when the column is not text yet", () => {
  const sql = "ALTER TABLE wip_cascade_log ALTER COLUMN org_id TYPE TEXT USING org_id::text";
  const uuid = { ...cat, columns: new Map([["wip_cascade_log.org_id", "uuid"]]) };
  assert.deepEqual(statementsStillNeeded([sql], uuid), [sql]);
});

test("if the catalog read fails, every statement runs as before", async () => {
  const ran = [];
  const db = { prepare: (sql) => ({ run: async () => { ran.push(sql); } }) }; // no all(): catalog read fails
  await runSelfApply(db, "t", ["ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS a TEXT", "SELECT 1"]);
  assert.equal(ran.length, 2);
});

test("with a catalog, applied statements are skipped", async () => {
  const ran = [];
  const db = {
    prepare: (sql) => ({
      bind: () => ({
        all: async () =>
          /information_schema/.test(sql)
            ? { results: [{ t: "job_cards", c: "a", d: "text" }] }
            : { results: [] },
        run: async () => { ran.push(sql); },
      }),
      run: async () => { ran.push(sql); },
    }),
  };
  await runSelfApply(db, "t", ["ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS a TEXT", "ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS b TEXT"]);
  assert.deepEqual(ran, ["ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS b TEXT"]);
});

test("reads never fail on a self-apply error; the list and stats routes use it", async () => {
  await selfApplyForRead("t", async () => { throw new Error("deadlock detected"); });
  const po = readFileSync("src/api/routes/production-orders.ts", "utf8");
  assert.match(po, /await selfApplyForRead\("production-orders", \(\) => ensurePendingMigrations\(c\.var\.DB\)\);/);
  const so = readFileSync("src/api/routes/sales-orders.ts", "utf8");
  assert.equal((so.match(/await selfApplyForRead\("sales-orders", \(\) => ensurePendingMigrations\(/g) || []).length, 2);
});
