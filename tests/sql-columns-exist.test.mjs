// ---------------------------------------------------------------------------
// sql-columns-exist.test.mjs — does the column the SQL asks for actually exist?
//
// sql-write-column-coverage.test.mjs already checks that a camelCase column
// written by a route HAS a rename-map entry. This is the other half, and it is
// the half that kept shipping 500s:
//
//     SELECT id, poNumber, itemCategory FROM production_orders
//
// `poNumber` IS in the map — it maps to `po_number`, which is a real column on
// grns / goods_in_transit / three_way_matches. production_orders stores po_no.
// So the rewrite succeeds, the coverage test passes, and the query dies in
// production on a column that table has never had. That exact statement 500'd
// /api/accounting/wip-detail and /cleanup-report until 2026-08-02, and the same
// shape was live in the assistant's export tools (workers.role, customers.hub,
// delivery_orders.totalSen, raw_materials.name…) and in the RM stock-adjustment
// write path.
//
// The schema snapshot is tests/db-schema.json — CI has no database. Refresh it
// after a migration:  node scripts/refresh-db-schema-fixture.mjs
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const SCHEMA = JSON.parse(readFileSync("tests/db-schema.json", "utf8"));
const MAP = JSON.parse(readFileSync("src/api/lib/column-rename-map.json", "utf8"));

/** What the compat shim will actually send to Postgres. */
const physical = (id) => MAP[id] ?? (/[A-Z]/.test(id) ? id.toLowerCase() : id);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Only the flat, unambiguous shape: a plain column list then FROM one table.
// Anything with a JOIN, alias, subquery, `*` or an expression is skipped — this
// is a net for the boring majority, not a SQL parser. A skipped statement is a
// statement this test makes no claim about.
const STMT = /SELECT\s+([A-Za-z0-9_,\s]+?)\s+FROM\s+([a-z_][a-z0-9_]*)/gi;

test("every SELECTed column exists on the table it is read from", () => {
  const bad = [];
  const seen = new Set();
  for (const file of walk("src/api")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(STMT)) {
      const table = m[2].toLowerCase();
      const known = SCHEMA[table];
      if (!known) continue; // CTE, alias, temp table, or a table not in prod
      const cols = m[1]
        .split(",")
        .map((s) => s.trim())
        // `SELECT 1 FROM x` is an existence probe, not a column read.
        .filter((s) => s && !/^\d+$/.test(s) && !/^(distinct|all)$/i.test(s) && !/\s/.test(s));
      for (const col of cols) {
        const key = `${table}.${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (known.includes(physical(col)) || known.includes(col)) continue;
        const guess = known.find(
          (k) => k.replace(/_/g, "") === col.toLowerCase().replace(/_/g, ""),
        );
        bad.push(
          `${file}: SELECT ${col} FROM ${table} → "${physical(col)}" does not exist` +
            (guess ? ` (did you mean ${guess}?)` : ""),
        );
      }
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join("\n")}\n`);
});

// HK-0109 / BUG-2026-10-20-348: CN convert-to-invoice and CN /return both set
// customers.updated_at, a column customers has never had. The write sits in an
// atomic DB.batch, so the whole convert rolled back. Checked for customers only:
// every `UPDATE customers SET a = …, b = …` column must exist, either in the
// snapshot or via a route's own `ALTER TABLE customers ADD COLUMN IF NOT EXISTS`.
test("every column an UPDATE customers sets exists on customers", () => {
  const files = walk("src/api").map((f) => [f, readFileSync(f, "utf8")]);
  const known = new Set(SCHEMA.customers);
  for (const [, src] of files) {
    for (const [, col] of src.matchAll(/ALTER TABLE customers ADD COLUMN IF NOT EXISTS (\w+)/gi)) known.add(col);
  }
  const bad = [];
  for (const [file, src] of files) {
    for (const m of src.matchAll(/UPDATE\s+customers\s+SET\s+([\s\S]+?)\s+WHERE\b/gi)) {
      for (const [, col] of m[1].matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
        if (!known.has(physical(col))) {
          bad.push(`${file}: UPDATE customers SET ${col} → "${physical(col)}" does not exist`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join("\n")}\n`);
});

test("the schema snapshot is present and plausible", () => {
  // A truncated or empty snapshot would make the test above pass vacuously.
  const tables = Object.keys(SCHEMA);
  assert.ok(tables.length > 100, `only ${tables.length} tables in the snapshot`);
  for (const t of ["production_orders", "workers", "payslips", "raw_materials"]) {
    assert.ok(SCHEMA[t]?.length > 3, `${t} missing or near-empty in the snapshot`);
  }
  // The two that started this: proof the snapshot records the real names.
  assert.ok(SCHEMA.production_orders.includes("po_no"));
  assert.ok(!SCHEMA.production_orders.includes("po_number"));
  assert.ok(SCHEMA.raw_materials.includes("description"));
  assert.ok(!SCHEMA.raw_materials.includes("name"));
});
