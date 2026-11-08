// BUG-2026-11-08-419 — the Finance Dashboard Cash Flow card's Investing and
// Financing tabs printed 0 every month (they read `subtotal` rows the
// statement never emits for those sections), Free cash flow ignored capex,
// and Money in / out counted a move between our own accounts twice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const card = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-card.ts")).href);

// The statement's real shape: Revenue Collection has a subtotal; every other
// section is a depth-1 group over its lines (with nested groups inside).
const rows = [
  { kind: "section", label: "REVENUE COLLECTION", section: "REVENUE_COLLECTION", values: [0, 0] },
  { kind: "subtotal", label: "REVENUE COLLECTION", section: "REVENUE_COLLECTION", values: [1000, 600] },
  { kind: "line", label: "Customers", section: "REVENUE_COLLECTION", values: [1000, 600] },
  { kind: "section", label: "COST / EXPENSE OUT", values: [0, 0] },
  { kind: "group", label: "Raw Materials", section: "RAW_MATERIALS", values: [-700, -400] },
  { kind: "group", label: "Purchase of fabric", section: "RAW_MATERIALS", values: [-700, -400] },
  { kind: "line", label: "Fabric", section: "RAW_MATERIALS", values: [-700, -400] },
  { kind: "result", label: "Net operation surplus / (deficit)", values: [300, 200] },
  { kind: "group", label: "Trade Finance", section: "TRADE_FINANCE", values: [150, 150] },
  { kind: "line", label: "Supplier (via TF)", section: "TRADE_FINANCE", values: [200, 150] },
  { kind: "line", label: "Repaid to lender", section: "TRADE_FINANCE", values: [-50, 0] },
  { kind: "group", label: "Finance Cost", section: "FINANCE_COST", values: [-10, -10] },
  { kind: "line", label: "Interest", section: "FINANCE_COST", values: [-10, -10] },
  { kind: "group", label: "Capital Expenditure (CAPEX)", section: "CAPEX", values: [-120, -120] },
  { kind: "group", label: "Machinery", section: "CAPEX", values: [-120, -120] },
  { kind: "line", label: "Machine", section: "CAPEX", values: [-120, -120] },
  { kind: "group", label: "Loan received / (repaid · lent)", section: "LOAN", values: [-30, 0] },
  { kind: "line", label: "Loan repaid", section: "LOAN", values: [-30, 0] },
  { kind: "group", label: "Unallocated", section: "UNALLOCATED", values: [-5, -5] },
  { kind: "line", label: "Unallocated", section: "UNALLOCATED", values: [-5, -5] },
  { kind: "total", label: "Cash Surplus / (Deficit)", values: [285, 215] },
];

test("investing and financing are read from the statement's lines, not a subtotal it never emits", () => {
  const m = card.cashFlowCardMonth(rows, 1);
  assert.equal(m.operating, 200);
  assert.equal(m.investing, -120, "capex, counted once though two groups sit above the line");
  assert.equal(m.financing, 150 - 10 + 0, "trade finance + finance cost + loan");
  assert.equal(m.net, 215);
});

test("financing includes trade finance, loan, deposit and finance cost (owner 2026-11-08)", () => {
  assert.equal(card.cashFlowCardMonth(rows, 0).financing, 200 - 50 - 10 - 30);
  for (const s of ["TRADE_FINANCE", "LOAN", "DEPOSIT", "FINANCE_COST"]) assert.ok(card.FINANCING_SECTIONS.has(s), s);
});

test("operating + investing + financing + unallocated = the cash surplus", () => {
  for (const i of [0, 1]) {
    const m = card.cashFlowCardMonth(rows, i);
    const unallocated = rows.filter((r) => r.kind === "line" && r.section === "UNALLOCATED").reduce((s, r) => s + r.values[i], 0);
    assert.equal(m.operating + m.investing + m.financing + unallocated, m.net, `column ${i}`);
  }
});

test("free cash flow is operating less capex", () => {
  assert.equal(card.freeCashFlow({ operating: 200, investing: -120 }), 80);
  assert.equal(card.freeCashFlow({ operating: -50, investing: 0 }), -50);
});

test("money in / out net each entry first: a move between our own accounts is neither", () => {
  const legs = [
    { entry: "payment::R1", ym: "2026-10", debitSen: 5000, creditSen: 0 },            // receipt
    { entry: "supplier_payment::P1", ym: "2026-10", debitSen: 0, creditSen: 3000 },   // payment
    { entry: "fund_transfer::T1", ym: "2026-10", debitSen: 400, creditSen: 0 },       // into petty cash
    { entry: "fund_transfer::T1", ym: "2026-10", debitSen: 0, creditSen: 400 },       // out of the bank
    { entry: "fund_transfer::T2", ym: "2026-10", debitSen: 1000, creditSen: 0 },      // bank B in
    { entry: "fund_transfer::T2", ym: "2026-10", debitSen: 0, creditSen: 1005 },      // bank A out, incl. a 5 charge
    { entry: "payment::R2", ym: "2026-11", debitSen: 700, creditSen: 0 },
  ];
  const m = card.bankInOutByMonth(legs);
  assert.deepEqual(m.get("2026-10"), { inflow: 5000, outflow: -3005 });
  assert.deepEqual(m.get("2026-11"), { inflow: 700, outflow: 0 });
  const raw = legs.filter((l) => l.ym === "2026-10").reduce((s, l) => s + l.debitSen - l.creditSen, 0);
  assert.equal(m.get("2026-10").inflow + m.get("2026-10").outflow, raw, "netting never changes the month's total");
});

test("a leg without an entry key is never merged with another", () => {
  const m = card.bankInOutByMonth([
    { ym: "2026-10", debitSen: 100, creditSen: 0 },
    { ym: "2026-10", debitSen: 0, creditSen: 100 },
  ]);
  assert.deepEqual(m.get("2026-10"), { inflow: 100, outflow: -100 });
});

test("source guard: the dashboard reads the card through cashflow-card, never a CAPEX subtotal", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/accounting.ts"), "utf8");
  assert.match(src, /cashFlowCardMonth\(rowsCf, i\)/);
  assert.match(src, /bankInOutByMonth\(bankLegs\)/);
  assert.match(src, /freeCashFlow: freeCashFlow\(cf\)/);
  assert.doesNotMatch(src, /kind === "subtotal" && r\.section === "CAPEX"/);
  assert.doesNotMatch(src, /freeCashFlow: cf\.operating/);
});
