// ---------------------------------------------------------------------------
// sv-order-form.test.mjs — pure helpers behind the mobile SV service-order form
// (src/pages/m/screens/orders/sv-form-model.ts): request bodies, validation, copy / case hydration,
// money in integer sen, lock messages, entry routing. Desktop rules are the reference
// (src/pages/sales/create.tsx, edit.tsx, src/lib/repair-scope.ts).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  blankHeader, blankLine, createBody, editBody, entryFromQuery, formBlockers, headerFromCopyDraft, lineBody, lineFromServer,
  linesFromCase, linesFromCopyDraft, lockFromResponse, lockedMessage, rmTextToSen, scopeFromStored, scopeToStored, senToRmText, totals,
  confirmFailMessage, lineProblem,
} from "../src/pages/m/screens/orders/sv-form-model.ts";
import { validateRepairScopeInput } from "../src/lib/repair-scope.ts";

const header = (p = {}) => ({ ...blankHeader("2026-11-10"), customerId: "c1", customerName: "Acme", hubId: "h1", hubName: "KL", ...p });
const line = (p = {}) => ({ ...blankLine(), productId: "p1", productCode: "HB-1", productName: "Harbour", itemCategory: "BEDFRAME", sizeLabel: "Queen", fabricCode: "LN-005", ...p });

test("money: RM text -> integer sen, no float drift", () => {
  assert.equal(rmTextToSen("12.50"), 1250);
  assert.equal(rmTextToSen("1,200"), 120000);
  assert.equal(rmTextToSen("0.1"), 10);
  assert.ok(Number.isInteger(rmTextToSen("19.99")));
  assert.equal(rmTextToSen(""), 0);
  assert.equal(rmTextToSen("-5"), 0);
  assert.equal(rmTextToSen("abc"), 0);
  assert.equal(senToRmText(1250), "12.50");
  assert.equal(senToRmText(0), "");
});

test("create body: DRAFT service order, hub as deliveryHubId, caseId only when handed off", () => {
  const b = createBody(header({ customerPOId: " PO1 " }), [line()], { caseId: "case-9" });
  assert.equal(b.status, "DRAFT");
  assert.equal(b.isServiceOrder, true);
  assert.equal(b.caseId, "case-9");
  assert.equal(b.deliveryHubId, "h1");
  assert.equal(b.customerPOId, "PO1");
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].repairScope, null); // FULL = null
  assert.equal(b.items[0].basePriceSen, 0); // zero price is allowed and sent as-is
  assert.ok(!("overrideToken" in b));
  assert.ok(!("caseId" in createBody(header(), [line()])));
});

test("edit body: DRAFT carries hubId, others do not; never an overrideToken; stored prices round-trip", () => {
  const stored = lineFromServer({ id: "r1", productId: "p1", productCode: "HB-1", productName: "H", itemCategory: "BEDFRAME", fabricCode: "F1", quantity: 2, basePriceSen: 5000, divanPriceSen: 800, legPriceSen: 0, discountSen: 300, divanHeightInches: 10, repairScope: '{"preset":"FRAME","depts":["WOOD_CUT","FRAMING","UPHOLSTERY","PACKING"]}' }, 0);
  const d = editBody(header(), [stored], { draft: true });
  assert.equal(d.hubId, "h1");
  assert.ok(!("overrideToken" in d));
  const c = editBody(header(), [stored], { draft: false });
  assert.ok(!("hubId" in c));
  assert.equal(d.items[0].id, "r1");
  assert.equal(d.items[0].divanPriceSen, 800);
  assert.equal(d.items[0].discountSen, 300);
  assert.equal(d.items[0].divanHeightInches, 10);
  assert.equal(d.items[0].legHeightInches, null); // a stored null is never turned into 0
  assert.equal(JSON.parse(d.items[0].repairScope).preset, "FRAME");
});

test("repair scope: FULL=null, presets carry no picks, CUSTOM keeps depts in chain order + valid picks", () => {
  assert.equal(scopeToStored({ preset: "FULL", depts: [], components: [] }), null);
  const preset = JSON.parse(scopeToStored({ preset: "FABRIC", depts: [], components: [{ key: "k", label: "x", qty: 1 }] }));
  assert.deepEqual(preset, { preset: "FABRIC", depts: ["FAB_CUT", "FAB_SEW", "UPHOLSTERY", "PACKING"] });
  const custom = JSON.parse(scopeToStored({ preset: "CUSTOM", depts: ["PACKING", "FAB_CUT"], components: [{ key: "a", label: "Seat", qty: 2 }] }));
  assert.deepEqual(custom.depts, ["FAB_CUT", "PACKING"]);
  assert.deepEqual(custom.components, [{ key: "a", label: "Seat", qty: 2 }]);
  // the shared desktop validator accepts every shape we emit
  for (const s of [null, preset, custom]) assert.equal(validateRepairScopeInput(s === null ? null : JSON.stringify(s)).ok, true);
  assert.deepEqual(scopeFromStored(JSON.stringify(custom)).components, custom.components);
  assert.equal(scopeFromStored("garbage").preset, "FULL");
});

test("repair scope: components are canonicalized against the BOM (all at full qty = omitted)", () => {
  const opts = [{ key: "a", label: "Seat", qty: 2 }, { key: "b", label: "Back", qty: 1 }];
  const all = scopeToStored({ preset: "CUSTOM", depts: ["FAB_CUT"], components: [{ key: "a", label: "Seat", qty: 2 }, { key: "b", label: "Back", qty: 1 }] }, opts);
  assert.equal(JSON.parse(all).components, undefined);
});

test("validation: customer, items, qty, custom scope departments, fabric", () => {
  assert.deepEqual(formBlockers(header({ customerId: "" }), []), ["Choose a customer.", "Add at least one item."]);
  assert.deepEqual(formBlockers(header(), [line()]), []);
  assert.match(formBlockers(header(), [line({ fabricCode: "" })])[0], /Item 1: choose a fabric/);
  assert.match(formBlockers(header(), [line({ quantity: 0 })])[0], /Quantity must be at least 1/);
  assert.match(formBlockers(header(), [line({ scope: { preset: "CUSTOM", depts: [], components: [] } })])[0], /at least one department/);
  assert.match(lineProblem(line({ scope: { preset: "FRAME", depts: [], components: [{ key: "a", label: "x", qty: 1 }] } })), /only be picked on a custom/);
  assert.match(lineProblem(line({ scope: { preset: "CUSTOM", depts: ["FAB_CUT"], components: [{ key: "a", label: "x", qty: 1.5 }] } })), /whole number/);
  assert.ok(formBlockers(header(), [line({ itemCategory: "SOFA", quantity: 2 })]).length >= 1); // one unit per sofa line
  assert.ok(formBlockers(header(), [line({ itemCategory: "SOFA" }), line({ itemCategory: "BEDFRAME" })]).length >= 1); // sofa + bedframe never mix
});

test("totals are integer sen", () => {
  const t = totals([line({ quantity: 2, basePriceSen: 1999 }), line({ quantity: 1, basePriceSen: 0, discountSen: 0 })]);
  assert.deepEqual(t, { lines: 2, qty: 3, subtotalSen: 3998, totalSen: 3998 });
});

test("copy draft: every price is 0, lines flagged for review; header keeps existing dates", () => {
  const ls = linesFromCopyDraft([{ productId: "p", productCode: "X", quantity: 3, customSpecials: [{ description: "d", surchargeSen: 900 }] }]);
  assert.equal(ls[0].basePriceSen, 0);
  assert.equal(ls[0].customSpecials[0].surchargeSen, 0);
  assert.equal(ls[0].prefilled, true);
  const h = headerFromCopyDraft(header({ companySODate: "2026-11-10" }), { customerId: "c2", hubId: "h2", hubName: "Penang", customerSOId: "EX-SO-1", companySODate: "2026-01-01", items: [], sourceType: "SO", sourceId: "s", sourceNo: "SO-1" });
  assert.equal(h.customerId, "c2");
  assert.equal(h.customerSOId, "EX-SO-1");
  assert.equal(h.companySODate, "2026-11-10");
  assert.equal(h.hubName, "Penang");
});

test("case hand-off: only affected lines, case qty, picks -> CUSTOM over every department; covered products skipped", () => {
  const items = [{ productId: "p1", productCode: "A", quantity: 5 }, { productId: "p2", productCode: "B", quantity: 1 }, { productId: "p3", productCode: "C", quantity: 1 }];
  const sc = { id: "case1", caseNo: "SC-1", sourceType: "SO", sourceId: "s", coveredProductIds: ["p2"], affectedProducts: [{ productId: "p1", qty: 2, components: [{ key: "k", label: "Seat", qty: 1 }] }, { productId: "p2", qty: 1 }] };
  const { lines, alreadyCovered } = linesFromCase(sc, items);
  assert.equal(lines.length, 1);
  assert.equal(alreadyCovered, 1);
  assert.equal(lines[0].productCode, "A");
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].scope.preset, "CUSTOM");
  assert.equal(lines[0].scope.depts.length, 10);
  // zero overlap keeps every source line
  assert.equal(linesFromCase({ ...sc, affectedProducts: [{ productId: "zz" }] }, items).lines.length, 3);
});

test("line body: sofa sends seatHeight; heights stay null; scope is a string", () => {
  const b = lineBody(line({ itemCategory: "SOFA", sizeLabel: "28" }));
  assert.equal(b.seatHeight, "28");
  assert.equal(b.gapInches, null);
  assert.equal(typeof lineBody(line({ scope: { preset: "CUSTOM", depts: ["FAB_CUT"], components: [] } })).repairScope, "string");
});

test("edit lock: server wording, never an override", () => {
  assert.equal(lockedMessage({ editable: true }), "");
  assert.equal(lockedMessage({ editable: false, reason: "production_started", startedDept: "Fabric Cutting", jcStatus: "IN_PROGRESS" }),
    "Cannot edit — Fabric Cutting has started production (job card status: IN_PROGRESS). Editing items would orphan in-flight work.");
  assert.match(lockedMessage({ editable: false, reason: "status", status: "SHIPPED" }), /^Cannot edit/);
  assert.equal(lockFromResponse(403, { error: "Cannot edit — X", locked: true }), "Cannot edit — X");
  assert.equal(lockFromResponse(403, { error: "Forbidden" }), "");
  assert.equal(lockFromResponse(500, { locked: true }), "");
});

test("confirm failure message and entry routing", () => {
  assert.equal(confirmFailMessage(""), "Draft saved; confirmation failed.");
  assert.equal(confirmFailMessage("BOM incomplete"), "Draft saved; confirmation failed. BOM incomplete");
  const q = (s) => entryFromQuery(new URLSearchParams(s));
  assert.deepEqual(q(""), { kind: "blank" });
  assert.deepEqual(q("from=so"), { kind: "pick", pick: "so" });
  assert.deepEqual(q("from=co"), { kind: "pick", pick: "co" });
  assert.deepEqual(q("from=case"), { kind: "pick", pick: "case" });
  assert.deepEqual(q("from=so&sourceId=X"), { kind: "copy", type: "SO", sourceId: "X" });
  assert.deepEqual(q("from=co&sourceId=Y"), { kind: "copy", type: "CO", sourceId: "Y" });
  assert.deepEqual(q("fromCase=C1"), { kind: "case", caseId: "C1" });
  assert.deepEqual(q("clone=S1"), { kind: "clone", svId: "S1" });
});
