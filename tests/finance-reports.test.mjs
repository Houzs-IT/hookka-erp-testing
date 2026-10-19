// ---------------------------------------------------------------------------
// finance-reports.test.mjs — pure helpers behind the v2 report shell (plan
// 2026-10-16-finance-v2-reports Task 1): the period stepper (labels, steps,
// "· so far"), the as-at date, the link into the General Ledger, Trial Balance
// sections by the Chart of Accounts rules, the GL "By Code Range" tick, and
// ledger balances with credit in brackets. Made-up figures only (public repo).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  periodKind,
  stepPeriod,
  periodLabel,
  monthEnd,
  asAtDate,
  monthOptions,
  glLink,
  TB_SECTIONS,
  tbSectionOf,
  tbSections,
  codesInRange,
  fmtLedgerBal,
} from "../src/lib/finance-reports.ts";

test("period keys: month, calendar quarter, calendar year (what /pl-statement reads)", () => {
  assert.equal(periodKind("2026-10"), "month");
  assert.equal(periodKind("2026-Q4"), "quarter");
  assert.equal(periodKind("2026"), "year");
  assert.equal(periodKind("2026-13"), null);
  assert.equal(periodKind("2026-Q5"), null);
  assert.equal(periodKind(""), null);
});

test("the stepper steps within the same kind and across year ends", () => {
  assert.equal(stepPeriod("2026-10", 1), "2026-11");
  assert.equal(stepPeriod("2026-12", 1), "2027-01");
  assert.equal(stepPeriod("2026-01", -1), "2025-12");
  assert.equal(stepPeriod("2026-Q4", 1), "2027-Q1");
  assert.equal(stepPeriod("2026-Q1", -1), "2025-Q4");
  assert.equal(stepPeriod("2026", -1), "2025");
});

test("labels: Oct 2026, Q4 2026, Full Year 2026; the running period reads · so far", () => {
  const today = "2026-10-15";
  assert.equal(periodLabel("2026-10", today), "Oct 2026 · so far");
  assert.equal(periodLabel("2026-09", today), "Sep 2026");
  assert.equal(periodLabel("2026-Q4", today), "Q4 2026 · so far");
  assert.equal(periodLabel("2026-Q3", today), "Q3 2026");
  assert.equal(periodLabel("2026", today), "Full Year 2026 · so far");
  assert.equal(periodLabel("2025", today), "Full Year 2025");
});

test("as-at date: a closed month is its last day; the running month is today", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.equal(monthEnd("2026-12"), "2026-12-31");
  assert.equal(asAtDate("2026-09", "2026-10-15"), "2026-09-30");
  assert.equal(asAtDate("2026-10", "2026-10-15"), "2026-10-15");
  assert.equal(asAtDate("2026-11", "2026-10-15"), "2026-10-15", "a future month never reads past today");
});

test("month options: newest first, a fixed count back from the last month", () => {
  assert.deepEqual(monthOptions("2026-02", 4), ["2026-02", "2026-01", "2025-12", "2025-11"]);
});

test("the GL link is the one the Monthly P&L drill already uses", () => {
  assert.equal(
    glLink({ account: "310-0010", fromYm: "2026-10", toDate: "2026-10-15" }),
    "/accounting?tab=gl&account=310-0010&from=2026-10-01&to=2026-10-15",
  );
  assert.equal(
    glLink({ account: "900-A001 X", fromYm: "2026-05", toDate: "2026-05-31" }),
    "/accounting?tab=gl&account=900-A001%20X&from=2026-05-01&to=2026-05-31",
  );
});

test("Trial Balance sections follow the Chart of Accounts rules", () => {
  assert.deepEqual(
    TB_SECTIONS.map((s) => s.key),
    ["NCA", "CA", "CL", "NCL", "EQ", "REV", "COGS", "OI", "EXP", "OTHER"],
  );
  assert.equal(tbSectionOf("200-1001", "ASSET"), "NCA");
  assert.equal(tbSectionOf("299-9999", "ASSET"), "NCA");
  assert.equal(tbSectionOf("300-0000", "ASSET"), "CA");
  assert.equal(tbSectionOf("400-0000", "LIABILITY"), "CL");
  assert.equal(tbSectionOf("480-0050", "LIABILITY"), "NCL");
  assert.equal(tbSectionOf("489-9999", "LIABILITY"), "NCL");
  assert.equal(tbSectionOf("490-0000", "LIABILITY"), "CL");
  assert.equal(tbSectionOf("100-0000", "EQUITY"), "EQ");
  assert.equal(tbSectionOf("500-0040", "REVENUE"), "REV");
  assert.equal(tbSectionOf("530-0010", "REVENUE"), "OI");
  assert.equal(tbSectionOf("701-0040", "COST"), "COGS");
  assert.equal(tbSectionOf("900-A001", "EXPENSE"), "EXP");
  assert.equal(tbSectionOf("999-0000", "?"), "OTHER", "an account missing from the chart is not dropped");
});

test("tbSections: every row lands in exactly one section, totals add back to the whole", () => {
  const rows = [
    { accountCode: "530-0010", type: "REVENUE", debitSen: 0, creditSen: 700 },
    { accountCode: "200-1001", type: "ASSET", debitSen: 50000, creditSen: 0 },
    { accountCode: "200-1005", type: "ASSET", debitSen: 0, creditSen: 12000 },
    { accountCode: "310-0010", type: "ASSET", debitSen: 9000, creditSen: 0 },
    { accountCode: "500-0040", type: "REVENUE", debitSen: 0, creditSen: 46300 },
    { accountCode: "999-0000", type: "?", debitSen: 0, creditSen: 0 },
  ];
  const secs = tbSections(rows);
  assert.deepEqual(secs.map((s) => s.key), ["NCA", "CA", "REV", "OI", "OTHER"], "empty sections are left out, order kept");
  assert.deepEqual(secs[0].rows.map((r) => r.accountCode), ["200-1001", "200-1005"]);
  assert.equal(secs[0].debitSen, 50000);
  assert.equal(secs[0].creditSen, 12000);
  assert.equal(secs[0].label, "Non-Current Assets");
  const n = secs.reduce((t, s) => t + s.rows.length, 0);
  assert.equal(n, rows.length);
  const dr = secs.reduce((t, s) => t + s.debitSen, 0);
  const cr = secs.reduce((t, s) => t + s.creditSen, 0);
  assert.equal(dr, 59000);
  assert.equal(cr, 59000);
});

test("By Code Range: prefix ends, blank ends open, swapped ends still tick", () => {
  const codes = ["100-0000", "300-0000", "305-0000", "310-0010", "310-0020", "400-0000", "900-A001"];
  assert.deepEqual(codesInRange(codes, "300", "310"), ["300-0000", "305-0000", "310-0010", "310-0020"]);
  assert.deepEqual(codesInRange(codes, "310", "300"), ["300-0000", "305-0000", "310-0010", "310-0020"], "swapped");
  assert.deepEqual(codesInRange(codes, "", "300"), ["100-0000", "300-0000"], "blank from = from the first code");
  assert.deepEqual(codesInRange(codes, "400", ""), ["400-0000", "900-A001"], "blank to = to the last code");
  assert.deepEqual(codesInRange(codes, " 310-0020 ", "310-0020"), ["310-0020"], "a full code, spaces trimmed");
  assert.deepEqual(codesInRange(codes, "", ""), codes, "both blank = every code");
});

test("ledger balances: debit plain, credit in brackets, zero plain", () => {
  assert.match(fmtLedgerBal(100000), /^RM\s1,000\.00$/);
  assert.match(fmtLedgerBal(-100000), /^\(RM\s1,000\.00\)$/);
  assert.match(fmtLedgerBal(0), /^RM\s0\.00$/);
});

test("report amounts read without RM, negatives in brackets; the check strip's verdict", async () => {
  const { fmtAmt, checkLabel } = await import("../src/lib/finance-reports.ts");
  assert.equal(fmtAmt(413610971), "4,136,109.71");
  assert.equal(fmtAmt(-50000), "(500.00)");
  assert.equal(fmtAmt(0), "0.00");
  assert.equal(checkLabel(0), "Balanced ✓");
  assert.equal(checkLabel(-100), "Out of balance · difference 1.00");
  assert.equal(checkLabel(123456), "Out of balance · difference 1,234.56");
});

test("period months and the statements' % of sales", async () => {
  const { periodMonths, fmtPctOfSales } = await import("../src/lib/finance-reports.ts");
  assert.deepEqual(periodMonths("2026-10"), ["2026-10", "2026-10"]);
  assert.deepEqual(periodMonths("2026-Q4"), ["2026-10", "2026-12"]);
  assert.deepEqual(periodMonths("2026-Q1"), ["2026-01", "2026-03"]);
  assert.deepEqual(periodMonths("2026"), ["2026-01", "2026-12"]);
  assert.equal(periodMonths("x"), null);
  assert.equal(fmtPctOfSales(12300, 100000), "12.3%");
  assert.equal(fmtPctOfSales(-4000, 100000), "(4.0%)");
  assert.equal(fmtPctOfSales(0, 100000), "-");
  assert.equal(fmtPctOfSales(undefined, 100000), "");
  assert.equal(fmtPctOfSales(500, 0), "", "no net sales, no share");
});
