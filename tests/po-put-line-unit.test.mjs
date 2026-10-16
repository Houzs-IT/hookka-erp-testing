// ---------------------------------------------------------------------------
// po-put-line-unit.test.mjs — HK-0037 review fixes, behavioural.
//
// Drives the real PO route (PUT /:id) through Hono against a fake DB that
// records every bound statement, so the assertions are on what is written to
// purchase_order_items, not on source text.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const { Hono } = await import("hono");
const { default: poApp } = await load("src/api/routes/purchase-orders.ts");
const mv = await load("src/lib/material-variants.ts");

const EXISTING = {
  id: "po-1",
  poNo: "PO-2610-001",
  supplierId: "s-1",
  supplierName: "Sup",
  status: "DRAFT",
  subtotalSen: 0,
  totalSen: 0,
  orderDate: "",
  expectedDate: "",
  receivedDate: null,
  notes: "",
  purchase_org_code: "HOOKKA",
};

// Stored lines, in line order. FAB-01 line 1 is part-received in PCS (legacy).
const STORED = [
  { id: "poi-a", material_code: "FAB-01", unit: "PCS", receivedQty: 5 },
  { id: "poi-b", material_code: "FAB-01", unit: "pcs", receivedQty: 0 },
];
const RMS = [{ itemCode: "FAB-01", baseUOM: "MTR" }];

function harness({ rmRows = RMS, stored = STORED } = {}) {
  const log = [];
  const inserts = [];
  const rmQueries = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/FROM purchase_orders WHERE id = \?/.test(sql)) return EXISTING;
      return null;
    },
    async all() {
      if (/FROM raw_materials/.test(sql)) {
        rmQueries.push(args);
        return { results: rmRows };
      }
      if (/FROM purchase_order_items WHERE purchaseOrderId = \? ORDER BY/.test(sql) || /SELECT id, material_code, unit/.test(sql)) {
        return { results: stored };
      }
      return { results: [] };
    },
    async run() {
      log.push(sql);
      return { success: true, meta: { changes: 1 } };
    },
  });
  const DB = {
    prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()),
    async exec() {
      return { count: 0 };
    },
    async batch(stmts) {
      for (const s of stmts) {
        log.push(s.sql);
        if (/^INSERT INTO purchase_order_items/.test(s.sql)) inserts.push(s.args);
      }
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", DB);
    c.set("orgId", "org-1");
    c.set("userId", "u-1");
    c.set("userRole", "SUPER_ADMIN");
    await next();
  });
  app.route("/", poApp);
  return { app, inserts, rmQueries, log };
}

const put = (app, items) =>
  app.request(
    "/po-1",
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) },
    { SESSION_CACHE: undefined },
  );
// INSERT bind order: id, purchaseOrderId, category, code, name, sku, qty, price, total, received, unit, line_no
const unitOf = (args) => args[10];

test("PUT: a line whose id was dropped keeps the stored unit of the received line (matched by code + order)", async () => {
  const { app, inserts } = harness();
  const res = await put(app, [
    { materialCode: "FAB-01", quantity: 5, unitPriceSen: 100, unit: "pcs" },
    { materialCode: "FAB-01", quantity: 3, unitPriceSen: 100, unit: "pcs" },
  ]);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(inserts.length, 2);
  assert.equal(unitOf(inserts[0]), "PCS", "first FAB-01 line is the received one: stored unit kept, not re-unitised to MTR");
  assert.equal(unitOf(inserts[1]), "MTR", "unreceived line defaults to the RM base unit");
});

test("PUT: a line matched by id keeps working the same way", async () => {
  const { app, inserts } = harness();
  const res = await put(app, [
    { id: "poi-a", materialCode: "FAB-01", quantity: 5, unitPriceSen: 100, unit: "pcs" },
    { id: "poi-b", materialCode: "FAB-01", quantity: 3, unitPriceSen: 100, unit: "pcs" },
  ]);
  assert.equal(res.status, 200);
  assert.equal(unitOf(inserts[0]), "PCS");
  assert.equal(unitOf(inserts[1]), "MTR");
});

test("PUT: a unit the client chose on purpose is kept, not overwritten by the RM base unit", async () => {
  const { app, inserts } = harness({ stored: [] });
  const res = await put(app, [{ materialCode: "FAB-01", quantity: 1, unitPriceSen: 100, unit: "ROLL" }]);
  assert.equal(res.status, 200);
  assert.equal(unitOf(inserts[0]), "ROLL");
});

test("rmBaseUoms: raw_materials lookups are chunked, orgId + at most 90 codes per statement", async () => {
  const { app, rmQueries } = harness({ stored: [] });
  const items = Array.from({ length: 250 }, (_, i) => ({
    materialCode: `RM-${i}`,
    quantity: 1,
    unitPriceSen: 1,
  }));
  const res = await put(app, items);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(rmQueries.length, 3, "250 codes -> 90 + 90 + 70");
  for (const q of rmQueries) assert.ok(q.length <= 100, `bound params ${q.length} must stay <= 100`);
});

test("poLineUnit: client unit wins unless blank or the legacy pcs default", () => {
  const m = mv.rmUnitMap([{ itemCode: "FAB-01", baseUOM: "MTR" }]);
  assert.equal(mv.poLineUnit(m, "FAB-01", "ROLL"), "ROLL");
  assert.equal(mv.poLineUnit(m, "FAB-01", "pcs"), "MTR");
  assert.equal(mv.poLineUnit(m, "FAB-01", ""), "MTR");
  assert.equal(mv.poLineUnit(m, "NOPE", ""), "pcs");
});
