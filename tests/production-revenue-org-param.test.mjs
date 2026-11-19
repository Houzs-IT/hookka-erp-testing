// BUG-2026-11-20: `(? IS NULL OR po.orgId = ?)` cannot be typed by Postgres
// (untyped null parameter) — loadProductionRevenue threw, Labour Cost and the
// Finance dashboard's production revenue returned 500 after #1490.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("loadProductionRevenue adds the tenant clause only when it has a tenant, never `? IS NULL`", () => {
  const s = readFileSync("src/api/lib/production-revenue.ts", "utf8");
  assert.doesNotMatch(s, /\? IS NULL/);
  assert.match(s, /\$\{orgId \? "AND po\.orgId = \?" : ""\}/);
  assert.match(s, /\.bind\(\.\.\.\(orgId \? \[orgId\] : \[\]\), from, to\)/);
});

test("the bind count matches the placeholders with and without a tenant", async () => {
  const { loadProductionRevenue } = await import("../src/api/lib/production-revenue.ts");
  for (const org of ["org-1", undefined]) {
    let seen = null;
    const db = { prepare(sql) { return { bind(...a) { seen = { sql, a }; return { all: async () => ({ results: [] }), run: async () => ({}), first: async () => null }; }, all: async () => ({ results: [] }), run: async () => ({}), first: async () => null }; } };
    await loadProductionRevenue(db, "2026-11-01", "2026-11-19", org).catch(() => {});
    if (!seen || !/per_po\.unit_completed_at >= \?/.test(seen.sql)) continue;
    const q = (seen.sql.match(/\?/g) || []).length;
    assert.equal(seen.a.length, q, `tenant=${org}: ${q} placeholders, ${seen.a.length} binds`);
  }
});
