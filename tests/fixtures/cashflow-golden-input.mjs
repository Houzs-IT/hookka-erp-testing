// A statement fixture that exercises every placement road of buildStatement:
// a customer receipt, a supplier payment split by material, a salary payment
// split by department, a trade-finance draw and its repayment, capex, a loan,
// and a bank-to-bank move. tests/cashflow-engine-forecast.test.mjs pins the
// engine's output on it (the toggle-off statement must never change).
const acct = (code, name, type, sat = null, parentCode = null) => ({ code, name, type, sat, parentCode });

export const coaList = [
  acct("310-0010", "BANK - HLB", "ASSET", "SBK"),
  acct("310-0030", "BANK - MBB", "ASSET", "SBK"),
  acct("320-0000", "CASH IN HAND", "ASSET", "SCH"),
  acct("300-0000", "TRADE DEBTORS", "ASSET", "SDC"),
  acct("400-0000", "TRADE CREDITORS", "LIABILITY", "SCC"),
  acct("410-0000", "ACCRUALS", "LIABILITY"),
  acct("410-0010", "ACCRUAL - SALARY", "LIABILITY", null, "410-0000"),
  acct("410-0020", "ACCRUAL - EPF", "LIABILITY", null, "410-0000"),
  acct("701-0000", "PURCHASE - FABRIC", "COST"),
  acct("704-0000", "PURCHASE - OTHER & PACKAGING", "COST"),
  acct("200-0040", "MACHINERY", "ASSET"),
  acct("310-0020", "TRADE FINANCE - LENDER", "LIABILITY"),
  acct("440-0030", "LOAN FROM RELATED PARTY", "LIABILITY"),
  acct("900-0010", "UPKEEP", "EXPENSE"),
];

const leg = (accountCode, debitSen, creditSen, ym, sourceType, sourceId, extra = {}) => ({ accountCode, debitSen, creditSen, ym, sourceType, sourceId, ...extra });
const bank = (accountCode, debitSen, creditSen, ym, entry) => ({ accountCode, debitSen, creditSen, ym, entry });

export const classified = [
  leg("300-0000", 0, 500_000, "2026-10", "payment", "R1"),
  leg("300-0000", 0, 300_000, "2026-11", "payment", "R2"),
  leg("400-0000", 200_000, 0, "2026-10", "supplier_payment", "HPV-1"),
  leg("410-0010", 90_000, 0, "2026-11", "payment_voucher", "PV-SAL"),
  leg("410-0020", 11_000, 0, "2026-11", "payment_voucher", "PV-EPF"),
  leg("200-0040", 50_000, 0, "2026-11", "payment_voucher", "PV-CAP"),
  leg("440-0030", 0, 70_000, "2026-09", "journal", "JV-LOAN"),
  leg("900-0010", 4_000, 0, "2026-11", "payment_voucher", "PV-UP"),
  // A supplier paid from the facility (no bank leg), grossed up: the PI splits
  // by material, the facility leg carries the other side.
  leg("400-0000", 80_000, 0, "2026-10", "supplier_payment", "HPV-TF"),
  leg("310-0020", 0, 80_000, "2026-10", "supplier_payment", "HPV-TF", { lineLabel: "Drawdown — SUP B" }),
  // Its repayment from the bank.
  leg("310-0020", 60_000, 0, "2026-11", "supplier_payment", "HPV-REPAY", { lineLabel: "Repaid to LENDER" }),
];

export const bankLegs = [
  bank("310-0010", 500_000, 0, "2026-10", "payment::R1"),
  bank("310-0010", 300_000, 0, "2026-11", "payment::R2"),
  bank("310-0010", 0, 200_000, "2026-10", "supplier_payment::HPV-1"),
  bank("310-0010", 0, 90_000, "2026-11", "payment_voucher::PV-SAL"),
  bank("310-0010", 0, 11_000, "2026-11", "payment_voucher::PV-EPF"),
  bank("310-0010", 0, 50_000, "2026-11", "payment_voucher::PV-CAP"),
  bank("310-0030", 70_000, 0, "2026-09", "journal::JV-LOAN"),
  bank("310-0010", 0, 4_000, "2026-11", "payment_voucher::PV-UP"),
  bank("310-0010", 0, 60_000, "2026-11", "supplier_payment::HPV-REPAY"),
  bank("310-0010", 0, 5_000, "2026-11", "fund_transfer::T1"),
  bank("320-0000", 5_000, 0, "2026-11", "fund_transfer::T1"),
  bank("310-0010", 1_000_000, 0, "2026-04", "opening::OB"),
];

export const rmSplit = {
  "HPV-1": [{ line: "FABRIC", weight: 3 }, { line: "Unallocated — SUP C", weight: 1 }],
  "HPV-TF": [{ line: "FABRIC", weight: 1 }],
};
export const deptSplit = { "PV-SAL": [{ line: "PROD-A", weight: 2 }, { line: "OFFICE", weight: 1 }] };

export const map = {
  "410-0010": { section: "DIRECT_LABOUR", order: 10 },
  "410-0000": { section: "DIRECT_LABOUR", order: 10 },
  "410-0020": { section: "GENERAL_EXPENSE", order: 10 },
  "310-0020": { section: "TRADE_FINANCE", order: 10 },
};

export function statementOpts(extra = {}) {
  return {
    classified,
    bankLegs,
    coa: new Map(coaList.map((a) => [a.code, a])),
    map,
    rmSplit,
    deptSplit,
    stockGroupOverride: { FABRIC: "Purchase of Fabric" },
    supplierCategory: { "SUP C": "Purchase of Other & Packaging" },
    fyeMonth: 8,
    fyStartYm: "2026-09",
    period: "2026-11",
    ...extra,
  };
}
