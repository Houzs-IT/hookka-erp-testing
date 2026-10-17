// ---------------------------------------------------------------------------
// Creditor Aging in the Finance v2 shape (owner 2026-10-17 「这些都做」):
// Trade Finance (one row per open draw, by due date), Trade Suppliers and
// Other Creditors as sections, and a Next Due column — amber within 7 days,
// red when overdue — plus an Overdue card. The Trade Finance block stays below
// (owner 2026-10-16). Made-up dates and figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, dueText, dueTone, monthBucket, nextDueOf, overdueSen } from "../src/lib/aging-next-due.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("Next Due: the earliest due date among what is still owed", () => {
  const docs = [
    { due: "2026-11-30", amountSen: 1000 },
    { due: "2026-10-31", amountSen: 500 },
    { due: "2026-09-30", amountSen: -200 },   // an advance: not owed
    { due: "", amountSen: 300 },               // no due date on file
    { amountSen: 100 },
  ];
  assert.equal(nextDueOf(docs), "2026-10-31");
  assert.equal(nextDueOf([{ due: "", amountSen: 1 }]), "");
});

test("tone and wording: red when overdue, amber within 7 days", () => {
  assert.equal(daysUntil("2026-10-24", "2026-10-17"), 7);
  assert.equal(daysUntil("2026-10-16", "2026-10-17"), -1);
  assert.equal(daysUntil("2026-11-01", "2026-10-31"), 1, "across a month end");
  assert.equal(dueTone(-1), "overdue");
  assert.equal(dueTone(0), "soon");
  assert.equal(dueTone(7), "soon");
  assert.equal(dueTone(8), "later");
  assert.equal(dueText(-1), "1 day overdue");
  assert.equal(dueText(-12), "12 days overdue");
  assert.equal(dueText(0), "due today");
  assert.equal(dueText(1), "in 1 day");
  assert.equal(dueText(57), "in 57 days");
});

test("Overdue: what is owed past its due date; a draw ages by its draw date", () => {
  assert.equal(overdueSen([
    { due: "2026-10-01", amountSen: 4000 },
    { due: "2026-10-17", amountSen: 900 },  // due today: not yet overdue
    { due: "2026-09-01", amountSen: -500 }, // an advance
    { due: "", amountSen: 700 },
  ], "2026-10-17"), 4000);
  assert.equal(monthBucket("2026-10-02", "2026-10-17"), 0);
  assert.equal(monthBucket("2026-09-30", "2026-10-01"), 1, "calendar months, as the invoices age");
  assert.equal(monthBucket("2025-12-01", "2026-10-17"), 4);
  assert.equal(monthBucket("", "2026-10-17"), 0);
});

test("/aging documents carry the purchase invoice's due date; the cached shape is versioned", () => {
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /type AgingDocRow = \{ no: string; date: string; mo: number; amountSen: number; due\?: string \};/);
  assert.match(api, /amountSen: outstanding,\n\s*due: String\(p\.dueDate \?\? ""\)\.slice\(0, 10\),/);
  assert.match(api, /const cacheKey = coFilter\.active \? `company:\$\{coFilter\.orgId\}\|due` : "\|due";/);
});

test("Creditor Aging: three sections in the design's order, Trade Finance by due date, the Next Due cell, the cards", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const a = ui.indexOf("function APTab(");
  const ap = ui.slice(a, ui.indexOf("\n}\n", a));
  assert.match(ap, /fetch\("\/api\/accounting\/other-party-aging\?type=CREDITOR"\)/);
  assert.match(ap, /fetch\("\/api\/accounting\/trade-finance", \{ cache: "no-store" \}\)/);
  assert.match(ap, /\{ key: "tf", label: "Trade finance", rows: tfList \},\n\s*\{ key: "trade", label: "Trade suppliers", rows: supplierList \},\n\s*\{ key: "other", label: "Other creditors", rows: otherList \},/);
  assert.match(ap, /src\.draws\.filter\(\(d\) => d\.outstandingSen > 0\)/, "one row per OPEN draw");
  assert.match(ap, /\.sort\(\(a, b\) => \(a\.nextDue \?\? ""\)\.localeCompare\(b\.nextDue \?\? ""\)\);/, "by due date");
  assert.match(ap, /const tone = dueTone\(days\);/);
  assert.match(ap, /tone === "overdue" \? "text-\[#9A3A2D\]" : tone === "soon" \? "text-\[#7A5B12\]" : "text-\[#1F1D1B\]"/);
  assert.match(ap, /label: "Other creditors · 405-0000",/);
  assert.match(ap, /controlDriftNote\(ocControl\.balanceSen - ocTotal\)/);
  assert.match(ap, /\{ label: "Overdue", value: formatCurrency\(overdue\), tone: "err" as const, note: "past the due date" \},/);
  assert.match(ap, /\{ key: "tf", label: "Trade Finance", count: tfList\.length \},/);
  // The block where draws are managed stays below the list (owner 2026-10-16).
  assert.ok(ap.indexOf("<AgingListTable") < ap.indexOf("<TradeFinanceBlock />"));
});

test("the phone's Creditor Aging lists other creditors and the open draws with their next due", () => {
  const m = read("src/pages/m/screens/finance/AgingScreen.tsx");
  assert.match(m, /useCachedJson<TfResp>\(side === "creditor" \? "\/api\/accounting\/trade-finance" : null\)/);
  assert.match(m, /src\.draws\.filter\(\(d\) => d\.outstandingSen > 0\)/);
  assert.match(m, /data-m-fin="next-due"/);
  assert.match(m, /nextDue: side === "creditor" \? nextDueOf\(r\.docs \?\? \[\]\) : undefined,/);
});
