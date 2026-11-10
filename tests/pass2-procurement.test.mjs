// ---------------------------------------------------------------------------
// pass2-procurement.test.mjs — cross-system review pass 2, batch A2
// (docs/plans/2026-11-10-cross-system-review-pass2.md). Display / navigation
// items plus refusals only: nothing here changes a money, stock or payroll
// figure. Pure helpers are exercised directly; the server helpers run against
// a small fake D1; UI wiring is pinned by source pattern (house style).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { grnPoRefs, isMultiPoGrn, grnLinePoLabel } from "../src/lib/grn-line-po.ts";
import { fillGrnLinePoNumbers } from "../src/api/routes/grn.ts";

const read = (p) => readFileSync(p, "utf8");

/** Fake D1 answering `SELECT … FROM purchase_orders WHERE id IN (…)`. */
function fakePoDb(pos) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async all() {
              return { results: pos.filter((p) => args.includes(p.id)) };
            },
          };
        },
      };
    },
  };
}

// ── H1-5: each GRN line names its PO ──────────────────────────────────────
test("H1-5: grnPoRefs lists every PO once, header first", () => {
  const grn = {
    poId: "po-1",
    poNumber: "PO-2611-001",
    items: [
      { poId: "po-1", poNumber: "PO-2611-001" },
      { poId: "po-2", poNumber: "PO-2611-002" },
      { poId: "po-2", poNumber: "PO-2611-002" },
      { poId: "", poNumber: "" },
    ],
  };
  assert.deepEqual(grnPoRefs(grn).map((r) => r.poNumber), ["PO-2611-001", "PO-2611-002"]);
  assert.equal(isMultiPoGrn(grn), true);
  assert.equal(isMultiPoGrn({ poId: "po-1", poNumber: "X", items: [{ poId: "po-1" }] }), false);
  assert.equal(isMultiPoGrn({ poId: "", poNumber: "", items: [] }), false);
  assert.equal(grnLinePoLabel({ poId: "po-2", poNumber: "PO-2611-002" }, grn), "PO-2611-002");
  assert.equal(grnLinePoLabel({}, grn), "PO-2611-001");
});

test("H1-5: the server fills each line's PO number (header PO for legacy lines)", async () => {
  const db = fakePoDb([{ id: "po-2", poNo: "PO-2611-002" }]);
  const grns = [
    {
      poId: "po-1",
      poNumber: "PO-2611-001",
      items: [
        { poId: "", poNumber: "" },
        { poId: "po-1", poNumber: "" },
        { poId: "po-2", poNumber: "" },
      ],
    },
  ];
  await fillGrnLinePoNumbers(db, grns);
  assert.deepEqual(
    grns[0].items.map((i) => [i.poId, i.poNumber]),
    [["po-1", "PO-2611-001"], ["po-1", "PO-2611-001"], ["po-2", "PO-2611-002"]],
  );
  // Only the PO not already known from the header is looked up.
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].args, ["po-2"]);
});

test("H1-5: no lookup when every line belongs to the header PO", async () => {
  const db = fakePoDb([]);
  const grns = [{ poId: "po-1", poNumber: "PO-1", items: [{ poId: "", poNumber: "" }] }];
  await fillGrnLinePoNumbers(db, grns);
  assert.equal(db.calls.length, 0);
  assert.equal(grns[0].items[0].poNumber, "PO-1");
});

test("H1-5: GRN list + detail render the line PO; both GET routes fill it", () => {
  const grn = read("src/api/routes/grn.ts");
  assert.match(grn, /poId: String\(r\.poId \?\? r\.po_id \?\? ""\)/);
  assert.equal((grn.match(/await fillGrnLinePoNumbers\(c\.var\.DB/g) ?? []).length, 2);
  const detail = read("src/pages/procurement/grn-detail.tsx");
  assert.match(detail, /grnPoRefs\(grn\)/);
  assert.match(detail, /"Linked POs"/);
  assert.match(detail, /grnLinePoLabel\(it, grn\)/);
  const list = read("src/pages/procurement/grn.tsx");
  assert.match(list, /grnPoRefs\(row\)/);
});

// ── H2-3 / C2-7: GRN number(s) + GRN date on the PO list ─────────────────
import { summarizePoGrns } from "../src/lib/po-grn-refs.ts";

test("H2-3: each PO lists its GRNs (header or line link), cancelled left out", () => {
  const grns = [
    { id: "g1", grnNumber: "GRN-2611-001", poId: "po-1", receiveDate: "2026-11-02T00:00:00Z", status: "POSTED" },
    { id: "g2", grnNumber: "GRN-2611-003", poId: "po-9", receiveDate: "2026-11-05", status: "DRAFT" },
    { id: "g3", grnNumber: "GRN-2611-002", poId: "po-1", receiveDate: "2026-11-04", status: "CANCELLED" },
  ];
  // g2's header PO is po-9 but one of its lines receives po-1 (multi-PO).
  const links = [{ grnId: "g2", poId: "po-1" }, { grnId: "g3", poId: "po-2" }];
  const m = summarizePoGrns(["po-1", "po-2", "po-3"], grns, links);
  assert.equal(m.get("po-1").grnNumbers, "GRN-2611-001, GRN-2611-003");
  assert.equal(m.get("po-1").grnDate, "2026-11-05");
  assert.deepEqual(m.get("po-1").grnRefs.map((r) => r.id), ["g1", "g2"]);
  assert.equal(m.get("po-2").grnNumbers, "");
  assert.equal(m.get("po-3").grnDate, "");
});

test("H2-3: the PO list GET attaches the refs and the list shows both columns", () => {
  const route = read("src/api/routes/purchase-orders.ts");
  assert.match(route, /await attachPoGrnRefs\(c\.var\.DB, data\)/);
  assert.match(route, /OR id IN \(SELECT grnId FROM grn_items WHERE po_id IN/);
  const list = read("src/pages/procurement/index.tsx");
  assert.match(list, /key: "grnNumbers", label: "GRN No\."/);
  assert.match(list, /key: "grnDate", label: "GRN Date", type: "date"/);
});

// ── C2-8: a deactivated material can't be newly added to a PO ────────────
import {
  inactiveCodesFromRows,
  newlyAddedCodes,
  inactiveMaterialError,
  rmRowIsActive,
} from "../src/lib/po-inactive-material.ts";

test("C2-8: a code is inactive only when every unit row is inactive", () => {
  const rows = [
    { itemCode: "PC151-01", isActive: 0, status: "INACTIVE" },
    { itemCode: "pc151-01 ", isActive: 1, status: "ACTIVE" }, // live unit row
    { itemCode: "MHW 1 X 2", isActive: false },
    { itemCode: "TARONI", isActive: 1, status: "INACTIVE" },
    { itemCode: "FOAM", isActive: true },
  ];
  assert.deepEqual([...inactiveCodesFromRows(rows)].sort(), ["MHW 1 X 2", "TARONI"]);
  assert.equal(rmRowIsActive({ isActive: null }), true);
});

test("C2-8: only codes the PO does not already carry are judged", () => {
  assert.deepEqual(
    newlyAddedCodes([{ materialCode: "a" }, { materialCode: "B" }, { materialCode: "b" }, { materialCode: "" }], ["A"]),
    ["B"],
  );
  assert.deepEqual(newlyAddedCodes([{ materialCode: "X" }]), ["X"]);
  assert.match(inactiveMaterialError(["X"]), /^X is deactivated and can't be added/);
  assert.match(inactiveMaterialError(["X", "Y"]), /^X, Y are deactivated/);
});

test("C2-8: PO POST and PUT refuse a newly added inactive material with 400 before any write", () => {
  const route = read("src/api/routes/purchase-orders.ts");
  const post = route.slice(route.indexOf('app.post("/", idempotent()'), route.indexOf('app.get("/:id"'));
  assert.match(post, /inactiveNewMaterials\(rmInactive, poItems\)[\s\S]*?inactiveMaterialError\(inactiveNew\) \}, 400\)/);
  assert.ok(post.indexOf("inactiveNewMaterials") < post.indexOf("INSERT INTO purchase_orders"));
  const put = route.slice(route.indexOf('app.put("/:id"'));
  assert.match(put, /inactiveNewMaterials\(\s*rmInactive,\s*rawItems,\s*\(storedLines/);
  // One raw-material read serves both the unit map and the active check.
  assert.match(route, /SELECT itemCode, baseUOM, isActive, status FROM raw_materials/);
});

// ── H2 B1: saving a MAIN binding demotes the item's other main(s) ────────
import { Hono } from "hono";
import {
  demoteOtherMainsStatement,
  groupMultiMainRows,
  isMainFlag,
} from "../src/api/lib/supplier-main-binding.ts";
import { resetBindingUniqueIndexMemo } from "../src/api/lib/supplier-binding-unique.ts";
import supplierMaterialsApp from "../src/api/routes/supplier-materials.ts";

const BINDING = {
  id: "smb-1",
  orgId: "org-1",
  supplierId: "s-1",
  materialCode: "FOAM-1",
  materialName: "Foam",
  supplierSku: "F1",
  unitPrice: 100,
  currency: "MYR",
  leadTimeDays: 0,
  paymentTerms: "NET30",
  moq: 0,
  isMainSupplier: 0,
};

function bindingHarness() {
  const runs = [];
  const batches = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/COUNT\(\*\)/.test(sql)) return { n: 1 }; // old duplicates: index skipped
      if (/SELECT \* FROM supplier_material_bindings WHERE id = \?/.test(sql)) return { ...BINDING, id: args[0] };
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      runs.push({ sql, args });
      return { success: true, meta: { changes: 1 } };
    },
  });
  const DB = {
    prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()),
    async batch(list) {
      batches.push(list.map((s) => ({ sql: s.sql, args: s.args })));
      return list.map(() => ({ success: true, meta: { changes: 1 } }));
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
  app.route("/", supplierMaterialsApp);
  return { app, runs, batches };
}
const send = (app, method, path, body) =>
  app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { SESSION_CACHE: undefined });

test("H2 B1: the demote statement keeps the saved row and stays in its org", () => {
  const db = { prepare: (sql) => ({ sql, bind: (...args) => ({ sql, args }) }) };
  const s = demoteOtherMainsStatement(db, "FOAM-1", "smb-9", "org-1");
  assert.match(s.sql, /UPDATE supplier_material_bindings SET isMainSupplier = 0/);
  assert.match(s.sql, /materialCode = \? AND id <> \? AND isMainSupplier = 1 AND \(orgId = \? OR orgId IS NULL\)/);
  assert.deepEqual(s.args, ["FOAM-1", "smb-9", "org-1"]);
  assert.deepEqual(demoteOtherMainsStatement(db, "X", "k").args, ["X", "k"]);
  assert.equal(isMainFlag(1), true);
  assert.equal(isMainFlag("0"), false);
});

test("H2 B1: POST as main = one batch [demote others, insert]; not main = no demote", async () => {
  resetBindingUniqueIndexMemo();
  const { app, runs, batches } = bindingHarness();
  const body = { supplierId: "s-1", materialCode: "FOAM-1", materialName: "Foam", supplierSku: "F1", unitPrice: 100 };
  const res = await send(app, "POST", "/", { ...body, isMainSupplier: true });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal(batches.length, 1);
  assert.match(batches[0][0].sql, /^UPDATE supplier_material_bindings SET isMainSupplier = 0/);
  assert.equal(batches[0][0].args[0], "FOAM-1");
  assert.match(batches[0][1].sql, /^INSERT INTO supplier_material_bindings/);
  assert.equal(batches[0][0].args[1], batches[0][1].args[0], "the new row itself is kept");

  const plain = bindingHarness();
  const res2 = await send(plain.app, "POST", "/", { ...body, isMainSupplier: false });
  assert.equal(res2.status, 201);
  assert.equal(plain.batches.length, 0);
  assert.ok(!plain.runs.some((r) => /SET isMainSupplier = 0/.test(r.sql)));
});

test("H2 B1: PUT that makes a binding main demotes the others in the same batch", async () => {
  resetBindingUniqueIndexMemo();
  const { app, batches, runs } = bindingHarness();
  const res = await send(app, "PUT", "/smb-1", { isMainSupplier: true });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0][0].args, ["FOAM-1", "smb-1", "org-1"]);
  assert.match(batches[0][1].sql, /^UPDATE supplier_material_bindings SET supplierId = \?/);

  const plain = bindingHarness();
  const res2 = await send(plain.app, "PUT", "/smb-1", { moq: 5 }); // stays non-main
  assert.equal(res2.status, 200);
  assert.equal(plain.batches.length, 0);
  assert.ok(!runs.some((r) => /SET isMainSupplier = 0/.test(r.sql)));
});

test("H2 B1: read-only list of items with more than one main; import path demotes too", () => {
  const groups = groupMultiMainRows([
    { id: "a", orgId: "o", materialCode: "M1", supplierId: "s1", supplierName: "A", unitPrice: 100 },
    { id: "b", orgId: "o", materialCode: "M1", supplierId: "s2", supplierName: "B", unitPrice: 90 },
    { id: "c", orgId: "o", materialCode: "M2", supplierId: "s1", supplierName: "A", unitPrice: 5 },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].materialCode, "M1");
  assert.deepEqual(groups[0].bindings.map((b) => b.id), ["a", "b"]);
  const route = read("src/api/routes/supplier-materials.ts");
  const list = route.slice(route.indexOf('app.get("/multiple-main"'), route.indexOf('app.get("/:id"'));
  assert.ok(list.length > 0 && route.indexOf('app.get("/multiple-main"') < route.indexOf('app.get("/:id"'));
  assert.match(list, /requirePermission\(c, "supplier-materials", "read"\)/);
  assert.doesNotMatch(list, /\b(UPDATE|DELETE|INSERT)\b/);
  const imp = read("src/api/routes/import-completion/procurement-backfills.ts");
  assert.equal((imp.match(/demoteOtherMainsStatement\(db, materialCode,/g) ?? []).length, 2);
});

// ── H2-2 / C2-5: "Copy as new" on a PO ───────────────────────────────────
import { buildPoCopySeed, poCopyNotice, copyLineCode, isOneOffLine } from "../src/lib/po-copy.ts";

const RMS_COPY = [
  { id: "rm-1", itemCode: "FAB-01", description: "Fabric", baseUOM: "MTR", itemGroup: "FABRIC", isActive: true },
  { id: "rm-1r", itemCode: "FAB-01", description: "Fabric", baseUOM: "ROLL", itemGroup: "FABRIC", isActive: true },
  { id: "rm-2", itemCode: "OLD-9", description: "Old", baseUOM: "PCS", itemGroup: "MISC", isActive: false },
  { id: "rm-3", itemCode: "FOAM", description: "Foam", baseUOM: "PCS", itemGroup: "FOAM", isActive: true },
];

test("H2-2: the copy keeps supplier, lines and prices; leaves number, dates, status, received qty out", () => {
  const po = {
    id: "po-1",
    poNo: "PO-2611-007",
    status: "RECEIVED",
    orderDate: "2026-11-01",
    expectedDate: "2026-11-09",
    supplierId: "s-1",
    purchaseOrgCode: "OHANA",
    notes: "Deliver to bay 2",
    items: [
      { materialCode: "FAB-01", materialName: "Fabric", supplierSKU: "F-1", quantity: 12.5, unitPriceSen: 1050, unit: "ROLL", receivedQty: 12.5, materialCategory: "FABRIC" },
      { materialCode: "", materialName: "FOAM - Foam", supplierSKU: "", quantity: 3, unitPriceSen: 0, unit: "PCS", receivedQty: 3, materialCategory: "FOAM" },
      { materialCode: "OLD-9", materialName: "Old", quantity: 1, unitPriceSen: 5, unit: "PCS" },
      { materialCode: "GONE", materialName: "Gone", quantity: 1, unitPriceSen: 5 },
      { materialCode: "FAB-01", materialName: "Fabric", quantity: 1, unitPriceSen: 0, materialCategory: "PROMO" },
    ],
  };
  const seed = buildPoCopySeed(po, RMS_COPY);
  assert.equal(seed.supplierId, "s-1");
  assert.equal(seed.purchaseOrgCode, "OHANA");
  assert.equal(seed.notes, "Deliver to bay 2");
  assert.deepEqual(
    seed.lines.map((l) => [l.rmId, l.quantity, l.unitPriceSen, l.unit, l.supplierSku]),
    [["rm-1r", 12.5, 1050, "ROLL", "F-1"], ["rm-3", 3, 0, "PCS", ""]],
  );
  for (const l of seed.lines) {
    assert.equal("receivedQty" in l, false);
    assert.equal("expectedDate" in l, false);
  }
  assert.equal("poNo" in seed || "status" in seed || "expectedDate" in seed || "orderDate" in seed, false);
  assert.deepEqual(seed.droppedInactive, ["OLD-9"]);
  assert.deepEqual(seed.droppedUnknown, ["GONE"]);
  assert.deepEqual(seed.droppedOneOff, ["FAB-01"]);
  assert.match(poCopyNotice(seed), /^3 lines left out of the copy \(deactivated: OLD-9; no longer in Raw Materials: GONE; one-off promo lines: FAB-01\)\.$/);
  assert.equal(poCopyNotice({ droppedInactive: [], droppedUnknown: [], droppedOneOff: [] }), "");
  assert.equal(copyLineCode({ materialName: "AB-1 - thing" }), "AB-1");
  assert.equal(isOneOffLine({ materialCategory: "Free gift" }), true);
  assert.equal(isOneOffLine({ materialCategory: "FABRIC" }), false);
});

test("H2-2: detail header + list row menu open New PO with ?copyFrom; the create page seeds from it", () => {
  const detail = read("src/pages/procurement/detail.tsx");
  assert.match(detail, /navigate\(`\/procurement\/create\?copyFrom=\$\{encodeURIComponent\(po\.id\)\}`\)/);
  assert.match(detail, /Copy as new/);
  const list = read("src/pages/procurement/index.tsx");
  assert.match(list, /label: "Copy as new"[\s\S]{0,200}copyFrom=\$\{encodeURIComponent\(row\.id\)\}/);
  const create = read("src/pages/procurement/create.tsx");
  assert.match(create, /searchParams\.get\("copyFrom"\)/);
  assert.match(create, /buildPoCopySeed\(body\.data, rawMaterials\)/);
  assert.match(create, /setExpectedDate\(""\)/);
  assert.match(create, /toast\.warning\(notice\)/);
});
