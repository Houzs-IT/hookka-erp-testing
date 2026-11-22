// ---------------------------------------------------------------------------
// price-bom-audit.test.mjs — owner 2026-11-22 (costing pre-work, plan D14):
// who changed a price / BOM is recorded server-side, a deleted supplier price
// keeps its trail, and a product has at most one ACTIVE BOM.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { actorName } from "../src/api/lib/actor-name.ts";
import { oneActivePerProduct, demoteOtherActiveBomsStatement } from "../src/api/lib/bom-single-active.ts";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

function ctx(userId, user) {
  const vars = { userId };
  return {
    get: (k) => vars[k],
    var: {
      DB: {
        prepare: (sql) => ({
          bind: (...b) => ({
            first: async () => {
              assert.match(sql, /FROM users WHERE id = \?/);
              assert.deepEqual(b, [userId]);
              if (user === "throw") throw new Error("db down");
              return user;
            },
          }),
        }),
      },
    },
  };
}

test("actorName: the signed-in user's name wins over whatever the body says", async () => {
  assert.equal(await actorName(ctx("u1", { displayName: "Lim" }), "System"), "Lim");
  assert.equal(await actorName(ctx("u1", { email: "a@b.c" })), "a@b.c");
  assert.equal(await actorName(ctx("u1", null)), "u1");
  assert.equal(await actorName(ctx("u1", "throw")), "u1");
});

test("actorName: no user (cron / system) falls back to the typed value, else System", async () => {
  assert.equal(await actorName(ctx(undefined), "Import"), "Import");
  assert.equal(await actorName(ctx(undefined)), "System");
  assert.equal(await actorName(ctx("system:board-report-prebuild"), " "), "System");
});

test("oneActivePerProduct keeps the newest ACTIVE per product, retires the rest", () => {
  const rows = [
    { id: "a", productCode: "P1", versionStatus: "ACTIVE", effectiveFrom: "2026-01-01" },
    { id: "b", productCode: "P1", versionStatus: "ACTIVE", effectiveFrom: "2026-06-01" },
    { id: "c", productCode: "P1", versionStatus: "DRAFT", effectiveFrom: "2026-09-01" },
    { id: "d", productCode: "P2", versionStatus: "ACTIVE", effectiveFrom: "2026-01-01" },
  ];
  oneActivePerProduct(rows);
  assert.deepEqual(rows.map((r) => r.versionStatus), ["OBSOLETE", "ACTIVE", "DRAFT", "ACTIVE"]);
});

test("demote statement touches only the same product's other ACTIVE rows", () => {
  let seen;
  const db = { prepare: (sql) => ({ bind: (...b) => { seen = { sql, b }; return "stmt"; } }) };
  assert.equal(demoteOtherActiveBomsStatement(db, "P1", "keep"), "stmt");
  assert.match(seen.sql, /SET versionStatus = 'OBSOLETE' WHERE productCode = \? AND id <> \? AND versionStatus = 'ACTIVE'/);
  assert.deepEqual(seen.b, ["P1", "keep"]);
});

test("routes: price writes use actorName, deletes snapshot the price trail, BOM writes are audited + single-active", () => {
  const sm = read("src/api/routes/supplier-materials.ts");
  assert.doesNotMatch(sm, /body\.changedBy \?\? "System"/);
  assert.equal((sm.match(/await actorName\(c, body\.changedBy\)/g) ?? []).length, 2);
  assert.match(sm, /SELECT \* FROM price_histories WHERE bindingId = \?[\s\S]{0,400}action: "delete"[\s\S]{0,200}DELETE FROM supplier_material_bindings/);
  const ph = read("src/api/routes/price-history.ts");
  assert.match(ph, /changedBy: await actorName\(c, body\.changedBy\)/);
  const bom = read("src/api/routes/bom.ts");
  assert.ok((bom.match(/demoteOtherActiveBomsStatement\(/g) ?? []).length >= 3, "POST, PUT :id, bulk-activate");
  assert.match(bom, /oneActivePerProduct\(sanitized\)/);
  assert.ok((bom.match(/resource: "bom-templates"/g) ?? []).length >= 4);
  assert.match(read("src/api/lib/po-cost-cascade.ts"), /versionStatus = 'ACTIVE' ORDER BY effectiveFrom DESC LIMIT 1/);
});
