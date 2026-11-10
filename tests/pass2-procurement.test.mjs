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
