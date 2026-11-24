// ---------------------------------------------------------------------------
// self-apply-no-raw-alter.test.mjs — a memoized self-apply round must not send
// `ALTER TABLE … ADD COLUMN` straight to the database (BUG-2026-11-24-556).
//
// Postgres takes an ACCESS EXCLUSIVE lock for every ALTER TABLE, even one that
// does nothing. Since BUG-2026-11-24-553 every cold request runs its own round,
// so a raw ALTER is sent once per concurrent cold request after a deploy.
// runSelfApply reads the catalog first and sends only what is missing.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureDeductionSourceColumn,
  _resetDeductionSourceMigForTests,
} from "../src/api/lib/attendance-deduct.ts";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** The text of each `memoizeSelfApply( … )` call, matched by parentheses. */
function rounds(src) {
  const out = [];
  for (const m of src.matchAll(/memoizeSelfApply\(/g)) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (depth && i < src.length) {
      const ch = src[i++];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    out.push({ line: src.slice(0, m.index).split("\n").length, body: src.slice(m.index, i) });
  }
  return out;
}

// Follow-up, not yet converted: its ALTERs are on a small table and each one
// carries its own retry flag, so it needs its own change.
const KNOWN = new Set(["src/api/routes/announcements.ts"]);

test("no memoized round sends a raw ALTER TABLE … ADD COLUMN", () => {
  const bad = [];
  for (const file of walk("src/api")) {
    const rel = file.replace(/\\/g, "/");
    if (KNOWN.has(rel)) continue;
    for (const r of rounds(readFileSync(file, "utf8"))) {
      if (/\.prepare\(\s*[`"']\s*ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i.test(r.body)) bad.push(`${rel}:${r.line}`);
    }
  }
  assert.deepEqual(bad, [], `send these through runSelfApply:\n${bad.join("\n")}`);
});

test("PV approval round rebuilds the status CHECK only when DRAFT is not allowed yet", () => {
  const src = readFileSync("src/api/routes/accounting.ts", "utf8");
  const start = src.indexOf("function ensurePvApprovalCols(");
  const end = src.indexOf("\nconst PV_DRAFT_PREFIX", start);
  assert.ok(start > 0 && end > start, "ensurePvApprovalCols found");
  const body = src.slice(start, end);
  const read = body.indexOf("pg_get_constraintdef(oid)");
  const guard = body.indexOf(`if (!chk?.def?.includes("'DRAFT'")) {`);
  assert.ok(read > 0 && guard > read, "reads pg_constraint, then guards");
  assert.ok(body.indexOf("DROP CONSTRAINT IF EXISTS payment_vouchers_status_check") > guard);
  assert.ok(body.indexOf("ADD CONSTRAINT payment_vouchers_status_check") > guard);
});

test("organisations round drops organisations_code_check only while it exists", () => {
  const src = readFileSync("src/api/routes/organisations.ts", "utf8");
  const start = src.indexOf("function ensureOrganisationRegistry(");
  const end = src.indexOf("\n}\n", start);
  assert.ok(start > 0 && end > start, "ensureOrganisationRegistry found");
  const body = src.slice(start, end);
  assert.match(body, /FROM pg_constraint WHERE conname = 'organisations_code_check'/);
  assert.match(body, /runSelfApply\(db, "organisations", chk \? stmts : stmts\.filter\(\(sql\) => !sql\.includes\("DROP CONSTRAINT"\)\)\)/);
});

/** A db whose catalog already has `table.column`; records every statement run. */
function fakeDb(table, column) {
  const ran = [];
  const all = async (sql) => ({
    results: /information_schema\.columns/.test(sql) ? [{ t: table, c: column, d: "text" }] : [],
  });
  return {
    ran,
    prepare(sql) {
      return {
        bind: () => ({ all: () => all(sql), run: async () => { ran.push(sql); } }),
        all: () => all(sql),
        run: async () => { ran.push(sql); },
      };
    },
    batch: async () => [],
  };
}

test("a round whose column already exists sends no ALTER", async () => {
  _resetDeductionSourceMigForTests();
  const db = fakeDb("payroll_hour_deductions", "source");
  await ensureDeductionSourceColumn(db);
  assert.deepEqual(db.ran.filter((s) => /ALTER/i.test(s)), []);

  _resetDeductionSourceMigForTests();
  const cold = fakeDb("payroll_hour_deductions", "other");
  await ensureDeductionSourceColumn(cold);
  assert.equal(cold.ran.filter((s) => /ALTER TABLE payroll_hour_deductions ADD COLUMN/i.test(s)).length, 1);
  _resetDeductionSourceMigForTests();
});
