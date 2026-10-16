// BUG-2026-10-16-303: a self-apply `ALTER TABLE t ADD COLUMN IF NOT EXISTS c`
// takes an ACCESS EXCLUSIVE lock on t even when c already exists, and every
// later query on t queues behind it. The adapter now looks c up first and skips
// the ALTER when it is already there.
// Run: node --import tsx/esm --test tests/self-apply-skip-existing-column.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { PgBoundStatement, parseAddColumnIfNotExists, translateSql } from "../src/api/lib/supabase-compat.ts";

test("TC-01 parses the self-apply shape and folds unquoted names like Postgres", () => {
  assert.deepEqual(parseAddColumnIfNotExists("ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS completed_at TEXT"), {
    table: "job_cards",
    column: "completed_at",
  });
  assert.deepEqual(parseAddColumnIfNotExists("  alter table public.Job_Cards add column if not exists repairScope TEXT"), {
    table: "job_cards",
    column: "repairscope",
  });
  assert.deepEqual(parseAddColumnIfNotExists('ALTER TABLE "Weird" ADD COLUMN IF NOT EXISTS "camelCol" INTEGER DEFAULT 0'), {
    table: "Weird",
    column: "camelCol",
  });
});

test("TC-02 anything else is not touched", () => {
  for (const sql of [
    "SELECT 1",
    "ALTER TABLE job_cards ADD COLUMN completed_at TEXT",
    "ALTER TABLE job_cards ALTER COLUMN x DROP NOT NULL",
    "ALTER TABLE t ADD COLUMN IF NOT EXISTS a TEXT, ADD COLUMN IF NOT EXISTS b TEXT",
    "CREATE INDEX IF NOT EXISTS i ON job_cards(x)",
  ]) {
    assert.equal(parseAddColumnIfNotExists(sql), null, sql);
  }
});

test("TC-03 the check uses the name after the adapter's own rename", () => {
  // distributedAt is renamed by column-rename-map.json; the column that exists is distributed_at.
  assert.deepEqual(
    parseAddColumnIfNotExists(translateSql("ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS distributedAt TEXT")),
    { table: "job_cards", column: "distributed_at" },
  );
});

function fakeSql({ exists, lookupThrows = false }) {
  const calls = [];
  return {
    calls,
    unsafe: async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (/information_schema\.columns/.test(sql)) {
        if (lookupThrows) throw new Error("lookup down");
        return exists ? [{ "?column?": 1 }] : [];
      }
      return Object.assign([], { count: 0 });
    },
  };
}
const alters = (calls) => calls.filter((c) => /^ALTER TABLE/.test(c.sql));
const lookups = (calls) => calls.filter((c) => /information_schema/.test(c.sql));

test("TC-04 an existing column skips the ALTER, and the answer is remembered", async () => {
  const sql = fakeSql({ exists: true });
  const alter = "ALTER TABLE tc04 ADD COLUMN IF NOT EXISTS done_at TEXT";
  const res = await new PgBoundStatement(sql, alter, []).run();
  assert.equal(res.success, true);
  assert.equal(alters(sql.calls).length, 0, "no ALTER, so no table lock");
  assert.deepEqual(lookups(sql.calls)[0].params, ["tc04", "done_at"]);
  assert.match(lookups(sql.calls)[0].sql, /table_schema = 'public'/, "same schema as the other lookups");
  await new PgBoundStatement(sql, alter, []).run();
  assert.equal(lookups(sql.calls).length, 1, "second time comes from memory");
});

test("TC-05 a missing column still runs the ALTER", async () => {
  const sql = fakeSql({ exists: false });
  await new PgBoundStatement(sql, "ALTER TABLE tc05 ADD COLUMN IF NOT EXISTS new_col TEXT", []).run();
  assert.equal(alters(sql.calls).length, 1);
});

test("TC-06 a failed lookup runs the ALTER as before", async () => {
  const sql = fakeSql({ exists: true, lookupThrows: true });
  await new PgBoundStatement(sql, "ALTER TABLE tc06 ADD COLUMN IF NOT EXISTS c TEXT", []).run();
  assert.equal(alters(sql.calls).length, 1);
});

test("TC-07 all() and first() skip the same way; other statements do no lookup", async () => {
  const sql = fakeSql({ exists: true });
  assert.deepEqual((await new PgBoundStatement(sql, "ALTER TABLE tc07 ADD COLUMN IF NOT EXISTS a TEXT", []).all()).results, []);
  assert.equal(await new PgBoundStatement(sql, "ALTER TABLE tc07 ADD COLUMN IF NOT EXISTS b TEXT", []).first(), null);
  assert.equal(alters(sql.calls).length, 0);
  const before = sql.calls.length;
  await new PgBoundStatement(sql, "SELECT * FROM job_cards WHERE id = $1", ["x"]).all();
  assert.equal(sql.calls.length, before + 1, "a plain SELECT runs once with no lookup");
});
