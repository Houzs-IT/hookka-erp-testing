// Cash Flow forecast — pure scheduling (spec:
// docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);
const cf = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-engine.ts")).href);

const term = (months) => () => ({ months, flagged: false });
const doc = (o) => ({ kind: "invoice", partyId: "C1", partyName: "C1", no: "X", date: "2026-10-01", sen: 0, accountCode: "300-0000", ...o });
const sched = (o) => ({ ...doc(o), expectedYm: o.expectedYm, dueSen: o.dueSen ?? o.sen, termFlagged: false });
const notControl = () => false;

// ---- terms -----------------------------------------------------------------

test("parseTermMonths reads NETn, days, months, C.O.D. / CASH; anything else is one month, flagged", () => {
  const cases = [
    ["NET30", 1, false], ["NET60", 2, false], ["NET45", 2, false], ["NET15", 1, false], ["NET0", 0, false],
    ["C.O.D.", 0, false], ["cod", 0, false], ["CASH", 0, false], ["30 days", 1, false], ["2 Months", 2, false],
    ["", 1, true], [null, 1, true], [undefined, 1, true], ["SOON", 1, true],
  ];
  for (const [raw, months, flagged] of cases) assert.deepEqual(fc.parseTermMonths(raw), { months, flagged }, String(raw));
});

test("addMonthsYm crosses year ends both ways", () => {
  assert.equal(fc.addMonthsYm("2026-11", 2), "2027-01");
  assert.equal(fc.addMonthsYm("2026-01", -1), "2025-12");
  assert.equal(fc.addMonthsYm("2026-09", 0), "2026-09");
});

// ---- schedule and netting ---------------------------------------------------

test("credits knock off the customer's oldest expected invoice first, never below zero", () => {
  const out = fc.scheduleOpenDocs([
    doc({ no: "S1", date: "2026-09-10", sen: 5000 }),
    doc({ no: "S2", date: "2026-10-05", sen: 3000 }),
    doc({ no: "R1 · Advance", date: "2026-10-20", sen: -6000 }),
  ], term(1));
  const by = Object.fromEntries(out.map((d) => [d.no, d]));
  assert.deepEqual([by.S1.expectedYm, by.S1.dueSen], ["2026-10", 0]);
  assert.deepEqual([by.S2.expectedYm, by.S2.dueSen], ["2026-11", 2000]);
  assert.equal(out.length, 2, "the advance is not a line of its own");
  assert.ok(out.every((d) => d.dueSen >= 0));
});

test("a two-month customer pays the invoices of two months ago", () => {
  const [d] = fc.scheduleOpenDocs([doc({ date: "2026-09-30", sen: 100 })], term(2));
  assert.equal(d.expectedYm, "2026-11");
});

test("review 2: a party with only credits gives nothing, not a negative payment", () => {
  const out = fc.scheduleOpenDocs([
    doc({ kind: "pi", partyId: "S9", sen: -1208, accountCode: "400-0000" }),
    doc({ kind: "pi", partyId: "S9", sen: -50, accountCode: "400-0000" }),
  ], term(1));
  assert.deepEqual(out, []);
});

test("credits net within one party and one kind only", () => {
  const out = fc.scheduleOpenDocs([
    doc({ partyId: "C1", sen: 1000 }),
    doc({ partyId: "C2", sen: -1000 }),
    doc({ kind: "pi", partyId: "C1", sen: -1000, accountCode: "400-0000" }),
  ], term(1));
  assert.equal(out.find((d) => d.partyId === "C1" && d.kind === "invoice").dueSen, 1000);
});

test("trade finance: each draw on its due month; an unallocated repayment nets the oldest due first", () => {
  const tf = (o) => doc({ kind: "tf", partyId: "310-0020", partyName: "L1", accountCode: "310-0020", label: "Repaid to L1", ...o });
  const out = fc.scheduleOpenDocs([
    tf({ no: "D2", date: "2027-01-10", sen: 20_000 }),
    tf({ no: "D1", date: "2026-12-15", sen: 30_000 }),
    tf({ no: "unallocated", date: "", sen: -5_000 }),
  ], () => ({ months: 0, flagged: false }));
  const by = Object.fromEntries(out.map((d) => [d.no, d]));
  assert.deepEqual([by.D1.expectedYm, by.D1.dueSen], ["2026-12", 25_000]);
  assert.deepEqual([by.D2.expectedYm, by.D2.dueSen], ["2027-01", 20_000]);
});

// ---- columns ----------------------------------------------------------------

test("baseline column: earlier lines are overdue, this month's are due, later ones wait", () => {
  const docs = [
    sched({ no: "A", sen: 100, expectedYm: "2026-10" }),
    sched({ no: "B", sen: 200, expectedYm: "2026-11" }),
    sched({ no: "C", sen: 300, expectedYm: "2026-12" }),
  ];
  const legs = fc.docLegsForColumn(docs, "2026-11", "baseline", notControl);
  assert.equal(legs.length, 2);
  const over = legs.find((l) => l.item.ref === "A");
  assert.deepEqual([over.col, over.sen, over.label, over.order], ["fc:2026-11", 100, cf.OVERDUE_LABEL, 98]);
  const due = legs.find((l) => l.item.ref === "B");
  assert.deepEqual([due.sen, due.label, due.accountCode], [200, undefined, "300-0000"]);
  const fut = fc.docLegsForColumn(docs, "2026-12", "future", notControl);
  assert.deepEqual(fut.map((l) => l.item.ref), ["C"], "a future column takes only its own month");
});

test("a line fully knocked off gives no leg", () => {
  assert.deepEqual(fc.docLegsForColumn([sched({ sen: 100, dueSen: 0, expectedYm: "2026-11" })], "2026-11", "baseline", notControl), []);
});

test("signs and accounts follow the document: receipts in, bills out", () => {
  const isCtl = (c) => c === "400-0000";
  const legs = fc.docLegsForColumn([
    sched({ no: "INV", sen: 500, expectedYm: "2026-11" }),
    sched({ kind: "pi", no: "PI", sen: 700, accountCode: "400-0000", splitKey: "fc:pi:7", expectedYm: "2026-11" }),
    sched({ kind: "ocb", partyName: "P1", no: "OCB1", sen: 4000, accountCode: "405-0000", mix: [{ accountCode: "900-0010", weight: 3 }, { accountCode: "200-0040", weight: 1 }], expectedYm: "2026-11" }),
    sched({ kind: "ocb", partyName: "P1", no: "OCB2", sen: 900, accountCode: "405-0000", mix: [{ accountCode: "400-0000", weight: 1 }], expectedYm: "2026-11" }),
    sched({ kind: "ocb", partyName: "P1", no: "OCB3", sen: 50, accountCode: "405-0000", expectedYm: "2026-11" }),
    sched({ kind: "tf", partyName: "L1", no: "D1", sen: 300, accountCode: "310-0020", label: "Repaid to L1", expectedYm: "2026-11" }),
    sched({ kind: "odb", partyName: "OD1", no: "ODB1", sen: 80, accountCode: "305-0000", expectedYm: "2026-11" }),
  ], "2026-11", "baseline", isCtl);
  const of = (ref) => legs.filter((l) => l.item.ref === ref).map((l) => ({ sen: l.sen, accountCode: l.accountCode, label: l.label, splitKey: l.splitKey }));
  assert.deepEqual(of("INV"), [{ sen: 500, accountCode: "300-0000", label: undefined, splitKey: undefined }]);
  assert.deepEqual(of("PI"), [{ sen: -700, accountCode: "400-0000", label: undefined, splitKey: "fc:pi:7" }]);
  assert.deepEqual(of("OCB1").sort((a, b) => a.accountCode.localeCompare(b.accountCode)), [
    { sen: -1000, accountCode: "200-0040", label: undefined, splitKey: undefined },
    { sen: -3000, accountCode: "900-0010", label: undefined, splitKey: undefined },
  ]);
  assert.deepEqual(of("OCB2"), [{ sen: -900, accountCode: "400-0000", label: "Suppliers settled via P1", splitKey: undefined }]);
  assert.deepEqual(of("OCB3"), [{ sen: -50, accountCode: "405-0000", label: "P1 (other creditor)", splitKey: undefined }]);
  assert.deepEqual(of("D1"), [{ sen: -300, accountCode: "310-0020", label: "Repaid to L1", splitKey: undefined }]);
  assert.deepEqual(of("ODB1"), [{ sen: 80, accountCode: "305-0000", label: undefined, splitKey: undefined }]);
});

test("an overdue other-creditor bill keeps its accounts, labelled overdue, and never splits by material", () => {
  const legs = fc.docLegsForColumn([
    sched({ kind: "ocb", partyName: "P1", no: "OCB1", sen: 4000, accountCode: "405-0000", mix: [{ accountCode: "900-0010", weight: 3 }, { accountCode: "200-0040", weight: 1 }], expectedYm: "2026-10" }),
    sched({ kind: "pi", no: "PI", sen: 700, accountCode: "400-0000", splitKey: "fc:pi:7", expectedYm: "2026-09" }),
  ], "2026-11", "baseline", notControl);
  assert.ok(legs.every((l) => l.label === cf.OVERDUE_LABEL && l.splitKey === undefined));
  assert.deepEqual(legs.map((l) => l.sen).sort((a, b) => a - b), [-3000, -1000, -700].sort((a, b) => a - b));
});

test("review 1: an ambiguous PI number resolves to no PI", () => {
  const idOf = fc.piIdIndex([
    { id: "a", piNo: "PI-1", supplierId: "S" },
    { id: "b", piNo: "PI-1", supplierId: "S" },
    { id: "c", piNo: "PI-2", supplierId: "S" },
  ]);
  assert.equal(idOf("S", "PI-1"), null);
  assert.equal(idOf("S", "PI-2"), "c");
  assert.equal(idOf("T", "PI-2"), null);
});
