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

// ── H2-9: Back returns to the page the document was opened from ─────────
import {
  openerFor,
  openerIsPreviousEntry,
  openerLabel,
  recordReturnVisit,
  noteScroll,
  resetReturnToForTests,
} from "../src/lib/return-to.ts";
import { sourceFromParams, sourceHref, sourceBackLabel, savedDocHref } from "../src/lib/return-to-source.ts";

test("H2-9: a document opened from another page names it and keeps its scroll spot", () => {
  resetReturnToForTests();
  const t0 = 1_000_000;
  recordReturnVisit("/procurement/grn/g-1", "PUSH", 4, t0); // first page: no opener
  noteScroll(820);
  recordReturnVisit("/procurement/po-1", "PUSH", 5, t0 + 10); // opened from the GRN
  const o = openerFor("/procurement/po-1", "/procurement", t0 + 20);
  assert.ok(o);
  assert.equal(o.href, "/procurement/grn/g-1");
  assert.equal(o.scrollY, 820);
  assert.equal(openerLabel(o), "Back to Goods Receipt");
  assert.equal(openerIsPreviousEntry(o, 5), true);
  assert.equal(openerIsPreviousEntry(o, 7), false);
  // Expired after two hours.
  assert.equal(openerFor("/procurement/po-1", "/procurement", t0 + 3 * 3600 * 1000), null);
});

test("H2-9: opened from its own list = the usual Back; POP never records an opener", () => {
  resetReturnToForTests();
  recordReturnVisit("/procurement", "PUSH", 1);
  recordReturnVisit("/procurement/po-1", "PUSH", 2);
  assert.equal(openerFor("/procurement/po-1", "/procurement"), null, "from its own list");
  recordReturnVisit("/procurement/po-2", "PUSH", 3); // doc → doc
  assert.equal(openerFor("/procurement/po-2", "/procurement")?.href, "/procurement/po-1");
  recordReturnVisit("/procurement/po-1", "POP", 2); // Back
  assert.equal(openerFor("/procurement/po-1", "/procurement"), null, "Back must not make po-2 the opener of po-1");
  recordReturnVisit("/procurement/create", "PUSH", 3);
  recordReturnVisit("/procurement/po-9", "REPLACE", 3);
  assert.equal(openerFor("/procurement/po-9", "/procurement"), null);
});

test("H2-9: ObjectPageHeader shows 'Back to <page>'; the shell records every navigation", () => {
  const header = read("src/components/ui/object-page-header.tsx");
  assert.match(header, /openerFor\(`\$\{location\.pathname\}\$\{location\.search\}`, backTo\)/);
  assert.match(header, /navigate\(-1\); \/\/ POP/);
  assert.match(header, /openerLabel\(opener\)/);
  const shell = read("src/components/layout/workspace-tabs.tsx");
  assert.match(shell, /recordReturnVisit\(`\$\{location\.pathname\}\$\{location\.search\}`, navigationType/);
  assert.match(shell, /noteScroll\(window\.scrollY\)/);
});

// ── C2-6: after save, "Back to PO" / "Back to GRN" ───────────────────────
test("C2-6: the source document comes from the create page's query", () => {
  const q = (o) => ({ get: (k) => o[k] ?? null });
  assert.deepEqual(sourceFromParams(q({ poId: "po-1" }), ["PO"]), { kind: "PO", id: "po-1" });
  assert.deepEqual(sourceFromParams(q({ grnId: "g-1", poId: "po-1" }), ["GRN", "PO"]), { kind: "GRN", id: "g-1" });
  assert.equal(sourceFromParams(q({ grnId: "g-1" }), ["PO"]), null);
  assert.equal(sourceFromParams(q({}), ["GRN", "PO"]), null);
  assert.equal(sourceHref({ kind: "PO", id: "po-1" }), "/procurement/po-1");
  assert.equal(sourceHref({ kind: "GRN", id: "g 1" }), "/procurement/grn/g%201");
  assert.equal(sourceBackLabel({ kind: "GRN", id: "x" }), "Back to GRN");
  assert.equal(savedDocHref("PI", "pi-1"), "/procurement/pi/pi-1");
  assert.equal(savedDocHref("GRN", null), "/procurement/grn");
});

test("C2-6: GRN and PI create offer Back to the source after save; from scratch = the list as before", () => {
  const grn = read("src/pages/procurement/grn/create.tsx");
  assert.match(grn, /sourceFromParams\(searchParams, \["PO"\]\)/);
  assert.match(grn, /await leaveAfterSave\(resBody\.data\?\.id \?\? null\)/);
  assert.match(grn, /if \(!saveSource\) \{\s*navigate\("\/procurement\/grn"\);/);
  const pi = read("src/pages/procurement/pi/create.tsx");
  assert.match(pi, /sourceFromParams\(searchParams, \["GRN", "PO"\]\)/);
  assert.match(pi, /await leaveAfterSave\(j\.data\?\.id \?\? null\)/);
  assert.match(pi, /if \(!saveSource\) \{\s*navigate\("\/procurement\/pi"\);/);
});

// ── H2-8: supplier delivery Date 1 + revised 2/3/4, never overwritten ────
import { pickSupplierDateSlot, readSupplierDates, supplierDateLabel, latestSupplierDate } from "../src/lib/po-supplier-dates.ts";
import poRoutesApp from "../src/api/routes/purchase-orders.ts";

test("H2-8: next empty slot; a recorded slot is refused; same date is a no-op", () => {
  const none = [null, null, null, null];
  assert.deepEqual(pickSupplierDateSlot(none, "2026-11-20"), { ok: true, slot: 1 });
  const two = ["2026-11-20", "2026-11-25", null, null];
  assert.deepEqual(pickSupplierDateSlot(two, "2026-12-01", "next"), { ok: true, slot: 3 });
  assert.deepEqual(pickSupplierDateSlot(two, "2026-11-25", "next"), { ok: true, unchanged: true });
  const over = pickSupplierDateSlot(two, "2026-12-01", 2);
  assert.equal(over.ok, false);
  assert.equal(over.status, 409);
  assert.match(over.error, /Revised date 2 is already recorded \(2026-11-25\) and can't be overwritten/);
  const full = pickSupplierDateSlot(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"], "2026-02-01");
  assert.equal(full.status, 409);
  assert.equal(pickSupplierDateSlot(none, "20/11/2026").status, 400);
  assert.equal(pickSupplierDateSlot(none, "2026-11-20", 5).status, 400);
  assert.deepEqual(readSupplierDates({ supplier_date_1: "2026-11-20", supplierDate2: "2026-11-25T00:00:00Z" }), ["2026-11-20", "2026-11-25", null, null]);
  assert.equal(supplierDateLabel(1), "Date 1");
  assert.equal(latestSupplierDate(two), "2026-11-25");
});

function supplierDateHarness(row, { changes = 1 } = {}) {
  const runs = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/FROM purchase_orders WHERE id = \?/.test(sql)) return row ? { ...row } : null;
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      runs.push({ sql, args });
      if (/^UPDATE purchase_orders SET supplier_date_/.test(sql)) return { success: true, meta: { changes } };
      return { success: true, meta: { changes: 0 } };
    },
  });
  const DB = { prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()), async batch(l) { return l.map(() => ({ success: true })); } };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", DB);
    c.set("orgId", "org-1");
    c.set("userId", "u-1");
    c.set("userRole", "SUPER_ADMIN");
    await next();
  });
  app.route("/", poRoutesApp);
  return { app, runs };
}

test("H2-8: the route self-applies the columns, fills the next slot compare-and-set, refuses overwrite", async () => {
  const row = { id: "po-1", status: "CONFIRMED", supplier_date_1: "2026-11-20", supplier_date_2: null };
  const h = supplierDateHarness(row);
  const res = await send(h.app, "POST", "/po-1/supplier-date", { date: "2026-11-28" });
  assert.equal(res.status, 200, await res.clone().text());
  const alters = h.runs.filter((r) => /ADD COLUMN IF NOT EXISTS supplier_date_/.test(r.sql));
  const upd = h.runs.find((r) => /^UPDATE purchase_orders SET supplier_date_2 = \?/.test(r.sql));
  assert.ok(upd, "slot 2 written");
  assert.match(upd.sql, /WHERE id = \? AND supplier_date_2 IS NULL/);
  // First call in this process: the four ALTERs ran, before the write.
  assert.equal(alters.length, 4);
  assert.ok(h.runs.indexOf(upd) > h.runs.indexOf(alters[3]));

  const over = supplierDateHarness(row);
  const res2 = await send(over.app, "POST", "/po-1/supplier-date", { date: "2026-12-01", slot: 1 });
  assert.equal(res2.status, 409);
  assert.equal((await res2.json()).code, "supplier_date_recorded");
  assert.ok(!over.runs.some((r) => /^UPDATE purchase_orders SET supplier_date_/.test(r.sql)), "no write");

  // Lost race: the compare-and-set matched nothing → 409, not a silent success.
  const race = supplierDateHarness(row, { changes: 0 });
  const res3 = await send(race.app, "POST", "/po-1/supplier-date", { date: "2026-11-29" });
  assert.equal(res3.status, 409);

  const cancelled = supplierDateHarness({ ...row, status: "CANCELLED" });
  assert.equal((await send(cancelled.app, "POST", "/po-1/supplier-date", { date: "2026-11-29" })).status, 409);
});

test("H2-8: the PO edit PUT never writes the supplier dates; detail page shows the card", () => {
  const route = read("src/api/routes/purchase-orders.ts");
  const put = route.slice(route.indexOf('app.put("/:id"'), route.indexOf("let pendingMigrations"));
  assert.doesNotMatch(put, /supplier_date_/);
  assert.match(route, /ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_date_4 TEXT/);
  const schema = JSON.parse(read("tests/db-schema.json"));
  for (const n of [1, 2, 3, 4]) assert.ok(schema.purchase_orders.includes(`supplier_date_${n}`));
  const detail = read("src/pages/procurement/detail.tsx");
  assert.match(detail, /<PoSupplierDatesCard/);
});

// ── C2-4: receipt photos on a GRN that print on the GRN PDF ──────────────
import { grnPrintablePhotos, fitPhoto, grnPhotoCaption, GRN_PHOTO_RESOURCE } from "../src/lib/grn-photos.ts";

test("C2-4: printable photos are images only, oldest first, capped; layout keeps the shape", () => {
  const rows = [
    { id: "f3", filename: "PHOTO__c.jpg", contentType: "image/jpeg", uploadedAt: "2026-11-10T03:00:00Z" },
    { id: "f1", filename: "PHOTO__a.png", contentType: "image/png", uploadedAt: "2026-11-10T01:00:00Z" },
    { id: "f2", filename: "note.pdf", contentType: "application/pdf", uploadedAt: "2026-11-10T02:00:00Z" },
    { id: "f4", filename: "IMG.HEIC", contentType: "image/heic", uploadedAt: "2026-11-10T00:00:00Z" },
  ];
  assert.deepEqual(grnPrintablePhotos(rows).map((r) => r.id), ["f1", "f3"]);
  assert.equal(grnPrintablePhotos(Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, contentType: "image/jpeg" }))).length, 12);
  assert.deepEqual(fitPhoto(2000, 1000, 100, 100), { width: 100, height: 50 });
  assert.deepEqual(fitPhoto(500, 1000, 100, 100), { width: 50, height: 100 });
  assert.equal(grnPhotoCaption(1, 5), "Photo 2 of 5");
  assert.equal(GRN_PHOTO_RESOURCE, "grn");
});

test("C2-4: GRN detail attaches photos via the shared file store and prints them", () => {
  const detail = read("src/pages/procurement/grn-detail.tsx");
  assert.match(detail, /<ResourceDocuments\s+resourceType=\{GRN_PHOTO_RESOURCE\}\s+resourceId=\{grn\.id\}/);
  assert.match(detail, /const photos = await loadGrnPhotoDataUrls\(grn\.id\);\s*generateGRNPdf\(\{\s*photos,/);
  const pdf = read("src/lib/generate-grn-pdf.ts");
  assert.match(pdf, /Array\.isArray\(data\.photos\)/);
  assert.match(pdf, /doc\.addImage\(photos\[i\], "JPEG"/);
  // The photo pages are added before the footer loop, so they get page numbers and the CANCELLED stamp.
  assert.ok(pdf.indexOf("Receipt photos") < pdf.indexOf("Footer (all pages"));
});
