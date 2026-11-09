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

// ---- opening period (owner 2026-11-09 「把这些初期的排除掉」 → the customers' receipts) ----

test("openingCreditCutoffYm: the month after the opening month; none without an opening", () => {
  assert.equal(fc.openingCreditCutoffYm("2026-05"), "2026-06");
  assert.equal(fc.openingCreditCutoffYm("2026-12"), "2027-01");
  assert.equal(fc.openingCreditCutoffYm(null), null);
});

test("an opening-period customer receipt is left out of the netting; the invoices still count", () => {
  const docs = [
    doc({ no: "OLD-INV", date: "2026-05-30", sen: 4000 }),
    doc({ no: "NEW-INV", date: "2026-10-05", sen: 9000 }),
    doc({ no: "R-JUN · Advance", date: "2026-06-30", sen: -7000 }),
    doc({ no: "R-JUL · Advance", date: "2026-07-01", sen: -500 }),
    doc({ kind: "pi", partyId: "S1", partyName: "S1", no: "P-ADV · Advance", date: "2026-06-03", sen: -300, accountCode: "400-0000" }),
  ];
  const { kept, leftOut } = fc.splitOpeningCredits(docs, "2026-06");
  assert.deepEqual(leftOut.map((d) => d.no), ["R-JUN · Advance"]);
  assert.deepEqual(kept.map((d) => d.no), ["OLD-INV", "NEW-INV", "R-JUL · Advance", "P-ADV · Advance"], "a July receipt, the invoices and supplier payments stay");
  const by = Object.fromEntries(fc.scheduleOpenDocs(kept, term(1)).map((d) => [d.no, d.dueSen]));
  assert.deepEqual([by["OLD-INV"], by["NEW-INV"]], [3500, 9000], "only the July receipt is knocked off, oldest first");
});

test("without an opening month nothing is left out", () => {
  const docs = [doc({ no: "R · Advance", date: "2026-06-30", sen: -7000 })];
  assert.deepEqual(fc.splitOpeningCredits(docs, null), { kept: docs, leftOut: [] });
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

// ---- keyed capex & financing (spec 6.4, owner 2026-11-09 「做」) ---------------

const keyedLegs = (r) => r.legs.filter((l) => l.item.kind === "input");

test("a keyed amount lands in its month's forecast column on its account, the statement's way round", () => {
  const r = fc.buildForecastLegs(base({ inputs: { "2026-12": { "200-0030": -500_000, "440-0030": 300_000 } } }));
  assert.deepEqual(keyedLegs(r).map((l) => [l.col, l.accountCode, l.sen]).sort(), [["fc:2026-12", "200-0030", -500_000], ["fc:2026-12", "440-0030", 300_000]]);
  assert.ok(keyedLegs(r).every((l) => !l.section && !l.label && !l.splitKey), "placed by its account, like a ledger leg");
  assert.ok(!r.legs.some((l) => l.item.kind === "pnl" && l.col === "fc:2026-12" && l.sen > 0), "keyed money is not a receipt: salaries do not scale with it");
});

test("a keyed month no document reaches is shown, at most eleven months ahead", () => {
  const r = fc.buildForecastLegs(base({ inputs: { "2027-03": { "200-0030": -100 }, "2027-11": { "200-0030": -100 } } }));
  assert.deepEqual(r.columns.filter((c) => c.future).map((c) => c.ym), ["2027-03", "2027-02", "2027-01", "2026-12"]);
  assert.deepEqual(keyedLegs(r).map((l) => l.col), ["fc:2027-03"], "twelve months on is past the input table");
});

test("a keyed amount in a past or current month stays in that month's forecast column; opening months get none", () => {
  const r = fc.buildForecastLegs(base({ openingYm: "2026-09", inputs: { "2026-10": { "440-0030": -2_000 }, "2026-09": { "440-0030": -9 } } }));
  assert.deepEqual(keyedLegs(r).map((l) => [l.col, l.sen]), [["fc:2026-10", -2_000]]);
});

test("without keyed amounts the forecast is what it was; a zero stretches no month", () => {
  assert.deepEqual(fc.buildForecastLegs(base({ inputs: {} })), fc.buildForecastLegs(base()));
  assert.deepEqual(fc.buildForecastLegs(base({ inputs: { "2027-05": { "200-0030": 0 } } })), fc.buildForecastLegs(base()));
});

test("an earlier period's statement gets no future months from keyed amounts", () => {
  const r = fc.buildForecastLegs(base({ period: "2026-10", months: ["2026-10", "2026-09"], live: null, inputs: { "2026-12": { "200-0030": -100 } } }));
  assert.ok(!r.columns.some((c) => c.future));
  assert.deepEqual(keyedLegs(r), []);
});

test("keyableAccounts: postable CAPEX and Loan accounts, the owner's mapping first; depreciation and headers left out", () => {
  const accts = [
    { code: "200-0030", name: "PLANT & MACHINERY", type: "ASSET", isPostable: true },
    { code: "200-0035", name: "ACCUM. DEPRN. - PLANT & MACHINERY", type: "ASSET", isPostable: true },
    { code: "440-0000", name: "LOAN FROM RELATED PARTIES", type: "LIABILITY", isPostable: false },
    { code: "440-0030", name: "LOAN FROM RELATED PARTY", type: "LIABILITY", isPostable: true },
    { code: "480-0000", name: "HIRE PURCHASE CREDITOR", type: "LIABILITY", isPostable: true },
    { code: "900-0010", name: "UPKEEP", type: "EXPENSE", isPostable: true },
    { code: "910-0001", name: "DEPOSIT FOR MACHINE", type: "ASSET", isPostable: true },
  ];
  const map = { "480-0000": { section: "GENERAL_EXPENSE" }, "910-0001": { section: "CAPEX" } };
  const sectionOf = (a) => map[a.code]?.section ?? cf.defaultSectionFor(a);
  assert.deepEqual(fc.keyableAccounts(accts, sectionOf), [
    { code: "200-0030", name: "PLANT & MACHINERY", section: "CAPEX" },
    { code: "440-0030", name: "LOAN FROM RELATED PARTY", section: "LOAN" },
    { code: "910-0001", name: "DEPOSIT FOR MACHINE", section: "CAPEX" },
  ]);
});

test("cleanKeyedInputs: whole sen, real months, allowed accounts only, zeros dropped", () => {
  const raw = { "2026-12": { "200-0030": -500_000.4, "440-0030": 0, "900-0010": -5 }, "2026-13": { "200-0030": -1 }, nope: { "200-0030": 1 }, "2027-01": { "440-0030": "x" } };
  const r = fc.cleanKeyedInputs(raw, new Set(["200-0030", "440-0030"]));
  assert.deepEqual(r.months, { "2026-12": { "200-0030": -500_000 } });
  assert.deepEqual(r.rejected, ["900-0010"]);
  assert.deepEqual(fc.cleanKeyedInputs(raw, null).months, { "2026-12": { "200-0030": -500_000, "900-0010": -5 } }, "no list: every account is kept");
  assert.deepEqual(fc.cleanKeyedInputs("junk", null), { months: {}, rejected: [] });
});

test("keyedInputGroups: every offered account is a row (CAPEX, then Loan, each by code); a keyed account no longer offered shows to be cleared", () => {
  const accounts = [
    { code: "440-0030", name: "L", section: "LOAN" },
    { code: "910-0001", name: "D", section: "CAPEX" },
    { code: "200-0030", name: "P", section: "CAPEX" },
  ];
  assert.deepEqual(fc.keyedInputGroups(accounts, {}), [
    { group: "CAPEX", codes: ["200-0030", "910-0001"] },
    { group: "LOAN", codes: ["440-0030"] },
  ], "nothing keyed: every account is there to type into");
  const months = { "2026-10": { "900-0010": -5 }, "2026-12": { "200-0030": -500_000, "900-0010": -1, "100-0001": 7, "300-0000": 0 } };
  assert.deepEqual(fc.keyedInputGroups(accounts, months), [
    { group: "CAPEX", codes: ["200-0030", "910-0001"] },
    { group: "LOAN", codes: ["440-0030"] },
    { group: "OTHER", codes: ["100-0001", "900-0010"] },
  ], "a past month counts too (the server refuses the whole map while one is there); a zero does not");
  assert.deepEqual(fc.keyedInputGroups([{ code: "200-0030", name: "P", section: "CAPEX" }], {}), [{ group: "CAPEX", codes: ["200-0030"] }], "an empty group is left out");
});

test("clearKeyedCode: a row's clear empties the months shown; an account no longer offered goes from every month", () => {
  const months = { "2026-10": { "200-0030": -1, "900-0010": -5 }, "2026-11": { "200-0030": -2 }, "2026-12": { "200-0030": -3, "440-0030": 4 } };
  assert.deepEqual(fc.clearKeyedCode(months, "200-0030", ["2026-11", "2026-12"]), {
    "2026-10": { "200-0030": -1, "900-0010": -5 },
    "2026-12": { "440-0030": 4 },
  }, "an earlier month is kept; a month left empty goes");
  assert.deepEqual(fc.clearKeyedCode(months, "900-0010", null), {
    "2026-10": { "200-0030": -1 },
    "2026-11": { "200-0030": -2 },
    "2026-12": { "200-0030": -3, "440-0030": 4 },
  });
  assert.deepEqual(months["2026-11"], { "200-0030": -2 }, "the map passed in is left as it was");
});

// ---- The P&L forecast column (spec 2026-11-09-forecast-three-columns-design.md 3) ----

const fpnl = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-pnl.ts")).href);
const pAccts = [
  { code: "701-0010", name: "PURCHASE - B.M FABRIC", type: "COST", isPostable: true },
  { code: "700-1015", name: "CARRIAGE INWARDS", type: "COST", isPostable: true },
  { code: "750-0010", name: "PRODUCTION - SALARY", type: "COST", isPostable: true },
  { code: "780-0030", name: "FACTORY RENTAL", type: "COST", isPostable: true },
  { code: "900-0010", name: "UPKEEP", type: "EXPENSE", isPostable: true },
  { code: "900-D001", name: "DEPRECIATION", type: "EXPENSE", isPostable: true },
  { code: "530-0010", name: "OTHER INCOME", type: "REVENUE", isPostable: true },
];
const pGroups = fpnl.forecastLineGroups(pAccts, {}, [{ code: "PROD-A", bucket: "DIRECT_LABOUR" }]);
const pBase = (o = {}) => ({
  today: "2026-11-09", period: "2026-11", months: ["2026-11", "2026-10"], openingYm: "2026-05",
  fcMonths: {}, groups: pGroups, override: {}, mappedAccounts: new Set(),
  salaryAccount: "410-0010", arAcct: "300-0000",
  nonCash: (code, name) => /DEPRECIATION/.test(name),
  customerTerm: (id) => ({ c30: 1, c60: 2, cCash: 0 })[id] ?? 1,
  customerName: (id) => id.toUpperCase(),
  receiptMix: [{ months: 1, weight: 1 }],
  materialMix: () => [{ months: 1, weight: 1 }],
  ...o,
});
const sumAt = (r, col, pred = () => true) => r.legs.filter((l) => l.col === col && pred(l)).reduce((s, l) => s + l.sen, 0);

test("termMixOf / spreadByMix: weights by delay; parts add up; nothing known = one month", () => {
  assert.deepEqual(fc.termMixOf([{ months: 2, sen: 100 }, { months: 1, sen: 300 }, { months: 2, sen: 100 }, { months: 0, sen: 0 }]), [{ months: 1, weight: 300 }, { months: 2, weight: 200 }]);
  assert.deepEqual(fc.termMixOf([]), [{ months: 1, weight: 1 }]);
  const parts = fc.spreadByMix(1000, [{ months: 1, weight: 1 }, { months: 2, weight: 2 }]);
  assert.deepEqual(parts.map((p) => p.months), [1, 2]);
  assert.equal(parts.reduce((s, p) => s + p.sen, 0), 1000);
});

test("P&L forecast money in: each customer by its own term, Other after a month; a total-only month by the invoices' term mix", () => {
  const r = fc.buildPnlForecastLegs(pBase({
    fcMonths: {
      "2026-11": { salesSen: 1, salesByCustomer: { c30: 60_000, c60: 30_000, cCash: 5_000, other: 5_000 } },
      "2026-10": { salesSen: 40_000 },
    },
    receiptMix: [{ months: 1, weight: 3 }, { months: 2, weight: 1 }],
  }));
  const recv = (col) => sumAt(r, col, (l) => l.accountCode === "300-0000");
  assert.equal(recv("fp:2026-11"), 35_000, "the cash customer in its month; three quarters of October's total a month later");
  assert.equal(recv("fp:2026-12"), 75_000, "30-day customer, Other, the rest of October");
  assert.equal(recv("fp:2027-01"), 30_000, "the 60-day customer");
  assert.ok(r.legs.every((l) => l.col.startsWith("fp:") && l.item.kind === "pnl"));
  assert.ok(r.legs.some((l) => l.item.party === "C60" && l.col === "fp:2027-01"), "the drill names the customer");
});

test("P&L forecast money out: materials by their suppliers' terms, salaries the month after, the rest in the month; non-cash and superseded lines left out", () => {
  const r = fc.buildPnlForecastLegs(pBase({
    fcMonths: { "2026-11": { salesSen: 100_000, pct: {
      "cat:FABRIC": { bp: 3000 }, "700-1015": { amtSen: 1_000 }, "dept:PROD-A": { bp: 1000 }, "750-0010": { bp: 500 },
      "780-0030": { amtSen: 2_000 }, "900-0010": { bp: 300 }, "900-D001": { amtSen: 9_999 }, "530-0010": { amtSen: 700 },
    } } },
    materialMix: (type) => (type === "FABRIC" ? [{ months: 2, weight: 1 }] : [{ months: 1, weight: 1 }]),
  }));
  const fab = r.legs.filter((l) => l.label === "FABRIC");
  assert.deepEqual(fab.map((l) => [l.col, l.sen, l.section]), [["fp:2027-01", -30_000, "RAW_MATERIALS"]], "on the type's own Raw Materials line, two months on");
  assert.equal(sumAt(r, "fp:2026-11"), -5_300, "carriage, rent, upkeep out and other income in, all in the month");
  const dept = r.legs.filter((l) => l.label === "PROD-A");
  assert.deepEqual(dept.map((l) => [l.col, l.sen, l.accountCode]), [["fp:2026-12", -10_000, "410-0010"]]);
  assert.ok(!r.legs.some((l) => l.accountCode === "750-0010"), "a department month supersedes the 750-x account");
  assert.ok(!r.legs.some((l) => l.accountCode === "900-D001"), "depreciation moves no cash");
  assert.equal(sumAt(r, "fp:2026-12", (l) => l.accountCode === "300-0000"), 100_000, "November's sales a month later");
});

test("P&L forecast columns: the statement's months, then future months as far as its money reaches (at most twelve ahead); nothing at or before the opening month; none ahead on an earlier period", () => {
  const r = fc.buildPnlForecastLegs(pBase({
    months: ["2026-11", "2026-10", "2026-05"],
    fcMonths: { "2026-05": { salesSen: 10 }, "2026-11": { salesSen: 1, salesByCustomer: { c60: 100_000 } }, "2027-12": { salesSen: 50_000 } },
  }));
  assert.deepEqual(r.columns.map((c) => [c.ym, c.future, c.blank, c.kind]), [
    ["2027-01", true, false, "pnl"], ["2026-12", true, false, "pnl"],
    ["2026-11", false, false, "pnl"], ["2026-10", false, false, "pnl"], ["2026-05", false, true, "pnl"],
  ]);
  assert.ok(!r.legs.some((l) => l.col === "fp:2026-05" || l.col === "fp:2026-06" || l.col > "fp:2027-01"));
  const earlier = fc.buildPnlForecastLegs(pBase({ period: "2026-10", months: ["2026-10"], fcMonths: { "2026-11": { salesSen: 100 } } }));
  assert.deepEqual(earlier.columns.map((c) => c.ym), ["2026-10"]);
  assert.deepEqual(earlier.legs, []);
});

test("sharedForecastLegs: trade finance, planned payments and keyed amounts appear in the P&L forecast too", () => {
  const docs = [
    { col: "fc:2026-11", sen: -100, accountCode: "310-0020", label: "Repaid to L", item: { kind: "tf", party: "L", ref: "D1" } },
    { col: "fc:2026-11", sen: -50, section: "PLANNED", label: "Planned payments", item: { kind: "planned", party: "B", ref: "" } },
    { col: "fc:2026-12", sen: -40, accountCode: "200-0040", item: { kind: "input", party: "K", ref: "200-0040" } },
    { col: "fc:2026-11", sen: -70, accountCode: "400-0000", item: { kind: "pi", party: "S", ref: "PI-1" } },
    { col: "fc:2026-10", sen: -10, accountCode: "310-0020", label: "Repaid to L", item: { kind: "tf", party: "L", ref: "D0" } },
  ];
  const cols = [
    { ym: "2026-12", future: true, blank: false, kind: "pnl" },
    { ym: "2026-11", future: false, blank: false, kind: "pnl" },
    { ym: "2026-10", future: false, blank: true, kind: "pnl" },
  ];
  assert.deepEqual(fc.sharedForecastLegs(docs, cols).map((l) => [l.col, l.sen, l.item.kind]), [
    ["fp:2026-11", -100, "tf"], ["fp:2026-11", -50, "planned"], ["fp:2026-12", -40, "input"],
  ]);
});

// ---- Trade-finance plans (spec 2026-11-09-forecast-three-columns-design.md 5) ----

test("cleanTfPlans: trade-finance accounts only, whole sen, a sane tenor and rate; junk reads as nothing", () => {
  const raw = { "310-0020": { tenorDays: 90.4, rateBp: 120, months: { "2026-11": 100_000.4, "2026-13": 5, "2026-12": 0, "2027-01": -1 } }, "200-0040": { months: { "2026-11": 9 } }, "310-0030": { tenorDays: 9999, rateBp: -5, months: {} } };
  const r = fc.cleanTfPlans(raw, new Set(["310-0020", "310-0030"]));
  assert.deepEqual(r.facilities, { "310-0020": { tenorDays: 90, rateBp: 120, months: { "2026-11": 100_000 } }, "310-0030": { months: {} } });
  assert.deepEqual(r.rejected, ["200-0040"]);
  assert.deepEqual(fc.cleanTfPlans("junk", null), { facilities: {}, rejected: [] });
});

test("a plan repays a tenor later, interest on the principal", () => {
  assert.equal(fc.tfRepayYm("2026-11", 90), "2027-02");
  assert.equal(fc.tfRepayYm("2026-11", 45), "2027-01");
  assert.equal(fc.tfInterestSen(10_000_000, 120), 120_000);
  // The default rate: the last six draws, each scaled to the tenor.
  const draws = [
    { drawDate: "2026-10-01", dueDate: "2026-12-30", amountSen: 10_100, interestSen: 100, bankChargeSen: 0 },
    { drawDate: "2026-09-01", dueDate: "2026-10-16", amountSen: 20_100, interestSen: 100, bankChargeSen: 0 },
  ];
  assert.equal(fc.defaultTfRateBp(draws, 90), 100);
  assert.equal(fc.defaultTfRateBp([], 90), 0);
});

const tfPlan = { accountCode: "310-0020", lender: "L", tenorDays: 90, rateBp: 100, months: { "2026-10": 30_000, "2026-11": 100_000, "2026-12": 50_000 } };
const tfPlanOpts = (kind) => ({ kind, currentYm: "2026-11", drawnThisMonth: () => 60_000, interestAccount: "900-I004" });
const tfLegsAt = (legs, col) => legs.filter((l) => l.col === col).map((l) => [l.sen, l.label ?? l.accountCode]);

test("a plan's own month shows it as keyed in both forecasts, with its interest on Finance Cost and on Trade Finance", () => {
  for (const kind of ["docs", "pnl"]) {
    const legs = fc.tfPlanLegs([tfPlan], tfPlanOpts(kind));
    const p = kind === "docs" ? "fc" : "fp";
    assert.deepEqual(tfLegsAt(legs, `${p}:2026-11`), [[100_000, fc.TF_PLAN_LABEL], [-1_000, "900-I004"], [1_000, "Interest charged by L"]], kind);
    assert.deepEqual(tfLegsAt(legs, `${p}:2026-10`).map((x) => x[0]), [30_000, -300, 300], `${kind}: a past month keeps its plan for the comparison`);
  }
});

test("repayments: the P&L forecast repays every plan in full; the Docs forecast only what is not drawn yet", () => {
  const pnl = fc.tfPlanLegs([tfPlan], tfPlanOpts("pnl"));
  assert.deepEqual(tfLegsAt(pnl, "fp:2027-01"), [[-30_300, "Repaid to L"]]);
  assert.deepEqual(tfLegsAt(pnl, "fp:2027-02"), [[-101_000, "Repaid to L"]], "plan 100k repaid 100k + interest, whatever was really drawn");
  assert.deepEqual(tfLegsAt(pnl, "fp:2027-03"), [[-50_500, "Repaid to L"]]);
  const docs = fc.tfPlanLegs([tfPlan], tfPlanOpts("docs"));
  assert.deepEqual(tfLegsAt(docs, "fc:2027-01"), [], "a past month's plan: what was drawn is in the aging");
  assert.deepEqual(tfLegsAt(docs, "fc:2027-02"), [[-40_400, "Repaid to L"]], "this month: 100k planned, 60k already drawn");
  assert.deepEqual(tfLegsAt(docs, "fc:2027-03"), [[-50_500, "Repaid to L"]]);
});

test("sharedForecastLegs leaves out of the P&L forecast a real draw made since the facility's first planned month", () => {
  const tf = (drawnOn, sen) => ({ col: "fc:2026-12", sen, accountCode: "310-0020", label: "Repaid to L", item: { kind: "tf", party: "L", ref: drawnOn, drawnOn } });
  const cols = [{ ym: "2026-12", future: true, blank: false, kind: "pnl" }];
  const out = fc.sharedForecastLegs([tf("2026-10-20", -1), tf("2026-09-14", -2)], cols, { "310-0020": "2026-10" });
  assert.deepEqual(out.map((l) => l.sen), [-2], "the plan stands for the October draw");
  assert.deepEqual(fc.sharedForecastLegs([tf("2026-10-20", -1)], cols).map((l) => l.sen), [-1], "no plan: every real draw");
});

const tfSched = {
  yms: ["2026-11", "2026-12", "2027-01", "2027-02"], currentYm: "2026-11", rateBp: 100, tenorDays: 90,
  owedNowSen: 154_251, drawnThisMonthSen: 0, dueBy: { "2026-12": 30_377, "2027-01": 123_874 }, limitSen: 300_000,
};

test("fillTfFromBills: each month's bills from the facility's suppliers, as far as the limit lets", () => {
  const filled = fc.fillTfFromBills({ ...tfSched, billsDue: { "2026-11": 122_926, "2026-12": 106_543, "2027-01": 11_650 } });
  assert.deepEqual(filled, { "2026-11": 122_926, "2026-12": 51_456, "2027-01": 11_650 });
  const withDrawn = fc.fillTfFromBills({ ...tfSched, drawnThisMonthSen: 20_000, owedNowSen: 174_251, billsDue: { "2026-11": 1_000 } });
  assert.equal(withDrawn["2026-11"], 21_000, "this month's cell is the month's whole use, what is drawn already included");
});

test("tfPlanSchedule: interest, repayments, owed and room left a month", () => {
  const rows = fc.tfPlanSchedule({ ...tfSched, plan: { "2026-11": 122_926, "2026-12": 51_456, "2027-01": 11_650 } });
  assert.deepEqual(rows.map((r) => [r.ym, r.interestSen, r.repaySen, r.owedSen, r.roomSen]), [
    ["2026-11", 1_229, 0, 278_406, 21_594],
    ["2026-12", 515, 30_377, 300_000, 0],
    ["2027-01", 117, 123_874, 187_893, 112_107],
    ["2027-02", 0, 124_155, 63_738, 236_262],
  ]);
  const over = fc.tfPlanSchedule({ ...tfSched, plan: { "2026-11": 200_000 } });
  assert.ok(over[0].roomSen < 0, "over the limit shows as negative room, still a plan");
  assert.equal(fc.tfPlanSchedule({ ...tfSched, limitSen: null, plan: {} })[0].roomSen, null);
});

test("buildForecastLegs and buildPnlForecastLegs carry the plans and reach their repayment months", () => {
  const docs = fc.buildForecastLegs(base({ tfPlans: [tfPlan], tfDrawnThisMonth: { "310-0020": 60_000 }, tfInterestAccount: "900-I004" }));
  assert.ok(docs.columns.some((c) => c.ym === "2027-03" && c.future), "the Docs forecast reaches the last repayment");
  assert.ok(docs.legs.some((l) => l.col === "fc:2026-11" && l.label === fc.TF_PLAN_LABEL));
  const pnl = fc.buildPnlForecastLegs(pBase({ tfPlans: [tfPlan], tfDrawnThisMonth: { "310-0020": 60_000 }, tfInterestAccount: "900-I004" }));
  assert.ok(pnl.columns.some((c) => c.ym === "2027-03"));
  assert.equal(pnl.legs.filter((l) => l.col === "fp:2027-02").reduce((s, l) => s + l.sen, 0), -101_000);
});

test("buildForecastLegs names the parties whose term was guessed", () => {
  const r = fc.buildForecastLegs(base({ live: [{ ...inv("DEC", 80_000, "2026-12"), partyName: "Z1", termFlagged: true }] }));
  assert.deepEqual(r.termFlagged, ["Z1"]);
});
