// m-po-filters.test.mjs — HK-0125 Phase 2 (Purchase Orders), frontend only:
//   • a Supplier filter with an "All suppliers" reset, combined with the existing search
//   • a combined "Outstanding" chip (existing status + remaining-quantity rules)
//   • the Expected date (the PO's own expectedDate) and its overdue indicator, unchanged
// Logic: src/pages/m/lib/procurement-mobile.ts. UI: screens/procurement/{ProcurementScreen,parts}.tsx.
// "When to issue" / a To Issue tab / issued dates are deliberately NOT here (pending clarification).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHIPS, DATE_RANGES, chipMatches, cleanDateField, cleanDateRange, dateFilterActive, dateRangeBounds, deliveredIdsOf, fmtQty,
  matchesQuery, poDateMatches, poDaysLate, poExpectedLate, poIsOutstanding, poIsOverdue, poMatchesFilters, poOutstanding,
  poOutstandingLabel, poOverdueFlag, poSummary, poSupplierKey, poSupplierMatches, poSupplierOptions, todayIso,
} from "../src/pages/m/lib/procurement-mobile.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const line = (materialCode, quantity, receivedQty, over = {}) => ({
  materialCode, materialName: `${materialCode} name`, supplierSKU: "", quantity, receivedQty, ...over,
});
const po = (over) => ({
  id: "po1", poNo: "PO-2611-001", status: "CONFIRMED", supplierId: "sup-a", supplierName: "Alpha Foam",
  orderDate: "2026-11-01", expectedDate: "2026-11-20", totalSen: 10000, items: [line("RM-1", 10, 0)], ...over,
});

// ── Outstanding ─────────────────────────────────────────────────────────────
test("a partial receipt of 4 out of 10 leaves 6 outstanding, and the PO is Outstanding", () => {
  const p = po({ status: "PARTIAL_RECEIVED", items: [line("RM-1", 10, 4)] });
  assert.equal(poOutstanding(p), 6);
  assert.equal(poIsOutstanding(p), true);
  assert.equal(chipMatches("po", "OUTSTANDING", p), true);
});

test("outstanding sums every line (4 of 10 + 0 of 5 = 11)", () => {
  const p = po({ status: "PARTIAL_RECEIVED", items: [line("RM-1", 10, 4), line("RM-2", 5, 0)] });
  assert.equal(poOutstanding(p), 11);
  assert.equal(poIsOutstanding(p), true);
});

test("issued, nothing received yet (SUBMITTED / CONFIRMED) is Outstanding", () => {
  assert.equal(poIsOutstanding(po({ status: "SUBMITTED" })), true);
  assert.equal(poIsOutstanding(po({ status: "CONFIRMED" })), true);
});

test("DRAFT, RECEIVED, CLOSED and CANCELLED are never Outstanding, even with quantity left on a line", () => {
  for (const status of ["DRAFT", "RECEIVED", "CLOSED", "CANCELLED"]) {
    const p = po({ status, items: [line("RM-1", 10, 4)] });
    assert.equal(poIsOutstanding(p), false, status);
    assert.equal(chipMatches("po", "OUTSTANDING", p), false, status);
  }
  // A closed-off PO that production closed from the invoice without booking receivedQty:
  assert.equal(poIsOutstanding(po({ status: "CLOSED", items: [line("RM-1", 10, 0)] })), false);
});

test("a fully received (or over-received) open PO has nothing left, so it is not Outstanding", () => {
  assert.equal(poIsOutstanding(po({ status: "PARTIAL_RECEIVED", items: [line("RM-1", 10, 10)] })), false);
  assert.equal(poIsOutstanding(po({ status: "CONFIRMED", items: [line("RM-1", 10, 12)] })), false, "over-receipt floors at 0");
});

test("the Outstanding chip filters a mixed list to exactly the owed POs", () => {
  const list = [
    po({ id: "a", status: "DRAFT" }),
    po({ id: "b", status: "SUBMITTED" }),
    po({ id: "c", status: "CONFIRMED", items: [line("RM-1", 10, 4)] }),
    po({ id: "d", status: "PARTIAL_RECEIVED", items: [line("RM-1", 10, 4)] }),
    po({ id: "e", status: "RECEIVED", items: [line("RM-1", 10, 10)] }),
    po({ id: "f", status: "CLOSED" }),
    po({ id: "g", status: "CANCELLED" }),
  ];
  assert.deepEqual(list.filter((r) => chipMatches("po", "OUTSTANDING", r)).map((r) => r.id), ["b", "c", "d"]);
});

test("the PO chip list gains Outstanding after All; the other chips are unchanged; no To Issue chip yet", () => {
  assert.deepEqual(CHIPS.po.map((c) => c.key), ["", "OUTSTANDING", "DRAFT", "SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]);
  assert.ok(!CHIPS.po.some((c) => /issue/i.test(c.key) || /issue/i.test(c.label)), "To Issue stays pending clarification");
});

// ── Supplier filter ─────────────────────────────────────────────────────────
const LIST = [
  po({ id: "1", poNo: "PO-001", supplierId: "sup-a", supplierName: "Alpha Foam", items: [line("FOAM-10", 10, 0)] }),
  po({ id: "2", poNo: "PO-002", supplierId: "sup-b", supplierName: "Beta Fabric", items: [line("FAB-77", 20, 5, { supplierSKU: "BF-77" })] }),
  po({ id: "3", poNo: "PO-003", supplierId: "sup-a", supplierName: "Alpha Foam", status: "DRAFT", items: [line("FAB-77", 3, 0)] }),
  po({ id: "4", poNo: "PO-004", supplierId: "", supplierName: "Gamma Wood", items: [line("WOOD-5", 8, 0)] }),
];
const view = ({ supplier = "", q = "", chip = "" }) =>
  LIST.filter((r) => poSupplierMatches(r, supplier) && matchesQuery("po", r, q) && chipMatches("po", chip, r)).map((r) => r.id);

test("supplier options: distinct, A to Z, one per supplier; a row with no id falls back to its name", () => {
  const opts = poSupplierOptions(LIST);
  assert.deepEqual(opts.map((o) => o.label), ["Alpha Foam", "Beta Fabric", "Gamma Wood"]);
  assert.equal(opts[0].key, "sup-a");
  assert.equal(poSupplierKey(LIST[3]), "name:GAMMA WOOD");
  assert.deepEqual(poSupplierOptions([po({ supplierId: "", supplierName: "" })]), [], "no supplier, no option");
});

test("All suppliers (empty key) keeps every PO; picking a supplier keeps only that supplier's POs", () => {
  assert.deepEqual(view({}), ["1", "2", "3", "4"]);
  assert.deepEqual(view({ supplier: "sup-a" }), ["1", "3"]);
  assert.deepEqual(view({ supplier: "name:GAMMA WOOD" }), ["4"]);
  assert.deepEqual(view({ supplier: "" }), view({}), "the reset restores the full list");
});

test("supplier + search by ITEM: the same item code is found only under the picked supplier", () => {
  assert.deepEqual(view({ q: "FAB-77" }), ["2", "3"], "search alone finds both suppliers");
  assert.deepEqual(view({ supplier: "sup-a", q: "FAB-77" }), ["3"]);
  assert.deepEqual(view({ supplier: "sup-b", q: "BF-77" }), ["2"], "supplier SKU still searchable");
});

test("supplier + search by SUPPLIER name still works, and a mismatch is empty", () => {
  assert.deepEqual(view({ q: "alpha" }), ["1", "3"]);
  assert.deepEqual(view({ supplier: "sup-a", q: "alpha" }), ["1", "3"]);
  assert.deepEqual(view({ supplier: "sup-b", q: "alpha" }), []);
});

test("supplier + search + status chip all combine (Outstanding under one supplier)", () => {
  assert.deepEqual(view({ supplier: "sup-a", chip: "OUTSTANDING" }), ["1"], "the draft of the same supplier is excluded");
  assert.deepEqual(view({ supplier: "sup-b", chip: "OUTSTANDING", q: "FAB" }), ["2"]);
});

test("chip counts follow the supplier and the search", () => {
  const matched = LIST.filter((r) => poSupplierMatches(r, "sup-a") && matchesQuery("po", r, ""));
  const counts = Object.fromEntries(CHIPS.po.map((c) => [c.key, matched.filter((r) => chipMatches("po", c.key, r)).length]));
  assert.equal(counts[""], 2);
  assert.equal(counts.OUTSTANDING, 1);
  assert.equal(counts.DRAFT, 1);
});

// ── Expected date + overdue (existing date source, unchanged) ───────────────
test("Expected date is the PO's own expectedDate, not the order date", () => {
  const TODAY = "2026-11-11";
  const p = po({ orderDate: "2026-01-01", expectedDate: "2026-12-01" });
  assert.equal(poExpectedLate(p, TODAY), false, "an old orderDate must not make it late");
  assert.equal(poExpectedLate(po({ orderDate: "2026-12-30", expectedDate: "2026-11-01" }), TODAY), true, "a past expectedDate does");
});

test("overdue indicator: past expected date on an open PO only; today and the future are on time", () => {
  const TODAY = "2026-11-11";
  for (const status of ["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"]) {
    assert.equal(poExpectedLate(po({ status, expectedDate: "2026-11-10" }), TODAY), true, `${status} yesterday`);
    assert.equal(poExpectedLate(po({ status, expectedDate: "2026-11-11" }), TODAY), false, `${status} today`);
    assert.equal(poExpectedLate(po({ status, expectedDate: "2026-11-12" }), TODAY), false, `${status} tomorrow`);
  }
  for (const status of ["DRAFT", "RECEIVED", "CLOSED", "CANCELLED"]) {
    assert.equal(poExpectedLate(po({ status, expectedDate: "2026-11-01" }), TODAY), false, `${status} never overdue`);
  }
  assert.equal(poExpectedLate(po({ expectedDate: "" }), TODAY), false, "no date, no flag");
  assert.equal(poExpectedLate(po({ expectedDate: "2026-11-10T00:00:00.000Z" }), TODAY), true, "a timestamp reads as its date");
});

test("the overdue flag and date ranges read 'today' from todayIso, the same stamp desktop uses on this branch", () => {
  // Zone-neutral on purpose: noon UTC is the same calendar day in UTC and in Malaysia (UTC+8).
  assert.equal(todayIso(new Date("2026-11-10T12:00:00Z")), "2026-11-10");
  assert.match(SCREEN, /const today = todayIso\(\);/);
});

// ── Source wiring ───────────────────────────────────────────────────────────
const SCREEN = read("src/pages/m/screens/procurement/ProcurementScreen.tsx");
const PARTS = read("src/pages/m/screens/procurement/parts.tsx");

test("the card still reads EXPECTED from expectedDate with the overdue flag (date source unchanged)", () => {
  assert.match(SCREEN, /\{ k: "EXPECTED", v: fmtShort\(dateOnly\(s\(r, "expectedDate"\)\)\) \|\| "—", warn: poOverdueFlag\(r, today, delivered\) \}/);
  assert.match(SCREEN, /\{ k: "OUTSTANDING", v: poOutstandingLabel\(r\) \?\? "—" \}/);
});

test("filters share ONE predicate (list, chip counts, Show N), and a section switch resets them", () => {
  assert.match(SCREEN, /const match = \(r: RawRow, f: FilterDraft\) => poMatchesFilters\(r, f, dq, today, delivered\)/);
  assert.match(SCREEN, /countFor=\{\(d\) => all\.filter\(\(r\) => match\(r, d\)\)\.length\}/);
  assert.match(SCREEN, /all\.filter\(\(r\) => match\(r, \{ \.\.\.applied, chip: "" \}\)\)/);
  assert.match(SCREEN, /setUrl\(\{ sec: k === sections\[0\] \? null : k, status: null, \.\.\.FILTER_KEYS \}\)/);
  assert.match(SCREEN, /supplier: null, od: null, df: null, dr: null, from: null, to: null/);
});

test("the filter sheet offers 'All suppliers', Reset and Show N POs; the only extra read is /stats", () => {
  assert.match(PARTS, /label: "All suppliers", count: total/);
  assert.match(PARTS, /placeholder="Search supplier"/);
  assert.match(PARTS, /Show \$\{count\} PO\$\{count === 1 \? "" : "s"\}/);
  assert.match(PARTS, /setDraft\(FILTER_DEFAULT\)/);
  const urls = [...SCREEN.matchAll(/"(\/api\/[^"`]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(urls)].sort(), ["/api/grn", "/api/inventory?buckets=rawMaterials", "/api/purchase-invoices", "/api/purchase-orders", "/api/purchase-orders/stats", "/api/supplier-materials"]);
});

test("the PO list is the full list (no ?page), so summary and Show N counts are complete", () => {
  assert.match(SCREEN, /useCachedJson<Envelope>\(sec === "po" \? "\/api\/purchase-orders" : null\)/);
  assert.doesNotMatch(SCREEN, /purchase-orders\?(page|limit)/);
});

// ── Supplier counts + card remaining label (design handoff) ─────────────────
test("supplier option counts = every loaded PO of that supplier", () => {
  const o = Object.fromEntries(poSupplierOptions(LIST).map((x) => [x.label, x.count]));
  assert.deepEqual(o, { "Alpha Foam": 2, "Beta Fabric": 1, "Gamma Wood": 1 });
});

const lbl = (status, items) => poOutstandingLabel(po({ status, items }));
const U = (code, q, r, unit) => ({ ...line(code, q, r), unit });

test("remaining items sharing one known unit show the balance with it", () => {
  assert.equal(lbl("PARTIAL_RECEIVED", [U("A", 40, 15, "TIN")]), "25 TIN");
  assert.equal(lbl("PARTIAL_RECEIVED", [U("A", 10, 4, "PCS"), U("B", 5, 0, "pcs")]), "11 PCS", "unit compared case-insensitively");
  assert.equal(lbl("CONFIRMED", [U("A", 2.25, 0, "M"), U("B", 1, 1, "KG")]), "2.25 M", "a received line in another unit does not count");
  assert.equal(fmtQty(0.1 + 0.2), "0.3");
});

test("mixed or missing units show how many lines still have a balance", () => {
  assert.equal(lbl("PARTIAL_RECEIVED", [U("A", 120, 120, "M"), U("B", 80, 30, "M"), U("C", 200, 0, "PCS")]), "2 of 3 lines");
  assert.equal(lbl("CONFIRMED", [U("A", 5, 0, ""), U("B", 5, 0, "")]), "2 of 2 lines", "no unit on any line");
  assert.equal(lbl("CONFIRMED", [U("A", 5, 0, "PCS"), U("B", 5, 0, "")]), "2 of 2 lines", "one blank unit counts as mixed");
});

test("label keeps the existing eligibility: closed-out is null, draft still shows its balance, nothing left is 0", () => {
  for (const st of ["RECEIVED", "CLOSED", "CANCELLED"]) assert.equal(lbl(st, [U("A", 10, 0, "PCS")]), null, st);
  assert.equal(lbl("DRAFT", [U("A", 50, 0, "ROLL")]), "50 ROLL");
  assert.equal(lbl("PARTIAL_RECEIVED", [U("A", 10, 10, "PCS")]), "0");
  assert.equal(lbl("PARTIAL_RECEIVED", [U("A", 10, 4, "PCS")]), "6 PCS");
});

// ── PO summary: overdue (desktop rule), Pending Delivery, Outstanding lines ──
const TODAY = "2026-11-11";
const delivered = (...ids) => new Set(ids);
const ovPo = (id, status, expectedDate, over = {}) => po({ id, status, expectedDate, ...over });

test("overdue is the desktop rule: past expected date, not billed in full, not RECEIVED / CLOSED / CANCELLED (DRAFT counts)", () => {
  const none = delivered();
  for (const st of ["DRAFT", "SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"]) assert.equal(poIsOverdue(ovPo("a", st, "2026-11-10"), TODAY, none), true, st);
  for (const st of ["RECEIVED", "CLOSED", "CANCELLED"]) assert.equal(poIsOverdue(ovPo("a", st, "2026-11-10"), TODAY, none), false, st);
  assert.equal(poIsOverdue(ovPo("a", "CONFIRMED", "2026-11-11"), TODAY, none), false, "due today is not late");
  assert.equal(poIsOverdue(ovPo("a", "CONFIRMED", ""), TODAY, none), false, "no date, no flag");
  assert.equal(poIsOverdue(ovPo("a", "CONFIRMED", "2026-11-10T00:00:00.000Z"), TODAY, none), true);
  assert.equal(poIsOverdue(ovPo("a", "CONFIRMED", "2026-11-01"), TODAY, delivered("a")), false, "billed in full without a GRN (HK-0114)");
});

test("the red Expected date follows the desktop rule when stats are in, and the earlier rule when they failed", () => {
  const draftLate = ovPo("d", "DRAFT", "2026-11-01");
  assert.equal(poOverdueFlag(draftLate, TODAY, delivered()), true);
  assert.equal(poOverdueFlag(draftLate, TODAY, null), false, "stats failed: the earlier open-status rule");
  const billed = ovPo("b", "CONFIRMED", "2026-11-01");
  assert.equal(poOverdueFlag(billed, TODAY, delivered("b")), false);
  assert.equal(poOverdueFlag(billed, TODAY, null), true);
});

test("deliveredIdsOf reads /stats rows; null when stats are unavailable", () => {
  assert.equal(deliveredIdsOf(null), null);
  const ids = deliveredIdsOf([{ id: "x", deliveredInFull: true }, { id: "y", deliveredInFull: false }, { id: "z" }]);
  assert.deepEqual([...ids], ["x"]);
});

test("days late and the aging bands match desktop (1-7 yellow, 8-30 orange, 31+ red)", () => {
  assert.equal(poDaysLate(ovPo("a", "CONFIRMED", "2026-11-10"), TODAY), 1);
  assert.equal(poDaysLate(ovPo("a", "CONFIRMED", "2026-11-20"), TODAY), 0);
  const list = [
    ovPo("1", "CONFIRMED", "2026-11-04"), // 7 days
    ovPo("2", "CONFIRMED", "2026-11-03"), // 8 days
    ovPo("3", "CONFIRMED", "2026-10-12"), // 30 days
    ovPo("4", "CONFIRMED", "2026-10-11"), // 31 days
  ];
  assert.deepEqual(poSummary(list, TODAY, delivered()).bands, { yellow: 1, orange: 2, red: 1 });
});

test("summary tiles: Total, Pending Delivery (SUBMITTED + CONFIRMED only), Overdue, Outstanding lines (chip-eligible POs only)", () => {
  const list = [
    ovPo("a", "DRAFT", "2026-11-30", { items: [line("A", 10, 0)] }),
    ovPo("b", "SUBMITTED", "2026-11-30", { items: [line("A", 10, 0), line("B", 5, 5)] }),
    ovPo("c", "CONFIRMED", "2026-11-05", { items: [line("A", 10, 4), line("B", 2, 0)] }),
    ovPo("d", "PARTIAL_RECEIVED", "2026-11-30", { items: [line("A", 10, 9)] }),
    ovPo("e", "RECEIVED", "2026-10-01", { items: [line("A", 10, 10)] }),
    ovPo("f", "CLOSED", "2026-10-01", { items: [line("A", 10, 0)] }),
    ovPo("g", "CANCELLED", "2026-10-01", { items: [line("A", 10, 0)] }),
  ];
  const sm = poSummary(list, TODAY, delivered());
  assert.equal(sm.total, 7);
  assert.equal(sm.pending, 2, "b and c; PARTIAL_RECEIVED is not Pending Delivery (desktop)");
  assert.equal(sm.overdue, 1, "only c is past due and open");
  assert.equal(sm.outstandingLines, 1 + 2 + 1, "b:1, c:2, d:1 (draft / received / closed / cancelled excluded)");
  assert.equal(list.filter((p) => chipMatches("po", "OUTSTANDING", p)).length, 3, "the chip stays a PO count");
});

test("a PO billed without a GRN keeps its receipt-based Outstanding, but is not Overdue", () => {
  const billed = ovPo("p", "CONFIRMED", "2026-11-01", { items: [line("A", 10, 0)] });
  const sm = poSummary([billed], TODAY, delivered("p"));
  assert.equal(sm.overdue, 0);
  assert.equal(sm.outstandingLines, 1);
  assert.equal(poIsOutstanding(billed), true);
});

test("stats unavailable: Overdue is null (tile unavailable) and the other tiles still count", () => {
  const sm = poSummary([ovPo("a", "CONFIRMED", "2026-11-01")], TODAY, null);
  assert.equal(sm.overdue, null);
  assert.equal(sm.total, 1);
  assert.equal(sm.pending, 1);
});

// ── Date filter ─────────────────────────────────────────────────────────────
test("date ranges are inclusive and built from todayIso with UTC-safe day maths", () => {
  assert.deepEqual(dateRangeBounds("7d", "2026-11-11"), ["2026-11-05", "2026-11-11"]);
  assert.deepEqual(dateRangeBounds("n7", "2026-11-11"), ["2026-11-11", "2026-11-17"]);
  assert.deepEqual(dateRangeBounds("tm", "2026-11-11"), ["2026-11-01", "2026-11-30"]);
  assert.deepEqual(dateRangeBounds("lm", "2026-11-11"), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(dateRangeBounds("nm", "2026-11-11"), ["2026-12-01", "2026-12-31"]);
  assert.deepEqual(dateRangeBounds("any", "2026-11-11"), [null, null]);
});

test("date boundaries: month ends, year rollover, leap February, 7-day edges", () => {
  assert.deepEqual(dateRangeBounds("nm", "2026-12-15"), ["2027-01-01", "2027-01-31"]);
  assert.deepEqual(dateRangeBounds("lm", "2026-01-15"), ["2025-12-01", "2025-12-31"]);
  assert.deepEqual(dateRangeBounds("tm", "2028-02-10"), ["2028-02-01", "2028-02-29"]);
  assert.deepEqual(dateRangeBounds("nm", "2028-01-31"), ["2028-02-01", "2028-02-29"]);
  assert.deepEqual(dateRangeBounds("7d", "2026-03-03"), ["2026-02-25", "2026-03-03"]);
  assert.deepEqual(dateRangeBounds("n7", "2026-12-28"), ["2026-12-28", "2027-01-03"]);
  // Ranges start from todayIso (zone-neutral instant: noon UTC is the same day in Malaysia).
  assert.deepEqual(dateRangeBounds("n7", todayIso(new Date("2026-11-10T12:00:00Z"))), ["2026-11-10", "2026-11-16"]);
});

test("Next 7 days on Expected date: today and day 7 are in, yesterday and day 8 are out", () => {
  const f = (d) => poDateMatches(po({ expectedDate: d }), "exp", "n7", "", "", TODAY);
  assert.deepEqual(["2026-11-10", "2026-11-11", "2026-11-17", "2026-11-18"].map(f), [false, true, true, false]);
});

test("Last 7 days on Order date: 6 days back to today", () => {
  const f = (d) => poDateMatches(po({ orderDate: d }), "order", "7d", "", "", TODAY);
  assert.deepEqual(["2026-11-04", "2026-11-05", "2026-11-11", "2026-11-12"].map(f), [false, true, true, false]);
});

test("Custom: from, to, both, swapped, neither; a PO with no date never matches an active range", () => {
  const m = (d, from, to) => poDateMatches(po({ expectedDate: d }), "exp", "custom", from, to, TODAY);
  assert.equal(m("2026-11-10", "2026-11-10", ""), true);
  assert.equal(m("2026-11-09", "2026-11-10", ""), false);
  assert.equal(m("2026-11-10", "", "2026-11-10"), true);
  assert.equal(m("2026-11-11", "", "2026-11-10"), false);
  assert.equal(m("", "", "2026-11-10"), false, "blank date must not pass a To-only range");
  assert.equal(m("", "2026-11-01", ""), false);
  assert.equal(m("2026-11-05", "2026-11-10", "2026-11-01"), true, "swapped start/end is read in order");
  assert.equal(m("", "", ""), true, "Custom with no dates restricts nothing");
  assert.equal(dateFilterActive("custom", "", ""), false);
  assert.equal(dateFilterActive("custom", "", "2026-11-10"), true);
  assert.equal(dateFilterActive("any"), false);
  assert.equal(dateFilterActive("tm"), true);
});

test("date field and range default to Expected date / Any time; unknown or mismatched values fall back", () => {
  assert.equal(cleanDateField(""), "exp");
  assert.equal(cleanDateField("order"), "order");
  assert.equal(cleanDateRange("exp", ""), "any");
  assert.equal(cleanDateRange("exp", "n7"), "n7");
  assert.equal(cleanDateRange("exp", "7d"), "any", "Last 7 days belongs to Order date");
  assert.equal(cleanDateRange("order", "n7"), "any", "Next 7 days belongs to Expected date");
  assert.ok(DATE_RANGES.exp.some((r) => r.key === "n7") && !DATE_RANGES.exp.some((r) => r.key === "7d"));
  assert.ok(DATE_RANGES.order.some((r) => r.key === "7d") && !DATE_RANGES.order.some((r) => r.key === "n7"));
});

// ── One predicate: supplier + status + date + Overdue + search ──────────────
const BIG = [
  po({ id: "1", poNo: "PO-1", supplierId: "sup-a", supplierName: "Alpha Foam", status: "CONFIRMED", expectedDate: "2026-11-05", orderDate: "2026-10-20", items: [line("FOAM-10", 10, 0)] }),
  po({ id: "2", poNo: "PO-2", supplierId: "sup-a", supplierName: "Alpha Foam", status: "PARTIAL_RECEIVED", expectedDate: "2026-11-14", orderDate: "2026-11-08", items: [line("FOAM-20", 10, 4)] }),
  po({ id: "3", poNo: "PO-3", supplierId: "sup-b", supplierName: "Beta Fabric", status: "CONFIRMED", expectedDate: "2026-11-03", orderDate: "2026-11-09", items: [line("FAB-77", 5, 0)] }),
  po({ id: "4", poNo: "PO-4", supplierId: "sup-b", supplierName: "Beta Fabric", status: "RECEIVED", expectedDate: "2026-11-15", orderDate: "2026-11-10", items: [line("FAB-77", 5, 5)] }),
  po({ id: "5", poNo: "PO-5", supplierId: "sup-a", supplierName: "Alpha Foam", status: "DRAFT", expectedDate: "", orderDate: "2026-11-11", items: [line("FOAM-10", 3, 0)] }),
];
const F = (o = {}) => ({ supplier: "", chip: "", field: "exp", range: "any", from: "", to: "", overdue: false, ...o });
const ids = (f, q = "", d = delivered()) => BIG.filter((p) => poMatchesFilters(p, f, q, TODAY, d)).map((p) => p.id);

test("defaults match everything; every filter narrows and they combine", () => {
  assert.deepEqual(ids(F()), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(ids(F({ supplier: "sup-a" })), ["1", "2", "5"]);
  assert.deepEqual(ids(F({ chip: "OUTSTANDING" })), ["1", "2", "3"]);
  assert.deepEqual(ids(F({ range: "n7" })), ["2", "4"], "expected 11-11..11-17; PO-5 has no date");
  assert.deepEqual(ids(F({ field: "order", range: "7d" })), ["2", "3", "4", "5"]);
  assert.deepEqual(ids(F({ overdue: true })), ["1", "3"]);
  assert.deepEqual(ids(F({ overdue: true, supplier: "sup-b" })), ["3"]);
  assert.deepEqual(ids(F({ supplier: "sup-a", chip: "OUTSTANDING", range: "tm" })), ["1", "2"]);
});

test("all filters + item search + supplier-name search", () => {
  assert.deepEqual(ids(F({ chip: "OUTSTANDING" }), "foam"), ["1", "2"], "supplier name");
  assert.deepEqual(ids(F({ chip: "OUTSTANDING" }), "FOAM-20"), ["2"], "item code");
  assert.deepEqual(ids(F({ supplier: "sup-a", overdue: true }), "foam-10"), ["1"]);
  assert.deepEqual(ids(F({ supplier: "sup-b", overdue: true }), "foam"), []);
  assert.deepEqual(ids(F({ range: "n7", chip: "OUTSTANDING", supplier: "sup-a" }), "foam-20"), ["2"]);
});

test("Overdue is ignored (list stays usable) while stats are unavailable", () => {
  assert.deepEqual(ids(F({ overdue: true }), "", null), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(ids(F({ supplier: "sup-b", chip: "OUTSTANDING" }), "", null), ["3"]);
});

test("Show N POs equals the list after Apply: both come from the same predicate", () => {
  const draft = F({ supplier: "sup-a", chip: "OUTSTANDING", range: "tm" });
  const showN = BIG.filter((p) => poMatchesFilters(p, draft, "foam", TODAY, delivered())).length;
  const listAfterApply = ids(draft, "foam").length;
  assert.equal(showN, listAfterApply);
  assert.equal(showN, 2);
});

test("Reset restores the defaults: all suppliers, All status, Expected date / Any time, no Overdue", () => {
  assert.match(PARTS, /const FILTER_DEFAULT: FilterDraft = \{ supplier: "", chip: "", field: "exp", range: "any", from: "", to: "", overdue: false \}/);
  assert.deepEqual(ids(F()), ids(F({ supplier: "", chip: "", field: "exp", range: "any", overdue: false })));
});

// ── Screen wiring ───────────────────────────────────────────────────────────
test("/stats failure: Overdue unavailable and disabled, the rest of the list still works", () => {
  assert.match(SCREEN, /useCachedJson<Envelope>\(sec === "po" \? "\/api\/purchase-orders\/stats" : null\)/);
  assert.match(SCREEN, /stats\.data\?\.success \? deliveredIdsOf\(rows\(stats\.data\.data\)\) : null/);
  assert.match(SCREEN, /overdueOn = sec === "po" && odRaw === "1" && delivered != null/);
  assert.match(PARTS, /disabled=\{!has\}/);
  assert.match(PARTS, /Overdue unavailable/);
});

test("summary follows the selected supplier only (not search, status, date or Overdue)", () => {
  assert.match(SCREEN, /poSummary\(sec === "po" \? all\.filter\(\(r\) => !supplier \|\| poSupplierKey\(r\) === supplier\) : \[\], today, delivered\)/);
});

test("filter state lives in the URL and the count row has the filter button + removable pills", () => {
  for (const k of ["od", "df", "dr", "from", "to"]) assert.match(SCREEN, new RegExp(`useUrlState<string>\\("${k}", ""\\)`));
  assert.match(SCREEN, /<FilterButton count=\{filterCount\}/);
  assert.match(SCREEN, /<FilterPills pills=\{pills\} onClearAll=\{clearFilters\} \/>/);
});
