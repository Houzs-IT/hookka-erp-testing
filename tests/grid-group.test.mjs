// ---------------------------------------------------------------------------
// grid-group.test.mjs — "Group By This Column" on the shared DataGrid (the
// finance v2 design's header menu; owner 2026-10-20 「可以」): what a row is
// grouped under, the group order, how a group reads, and the grouped export
// with each group's subtotal row. Made-up figures only (the repo is public).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_GROUP, columnGroupValue, compareGroupValues, groupValueLabel, groupRows, buildGroupedListingAoa,
} from "../src/lib/grid-group.ts";

test("a row is grouped under what its column shows", () => {
  const date = { key: "date", label: "Date", type: "date" };
  assert.equal(columnGroupValue(date, { date: "2026-10-03T08:15:00.000Z" }), "2026-10-03", "a date by its day");
  assert.equal(columnGroupValue(date, { date: "2026-10-03" }), "2026-10-03");
  const money = { key: "totalSen", label: "Total", type: "currency" };
  assert.equal(columnGroupValue(money, { totalSen: 12345 }), 123.45, "money as its RM number");
  const text = { key: "payee", label: "Payee" };
  assert.equal(columnGroupValue(text, { payee: "  Acme Freight " }), "Acme Freight");
  assert.equal(columnGroupValue(text, { payee: "" }), BLANK_GROUP);
  assert.equal(columnGroupValue(text, {}), BLANK_GROUP);
  assert.equal(BLANK_GROUP, "(blank)");
  // The column's own export / filter value wins over the raw field (a computed column).
  assert.equal(columnGroupValue({ key: "kind", label: "Kind", exportValue: (r) => r.k.toUpperCase() }, { k: "ap" }), "AP");
  assert.equal(columnGroupValue({ key: "st", label: "Status", filterAccessor: (r) => (r.st ? "Posted" : "Draft") }, { st: 0 }), "Draft");
  // A column too fine to group by names its own group (a status with an amount in it).
  const status = { key: "statusLabel", label: "Status", groupAccessor: (r) => r.group ?? r.statusLabel };
  assert.equal(columnGroupValue(status, { statusLabel: "Approved · advance open RM 12.00", group: "Approved · advance open" }), "Approved · advance open");
  assert.equal(columnGroupValue(status, { statusLabel: "Approved · paid" }), "Approved · paid");
  assert.equal(columnGroupValue({ key: "x", label: "X", groupAccessor: () => null }, {}), BLANK_GROUP);
  assert.equal(columnGroupValue({ key: "x", label: "X", groupAccessor: () => 7 }, {}), 7);
});

test("groups read in order: numbers by value, text A → Z with its numbers in order, blank last", () => {
  const text = ["INV-10", BLANK_GROUP, "INV-9", "Apple", "apple pie"].sort(compareGroupValues);
  assert.deepEqual(text, ["Apple", "apple pie", "INV-9", "INV-10", BLANK_GROUP]);
  assert.deepEqual([30, BLANK_GROUP, 4.5, 100].sort(compareGroupValues), [4.5, 30, 100, BLANK_GROUP]);
  assert.deepEqual(["2026-10-12", "2026-09-30", "2026-10-02"].sort(compareGroupValues), ["2026-09-30", "2026-10-02", "2026-10-12"], "days in date order");
  assert.equal(compareGroupValues("Same", "Same"), 0);
});

test("a group's name reads like the column: DD/MM/YYYY, money with two decimals", () => {
  assert.equal(groupValueLabel("date", "2026-10-03"), "03/10/2026");
  assert.equal(groupValueLabel("currency", 1234.5), "1,234.50");
  assert.equal(groupValueLabel("number", 1234), "1,234");
  assert.equal(groupValueLabel(undefined, "Acme Freight"), "Acme Freight");
  assert.equal(groupValueLabel("date", BLANK_GROUP), BLANK_GROUP);
});

test("rows split into their groups in group order; each group keeps the rows' own order", () => {
  const rows = [
    { id: 1, p: "City" }, { id: 2, p: "Acme" }, { id: 3, p: "" }, { id: 4, p: "City" }, { id: 5, p: "Acme" },
  ];
  const col = { key: "p", label: "Payee" };
  const groups = groupRows(rows, (r) => columnGroupValue(col, r));
  assert.deepEqual(groups.map((g) => g.key), ["Acme", "City", BLANK_GROUP]);
  assert.deepEqual(groups.map((g) => g.rows.map((r) => r.id)), [[2, 5], [1, 4], [3]]);
  assert.deepEqual(groupRows([], () => "x"), []);
});

test("the grouped export: each group's rows, then its subtotal row (money in RM)", () => {
  const cols = [
    { key: "no", label: "No" },
    { key: "payee", label: "Payee" },
    { key: "totalSen", label: "Total", type: "currency" },
  ];
  const rows = [
    { no: "A-1", payee: "Acme", totalSen: 10050 },
    { no: "A-2", payee: "Acme", totalSen: 250 },
    { no: "C-1", payee: "City", totalSen: 70000 },
  ];
  const totalsOf = (rs) => ({ totalSen: rs.reduce((s, r) => s + r.totalSen, 0) });
  const { aoa, subtotalRows } = buildGroupedListingAoa(cols, [
    { label: "Acme", rows: rows.slice(0, 2) },
    { label: "City", rows: rows.slice(2) },
  ], totalsOf);
  assert.deepEqual(aoa, [
    ["No", "Payee", "Total"],
    ["A-1", "Acme", 100.5],
    ["A-2", "Acme", 2.5],
    ["Acme subtotal (2)", "", 103],
    ["C-1", "City", 700],
    ["City subtotal (1)", "", 700],
  ]);
  // Body indexes (the header is not a body row): the PDF bands these.
  assert.deepEqual(subtotalRows, [2, 4]);
  // The label sits in the first column without a total.
  const { aoa: a2 } = buildGroupedListingAoa(
    [{ key: "totalSen", label: "Total", type: "currency" }, { key: "payee", label: "Payee" }],
    [{ label: "Acme", rows: rows.slice(0, 1) }],
    totalsOf,
  );
  assert.deepEqual(a2[2], [100.5, "Acme subtotal (1)"]);
  // The grid's own select / actions columns never reach the sheet.
  const { aoa: a3 } = buildGroupedListingAoa(
    [{ key: "__select__", label: "" }, ...cols, { key: "__actions__", label: "" }],
    [{ label: "City", rows: rows.slice(2) }],
    totalsOf,
  );
  assert.deepEqual(a3[0], ["No", "Payee", "Total"]);
});
