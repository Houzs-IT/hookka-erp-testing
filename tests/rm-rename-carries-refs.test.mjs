import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRmRenameStatements } from "../src/api/lib/rm-rename.ts";

function fakeDb(clashCount) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind: (...args) => {
          calls.push({ sql, args });
          return {
            sql,
            args,
            first: async () => ({ n: clashCount }),
            run: async () => ({}),
          };
        },
        run: async () => ({}),
      };
    },
  };
}

test("a rename carries supplier bindings, BOM child lines and price history", async () => {
  const db = fakeDb(0);
  const plan = await buildRmRenameStatements(db, "rm1", "pc151-01", "PC151-01A");
  assert.equal(plan.carried, true);
  const sqls = plan.statements.map((s) => s.sql).join("\n");
  assert.match(sqls, /UPDATE supplier_material_bindings SET materialCode = \?/);
  assert.match(sqls, /UPDATE component_bom_lines SET child_code = \?/);
  assert.match(sqls, /UPDATE price_histories SET material_code = \?/);
  for (const s of plan.statements) {
    // O4: the binding move skips a supplier already bound to the new code.
    const expected = /supplier_material_bindings/.test(s.sql)
      ? ["PC151-01A", "PC151-01", "PC151-01A"]
      : ["PC151-01A", "PC151-01"];
    assert.deepEqual(s.args, expected);
  }
  assert.match(sqls, /AND supplierId NOT IN \(\s*SELECT supplierId FROM supplier_material_bindings/);
});

test("nothing moves when another raw material holds the old or new code", async () => {
  const plan = await buildRmRenameStatements(fakeDb(1), "rm1", "A", "B");
  assert.equal(plan.carried, false);
  assert.match(plan.reason, /another raw material already uses A or B/);
});

test("same code (case / spaces only) is not a rename", async () => {
  const plan = await buildRmRenameStatements(fakeDb(0), "rm1", " abc ", "ABC");
  assert.equal(plan.carried, false);
  assert.equal(plan.reason, "code unchanged");
});

test("the update route runs it in the batch and the page shows a skipped rename", () => {
  const route = readFileSync("src/api/routes/raw-materials.ts", "utf8");
  assert.match(route, /buildRmRenameStatements\(c\.var\.DB, id, existing\.itemCode, merged\.itemCode\)/);
  assert.match(route, /if \(plan\.carried\) cascadeStmts\.push\(\.\.\.plan\.statements\)/);
  const page = readFileSync("src/pages/inventory/index.tsx", "utf8");
  assert.match(page, /if \(j\.warning\) toast\.warning\(j\.warning\)/);
});
