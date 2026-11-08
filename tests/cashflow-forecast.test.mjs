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
  assert.deepEqual([over.col, over.sen, over.label, over.order], ["fc:2026-11", 100, cf.OVERDUE_LABEL, fc.OVERDUE_ORDER]);
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

// ---- Forecast P&L lines as cash (spec 6.2) ------------------------------------

const fp = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-pnl.ts")).href);
const acct = (code, type, name = code) => ({ code, name, type, isPostable: true });
const groups = fp.forecastLineGroups([
  acct("701-0010", "COST", "PURCHASE - B.M FABRIC"),
  acct("700-1015", "COST", "CARRIAGE INWARDS"),
  acct("750-0010", "COST", "PRODUCTION - SALARY"),
  acct("780-0030", "COST", "FACTORY RENTAL"),
  acct("780-0080", "COST", "DEPRECIATION - MACHINERY"),
  acct("900-S001", "EXPENSE", "STAFF SALARIES"),
  acct("900-0010", "EXPENSE", "UPKEEP"),
  acct("530-0010", "REVENUE", "OTHER INCOME"),
], {}, [{ code: "PROD-A", bucket: "DIRECT_LABOUR" }]);
const cashOpts = { salaryAccount: "410-0010", nonCash: (code, name) => fc.isNonCashAccount(code, name, "900-I004") };

test("forecastCashLines: dept rows and staff salaries are salaries, opex an expense, rent overhead; materials and other income stay out", () => {
  const m = { salesSen: 1_000_000, pct: {
    "cat:FABRIC": { bp: 3000 }, "700-1015": { bp: 100 }, "530-0010": { bp: 100 },
    "dept:PROD-A": { bp: 1000 }, "900-S001": { bp: 200 }, "900-0010": { bp: 300 },
    "780-0030": { amtSen: 20_000 }, "780-0080": { amtSen: 5_000 },
  } };
  const r = fc.forecastCashLines(m, groups, {}, new Set(), cashOpts);
  const by = Object.fromEntries(r.lines.map((l) => [l.code, l]));
  assert.deepEqual(Object.keys(by).sort(), ["780-0030", "900-0010", "900-S001", "dept:PROD-A"]);
  assert.deepEqual([by["dept:PROD-A"].timing, by["dept:PROD-A"].accountCode, by["dept:PROD-A"].label], ["salary", "410-0010", "PROD-A"]);
  assert.equal(by["900-S001"].timing, "salary");
  assert.equal(by["900-0010"].timing, "expense");
  assert.deepEqual([by["780-0030"].timing, by["780-0030"].amtSen], ["overhead", 20_000]);
  assert.deepEqual(r.excluded, [{ code: "780-0080", name: "DEPRECIATION - MACHINERY", amtSen: 5_000 }]);
});

test("forecastCashLines follows the page's supersede rule", () => {
  const r = fc.forecastCashLines({ salesSen: 1_000_000, pct: { "dept:PROD-A": { bp: 1000 }, "750-0010": { bp: 500 }, "900-S001": { bp: 200 } } }, groups, {}, new Set(["900-S001"]), cashOpts);
  assert.deepEqual(r.lines.map((l) => l.code), ["dept:PROD-A"]);
});

test("isNonCashAccount: depreciation, amortisation, write-offs and the trade-finance interest account", () => {
  assert.equal(fc.isNonCashAccount("900-I004", "INTEREST ON TRADE FINANCE", "900-I004"), true);
  assert.equal(fc.isNonCashAccount("780-0090", "AMORTISATION OF X", "900-I004"), true);
  assert.equal(fc.isNonCashAccount("900-I001", "INCORPORATION EXPENSE WRITTEN OFF", "900-I004"), true);
  assert.equal(fc.isNonCashAccount("900-0010", "UPKEEP", "900-I004"), false);
});

// ---- the whole forecast ----------------------------------------------------------

const inv = (no, sen, expectedYm, o = {}) => sched({ no, sen, expectedYm, ...o });
const line = (code, timing, ratio, o = {}) => ({ code, name: o.name ?? code, timing, ratio, amtSen: o.amtSen ?? 0, accountCode: o.accountCode ?? code, ...(o.label ? { label: o.label } : {}) });
const base = (o = {}) => ({
  today: "2026-11-08",
  period: "2026-11",
  months: ["2026-11", "2026-10", "2026-09"],
  openingYm: "2026-05",
  baselines: new Map([
    ["2026-08", [inv("AUG", 100_000, "2026-08")]],
    ["2026-09", []],
    ["2026-10", []],
    ["2026-11", [inv("NOV", 200_000, "2026-11")]],
  ]),
  live: [
    inv("DEC", 80_000, "2026-12"),
    sched({ kind: "tf", partyName: "L1", no: "D1", sen: 30_000, accountCode: "310-0020", label: "Repaid to L1", expectedYm: "2027-01" }),
  ],
  pnl: new Map([["2026-11", { salesSen: 1_000_000, lines: [
    line("dept:PROD-A", "salary", { num: 1000, den: 10000 }, { accountCode: "410-0010", label: "PROD-A" }),
    line("900-0010", "expense", { num: 300, den: 10000 }),
    line("780-0030", "overhead", { fixedSen: 20_000 }, { amtSen: 20_000 }),
  ] }]]),
  plans: [],
  isCreditorControl: () => false,
  ...o,
});
const inCol = (r, col) => r.legs.filter((l) => l.col === col).map((l) => ({ sen: l.sen, ref: l.item.ref, label: l.label })).sort((a, b) => a.sen - b.sen);

test("buildForecastLegs: future months as far as documents reach; salaries the month after, expenses and overhead the same month", () => {
  const r = fc.buildForecastLegs(base());
  assert.deepEqual(r.columns.map((c) => c.ym), ["2027-01", "2026-12", "2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(r.columns.map((c) => c.future), [true, true, false, false, false]);
  assert.deepEqual(inCol(r, "fc:2026-11"), [
    { sen: -20_000, ref: "780-0030", label: undefined },
    { sen: -6_000, ref: "900-0010", label: undefined },
    { sen: 200_000, ref: "NOV", label: undefined },
  ]);
  assert.deepEqual(inCol(r, "fc:2026-12"), [
    { sen: -20_000, ref: "dept:PROD-A", label: "PROD-A" },
    { sen: 80_000, ref: "DEC", label: undefined },
  ]);
  assert.deepEqual(inCol(r, "fc:2027-01"), [{ sen: -30_000, ref: "D1", label: "Repaid to L1" }], "no salary: December has no Forecast P&L");
});

test("buildForecastLegs: the first month's salaries come from the month before's receipts", () => {
  const r = fc.buildForecastLegs(base({ pnl: new Map([["2026-08", { salesSen: 1_000_000, lines: [
    line("dept:PROD-A", "salary", { num: 1000, den: 10000 }, { accountCode: "410-0010", label: "PROD-A" }),
  ] }]]) }));
  assert.deepEqual(inCol(r, "fc:2026-09"), [{ sen: -10_000, ref: "dept:PROD-A", label: "PROD-A" }]);
  assert.ok(!r.columns.some((c) => c.ym === "2026-08"));
});

test("buildForecastLegs: a bill already counted on the same account and month comes off, floored at zero", () => {
  const ocb = (sen) => sched({ kind: "ocb", partyName: "P1", no: "OCB", sen, accountCode: "405-0000", mix: [{ accountCode: "900-0010", weight: 1 }], expectedYm: "2026-11" });
  const r4 = fc.buildForecastLegs(base({ baselines: new Map([...base().baselines, ["2026-11", [inv("NOV", 200_000, "2026-11"), ocb(4_000)]]]) }));
  assert.equal(r4.legs.find((l) => l.col === "fc:2026-11" && l.item.kind === "pnl" && l.item.ref === "900-0010").sen, -2_000);
  const r8 = fc.buildForecastLegs(base({ baselines: new Map([...base().baselines, ["2026-11", [inv("NOV", 200_000, "2026-11"), ocb(8_000)]]]) }));
  assert.equal(r8.legs.filter((l) => l.item.kind === "pnl" && l.item.ref === "900-0010").length, 0);
});

test("review 4: zero sales pays RM lines as keyed; a month without Forecast P&L gets no salary or expense", () => {
  const r = fc.buildForecastLegs(base({ pnl: new Map([["2026-11", { salesSen: 0, lines: [line("900-0010", "expense", { fixedSen: 50_000 }, { amtSen: 50_000 })] }]]) }));
  assert.equal(r.legs.find((l) => l.item.kind === "pnl").sen, -50_000);
  assert.deepEqual(inCol(r, "fc:2026-10"), []);
});

test("buildForecastLegs: planned payments as at each month's 1st", () => {
  const plan = (id, expectedDate, doneAt = null) => ({ id, party: id, ref: null, expectedDate, amountSen: 1000, doneAt });
  const r = fc.buildForecastLegs(base({ plans: [
    plan("A", "2026-10-20"),
    plan("B", "2026-11-25", "2026-11-15T03:00:00.000Z"),
    plan("C", "2026-10-05", "2026-10-06T03:00:00.000Z"),
    plan("D", "2026-12-10"),
    plan("E", "2027-03-01"),
  ] }));
  const where = (id) => r.legs.filter((l) => l.item.kind === "planned" && l.item.party === id).map((l) => l.col).sort();
  assert.deepEqual(where("A"), ["fc:2026-10", "fc:2026-11"]);
  assert.deepEqual(where("B"), ["fc:2026-11"]);
  assert.deepEqual(where("C"), ["fc:2026-10"]);
  assert.deepEqual(where("D"), ["fc:2026-12"]);
  assert.deepEqual(where("E"), [], "beyond the horizon");
  assert.ok(r.legs.filter((l) => l.item.kind === "planned").every((l) => l.section === "PLANNED" && l.label === "Planned payments" && l.sen === -1000));
});

test("buildForecastLegs: months up to the opening month are blank, and their receipts set no salary", () => {
  const r = fc.buildForecastLegs(base({
    openingYm: "2026-10",
    pnl: new Map([["2026-10", { salesSen: 1_000_000, lines: [line("dept:PROD-A", "salary", { num: 1000, den: 10000 }, { accountCode: "410-0010", label: "PROD-A" })] }]]),
  }));
  assert.deepEqual(r.columns.filter((c) => c.blank).map((c) => c.ym), ["2026-10", "2026-09"]);
  assert.deepEqual(inCol(r, "fc:2026-10"), []);
  assert.deepEqual(inCol(r, "fc:2026-09"), []);
  assert.ok(!r.legs.some((l) => l.col === "fc:2026-11" && l.item.kind === "pnl"));
});

test("review 3: an earlier period has no future columns", () => {
  const r = fc.buildForecastLegs(base({ period: "2026-10", months: ["2026-10", "2026-09"], live: null }));
  assert.deepEqual(r.columns.map((c) => [c.ym, c.future]), [["2026-10", false], ["2026-09", false]]);
});

test("review 5: a document dated after the 1st and due the same month is in no forecast column", () => {
  const r = fc.buildForecastLegs(base({ live: [inv("COD", 7_000, "2026-11", { date: "2026-11-03" })] }));
  assert.ok(!r.legs.some((l) => l.item.ref === "COD"));
});

test("buildForecastLegs names the parties whose term was guessed", () => {
  const r = fc.buildForecastLegs(base({ live: [{ ...inv("DEC", 80_000, "2026-12"), partyName: "Z1", termFlagged: true }] }));
  assert.deepEqual(r.termFlagged, ["Z1"]);
});
