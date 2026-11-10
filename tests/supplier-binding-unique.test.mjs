// O4 (cross-system review 2026-11-10, sister Houzs#5486 / #5509): a supplier
// is bound to an item once. The route refuses a second binding with 409 and a
// plain message; the unique index is self-applied ONLY when no old duplicates
// exist (skipped and logged otherwise — no row is deleted or merged); a
// read-only endpoint lists the pairs that block it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BINDING_UNIQUE_INDEX,
  duplicateBindingMessage,
  ensureBindingUniqueIndex,
  findSameBinding,
  groupDuplicateRows,
  isUniqueViolation,
  resetBindingUniqueIndexMemo,
} from "../src/api/lib/supplier-binding-unique.ts";

function fakeDb({ dupGroups = 0, firstRow = null, createThrows = null } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...args) {
          stmt.args = args;
          return stmt;
        },
        async first() {
          calls.push({ sql, args: stmt.args, op: "first" });
          if (/COUNT\(\*\) AS "n"/.test(sql)) return { n: dupGroups };
          return firstRow;
        },
        async run() {
          calls.push({ sql, args: stmt.args, op: "run" });
          if (createThrows && /CREATE UNIQUE INDEX/.test(sql)) throw createThrows;
          return {};
        },
        async all() {
          calls.push({ sql, args: stmt.args, op: "all" });
          return { results: [] };
        },
      };
      return stmt;
    },
  };
}

test("the index is created when no duplicate pairs exist", async () => {
  resetBindingUniqueIndexMemo();
  const db = fakeDb({ dupGroups: 0 });
  assert.equal(await ensureBindingUniqueIndex(db), "created");
  const create = db.calls.find((c) => /CREATE UNIQUE INDEX IF NOT EXISTS/.test(c.sql));
  assert.ok(create, "CREATE UNIQUE INDEX was not run");
  assert.match(create.sql, new RegExp(BINDING_UNIQUE_INDEX));
  assert.match(create.sql, /supplier_material_bindings \(org_id, supplier_id, material_code\)/);
  // Memoised: a second call does not re-run anything.
  const n = db.calls.length;
  assert.equal(await ensureBindingUniqueIndex(db), "created");
  assert.equal(db.calls.length, n);
});

test("duplicates present: the index is skipped, nothing is written, the request is not failed", async () => {
  resetBindingUniqueIndexMemo();
  const db = fakeDb({ dupGroups: 2 });
  const warn = console.warn;
  const logged = [];
  console.warn = (...a) => logged.push(a.join(" "));
  try {
    assert.equal(await ensureBindingUniqueIndex(db), "skipped-duplicates");
  } finally {
    console.warn = warn;
  }
  assert.ok(!db.calls.some((c) => /CREATE UNIQUE INDEX/.test(c.sql)), "index must not be attempted");
  assert.ok(
    !db.calls.some((c) => /\b(DELETE|UPDATE|INSERT)\b/i.test(c.sql)),
    "no row may be deleted, merged or written",
  );
  assert.ok(logged.some((l) => /2 supplier\+material pair\(s\)/.test(l) && /duplicates/.test(l)));
});

test("a failed CREATE never throws and is retried by the next request", async () => {
  resetBindingUniqueIndexMemo();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const db = fakeDb({ createThrows: new Error("could not create unique index") });
    assert.equal(await ensureBindingUniqueIndex(db), "failed");
    const ok = fakeDb();
    assert.equal(await ensureBindingUniqueIndex(ok), "created");
  } finally {
    console.warn = warn;
    resetBindingUniqueIndexMemo();
  }
});

test("findSameBinding scopes to org + supplier + material and excludes the row being edited", async () => {
  const db = fakeDb({ firstRow: { id: "smb-1", supplierName: "Ocean Sky" } });
  const hit = await findSameBinding(db, "hookka", "sup-1", "PC151-01", "smb-9");
  assert.deepEqual(hit, { id: "smb-1", supplierName: "Ocean Sky" });
  const call = db.calls.at(-1);
  assert.match(call.sql, /b\.orgId = \? AND b\.supplierId = \? AND b\.materialCode = \? AND b\.id <> \?/);
  assert.deepEqual(call.args, ["hookka", "sup-1", "PC151-01", "smb-9"]);
  assert.equal(await findSameBinding(fakeDb(), "hookka", "sup-1", "X"), null);
});

test("unique violations are recognised across Postgres / SQLite / adapter text", () => {
  assert.ok(isUniqueViolation({ code: "23505", message: "x" }));
  assert.ok(isUniqueViolation(new Error('duplicate key value violates unique constraint "ux"')));
  assert.ok(isUniqueViolation(new Error("UNIQUE constraint failed: supplier_material_bindings")));
  assert.ok(!isUniqueViolation(new Error("column foo does not exist")));
});

test("the refusal is a plain sentence the UI shows as-is", () => {
  assert.equal(
    duplicateBindingMessage("Ocean Sky", "PC151-01"),
    "Ocean Sky is already bound to PC151-01. Edit the existing binding instead of adding another.",
  );
  assert.match(duplicateBindingMessage("", "X"), /^This supplier is already bound to X\./);
});

test("duplicate report groups rows per pair (dual-keyed)", () => {
  const groups = groupDuplicateRows([
    { id: "a", orgId: "hookka", supplierId: "s1", materialCode: "M1", supplierName: "S One" },
    { id: "b", org_id: "hookka", supplier_id: "s1", material_code: "M1" },
    { id: "c", orgId: "hookka", supplierId: "s2", materialCode: "M1" },
    { id: "d", orgId: "hookka", supplierId: "s2", materialCode: "M1" },
    { id: "e", orgId: "hookka", supplierId: "s2", materialCode: "M1" },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    orgId: "hookka",
    supplierId: "s1",
    supplierName: "S One",
    materialCode: "M1",
    count: 2,
    bindingIds: ["a", "b"],
  });
  assert.equal(groups[1].count, 3);
});

test("route wiring: index ensured, pre-check before INSERT/UPDATE, 409 on the race, read-only report", () => {
  const src = readFileSync("src/api/routes/supplier-materials.ts", "utf8");
  const post = src.slice(src.indexOf('app.post("/"'), src.indexOf('app.get("/duplicates"'));
  assert.match(post, /await ensureBindingUniqueIndex\(c\.var\.DB\)/);
  assert.ok(post.indexOf("findSameBinding(") < post.indexOf("INSERT INTO supplier_material_bindings"));
  assert.match(post, /409/);
  assert.match(post, /isUniqueViolation\(err\)/);
  // The created row lands in the caller's org (the GET filters by it).
  assert.match(post, /INSERT INTO supplier_material_bindings \(id, orgId, supplierId/);

  const put = src.slice(src.indexOf('app.put("/:id"'), src.indexOf('app.delete("/:id"'));
  assert.match(put, /await ensureBindingUniqueIndex\(c\.var\.DB\)/);
  assert.ok(put.indexOf("findSameBinding(") < put.indexOf("UPDATE supplier_material_bindings SET"));
  assert.match(put, /isUniqueViolation\(err\)/);

  // /duplicates is registered BEFORE /:id (or "duplicates" would be read as an id)
  // and only reads.
  assert.ok(src.indexOf('app.get("/duplicates"') < src.indexOf('app.get("/:id"'));
  const dup = src.slice(src.indexOf('app.get("/duplicates"'), src.indexOf('app.get("/:id"'));
  assert.match(dup, /requirePermission\(c, "supplier-materials", "read"\)/);
  assert.doesNotMatch(dup, /\b(DELETE|UPDATE|INSERT)\b/);
});
