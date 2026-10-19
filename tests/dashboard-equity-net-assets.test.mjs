// ---------------------------------------------------------------------------
// dashboard-equity-net-assets.test.mjs — BUG-2026-10-19-344. The Financial
// Dashboard's equity added up only the EQUITY-section accounts; the un-closed
// current-year earnings (in the P&L accounts until a year close) were left
// out, so on books whose equity is all this year's earnings it read 0 every
// month and ROE never showed. Equity is now net assets — what the Balance
// Sheet tab's equity side adds up to.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const api = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");
const dash = api.slice(api.indexOf('app.get("/dashboard"'), api.indexOf('app.get("/forecast"'));

test("the dashboard's equity is net assets, the un-closed earnings included", () => {
  assert.match(dash, /\n\s+equity = assets - liabilities;\n\s+bsByBucket\.set\(b\.key, \{ assets, liabilities, equity, currentAssets: curA, currentLiabilities: curL, inventory: inv \}\);/);
  // Equity accounts still never count as liabilities (the section split stays).
  assert.match(dash, /\} else if \(sec === "EQUITY"\) \{\n\s+equity \+= -net;\n\s+\} else \{\n\s+liabilities \+= -net;/);
});

test("ROE divides by it; the stored copies of the old payload are retired", () => {
  assert.match(dash, /roePct: bs && bs\.equity > 0 && actual \? pct\(actual\.net, bs\.equity\) : null,/);
  assert.match(dash, /const DASH_PAYLOAD_V = "v(2\d|[3-9]\d)";/, "v20 or later");
});

test("the arithmetic: equity accounts plus un-closed earnings = assets − liabilities when the books balance", () => {
  // Made-up month-end: assets 1,000; liabilities 700; equity accounts 100;
  // un-closed earnings 200 — the sheet balances, and net assets = 300.
  const assets = 100000, liabilities = 70000, equityAccounts = 10000, unclosed = 20000;
  assert.equal(assets, liabilities + equityAccounts + unclosed);
  assert.equal(assets - liabilities, equityAccounts + unclosed);
});
