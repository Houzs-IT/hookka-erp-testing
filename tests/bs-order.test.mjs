// ---------------------------------------------------------------------------
// bs-order.test.mjs — the Balance Sheet lists its accounts in account-code
// order within every section (owner 2026-10-13 「排序按科目编号，做」); before,
// they came in the order the ledger read first met them. Current Year Earnings
// stays the last line of Equity.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("/pl sorts the sheet's account lines by code, then adds Current Year Earnings", () => {
  const sheet = slice(api, "// --- Balance sheet from the ledger", "\n  return c.json({");
  const sortAt = sheet.indexOf("balanceSheet.sort((a, b) => a.accountCode.localeCompare(b.accountCode));");
  const npAt = sheet.indexOf('id: "NP-CURRENT",');
  assert.notEqual(sortAt, -1, "the sheet is sorted by account code");
  assert.notEqual(npAt, -1);
  assert.ok(sortAt < npAt, "Current Year Earnings is pushed after the sort, so it stays last in Equity");
  // Every line is in by then — the loop that builds them comes first.
  assert.ok(sheet.indexOf("for (const code of bsCodes) {") < sortAt);
});

test("the sort orders codes the way the chart reads them", () => {
  const rows = ["330-8000", "300-0000", "330-0001", "310-0010", "200-0030", "330-3001", "320-0000"].map((accountCode) => ({ accountCode }));
  rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  assert.deepEqual(rows.map((r) => r.accountCode), ["200-0030", "300-0000", "310-0010", "320-0000", "330-0001", "330-3001", "330-8000"]);
});
