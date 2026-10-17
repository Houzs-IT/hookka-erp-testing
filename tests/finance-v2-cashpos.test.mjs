// ---------------------------------------------------------------------------
// finance-v2-cashpos.test.mjs — Daily Cash Position in the v2 look (plan
// 2026-10-16-finance-v2-daily-b Task 2). Banks stay open (owner 「继续做」 on
// the recommendation); ticking is unchanged. Pending lines list receipts
// first, then payments — the same order on screen, in Get image and in Print.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { financePage } from "../src/lib/finance-nav.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const tab = ui.slice(ui.indexOf("function DailyCashTab("), ui.indexOf("\nfunction ", ui.indexOf("function DailyCashTab(") + 10));

test("the buttons sit on the title row; the grey line moved behind the (i); the date shows its weekday", () => {
  const at = tab.indexOf("<FinanceTitleActions>");
  assert.ok(at >= 0);
  const row = tab.slice(at, tab.indexOf("</FinanceTitleActions>", at));
  for (const t of ['{showPlanned ? "Hide planned" : "Show planned"}', ">Get image<", ">Print<"]) assert.ok(row.includes(t), t);
  assert.doesNotMatch(tab, /Tick a row when your banking app shows it went through — the estimate turns daily-accurate/);
  assert.match(financePage("dailycash").explain, /Statements still referee at month end\./);
  assert.match(tab, /\{weekdayOf\(date\)\}\{date === today \? " · today" : ""\}/);
});

test("bank cards: a slate header, the pending table in the v2 list look, fold and empty rows do not lift", () => {
  assert.doesNotMatch(tab, /bg-\[#1F2937\] rounded-t-lg/, "the dark header is gone");
  assert.match(tab, /bg-\[#E2E8F0\][^"]*border-b-\[1\.5px\] border-\[#7A6E5E\]/, "slate header with the strong line");
  assert.match(tab, /<table data-fin-list className="w-full text-sm">/);
  assert.match(tab, /<tr data-fin-nolift><td colSpan=\{6\}[^>]*>Nothing pending/);
  assert.match(tab, /<tr data-fin-nolift className="bg-\[#FAF8F5\]">/, "the ticked fold row");
});

test("one order for screen, image and print: receipts first, then payments", () => {
  assert.match(tab, /const open = pendingReceiptsFirst\(a\.pending\.filter\(\(p\) => !p\.ticked\)\);/);
  assert.match(tab, /const ticked = pendingReceiptsFirst\(a\.pending\.filter\(\(p\) => p\.ticked\)\);/);
  // Get image draws through the shared module since finance v2 mobile (the
  // phone shares the same picture).
  assert.match(tab, /drawCashPositionImage\(cur, \{ netAfterSen, repayShownSen, recvShownSen, tfShownSen \}\)/);
  assert.match(read("src/lib/cash-position-image.ts"), /rows: pendingReceiptsFirst\(a\.pending\.filter\(\(p\) => !p\.ticked\)\)/, "Get image");
  assert.match(tab, /\$\{pendingReceiptsFirst\(a\.pending\.filter\(\(p\) => !p\.ticked\)\)\s*\n?\s*\.map\(/, "Print");
});
