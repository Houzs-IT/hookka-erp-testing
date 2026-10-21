// ---------------------------------------------------------------------------
// Daily Cash Position's TO REPAY lists Trade Finance by due date (owner
// 2026-10-17, Finance v2 「要」). Every draw still owed — the same draws
// Creditor Aging's Trade Finance section lists — with its due date; the
// default scope is "due by the end of the viewed month" (overdue included),
// and "Cash after repay & receive" takes it off on the desktop, the share
// image and the phone alike. Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { cashAfterRepayReceive, tfDueByMonthEnd } from "../src/lib/cash-position-image.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("the default scope: due by the end of the viewed month, overdue included; no due date counts", () => {
  assert.equal(tfDueByMonthEnd({ dueDate: "2026-09-30", outstandingSen: 1 }, "2026-10"), true, "overdue");
  assert.equal(tfDueByMonthEnd({ dueDate: "2026-10-31", outstandingSen: 1 }, "2026-10"), true, "due this month");
  assert.equal(tfDueByMonthEnd({ dueDate: "2026-11-01", outstandingSen: 1 }, "2026-10"), false, "next month");
  assert.equal(tfDueByMonthEnd({ dueDate: "", outstandingSen: 1 }, "2026-10"), true, "money owed is never hidden");
});

test("cash after repay & receive takes off the trade finance due", () => {
  const t = cashAfterRepayReceive(
    {
      totalAvailableSen: 100000,
      repay: [{ month: "2026-09", outstandingSen: 30000 }],
      receive: [{ month: "2026-09", totalSen: 20000 }],
      tradeFinance: [
        { dueDate: "2026-10-30", outstandingSen: 15000 },
        { dueDate: "2026-11-05", outstandingSen: 40000 }, // not this month
      ],
    },
    "2026-10",
  );
  assert.deepEqual(t, { repayShownSen: 30000, recvShownSen: 20000, tfShownSen: 15000, netAfterSen: 75000 });
});

test("the API lists each draw still owed, by due date, with the supplier it paid", () => {
  const api = read("src/api/routes/accounting.ts");
  const at = api.indexOf('app.get("/cash-position"');
  const block = api.slice(at, api.indexOf("\napp.", at + 10));
  assert.match(block, /for \(const s of await getTfSources\(c\.var\.DB\)\) \{\n\s*const derived = await loadTfDraws\(c\.var\.DB, s\);/);
  // Since 2026-10-19 the draws' suppliers come from one IN query
  // (tests/step-timing.test.mjs); the rows are the same.
  assert.match(block, /for \(const d of derived\.draws\) if \(d\.outstandingSen > 0\) open\.push\(\{ lender: s\.lenderName, d \}\);/);
  assert.match(block, /tradeFinance\.push\(\{ dueDate: d\.dueDate, drawDate: d\.drawDate, lender, ref: d\.drawSourceId, paidFor: \[\.\.\.\(paidFor\.get\(d\.drawSourceId\) \?\? \[\]\)\]\.join\(", "\), outstandingSen: d\.outstandingSen \}\);/);
  assert.match(block, /tradeFinance\.sort\(\(x, y\) => \(x\.dueDate \|\| "9999-12-31"\)\.localeCompare\(y\.dueDate \|\| "9999-12-31"\)/);
  assert.match(block, /awaitingApproval, awaitingCheckedSen, fxBankPending, tradeFinance \},/);
});

test("the desktop lists it under TO REPAY and takes it off the bottom line; image and phone say so", () => {
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /function CashPosTfPanel\(/);
  assert.match(ui, /TO REPAY — Trade finance \(by due date\)/);
  assert.match(ui, /const tfRows = \(cur\?\.tradeFinance \?\? \[\]\)\.filter\(\(t\) => tfAll \|\| tfDueByMonthEnd\(t, curMonth\)\);/);
  assert.match(ui, /<CashPosTfPanel rows=\{tfRows\} date=\{date\} scope=\{!tfAll\} onScope=\{\(\) => setTfAll\(!tfAll\)\} \/>/);
  assert.match(ui, /\{tfShownSen \? ` − trade finance \$\{formatCurrency\(tfShownSen\)\}` : ""\}/);
  assert.doesNotMatch(ui, /TF \/ loans are not included here/);
  assert.match(read("src/lib/cash-position-image.ts"), /\$\{tfShownSen \? ` − trade finance \$\{rm\(tfShownSen\)\}` : ""\}/);
  assert.match(read("src/pages/m/screens/finance/CashScreen.tsx"), /\{totals\.tfShownSen \? ` − trade finance \$\{fmtMoney\(totals\.tfShownSen\)\}` : ""\}/);
});
