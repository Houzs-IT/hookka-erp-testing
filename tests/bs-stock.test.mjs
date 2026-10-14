// ---------------------------------------------------------------------------
// bs-stock.test.mjs — the Balance Sheet's stock is the P&L's closing stock
// (owner 2026-10-13: 「balance sheet 就让他的 closing stock 和 P&L closing stock
// 一样不就行了吗」→「做」). Report layer: nothing is posted; the ledger's own
// stock balances give way and the difference is Current Year Earnings.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/bs-stock.ts")).href);

const MAP = {
  rmDefault: { stock: "330-3001" },
  rm: {
    "B.M-FABR": { stock: "330-0001" },
    "B.OTHERS": { stock: "330-3001" },
    OTHERS: { stock: "330-3001" },
    PACKING: { stock: "330-4000" },
  },
  wip: { stock: "330-8000" },
  fg: { stock: "330-9000" },
};

test("stock accounts: every home the stock map names, old codes resolved", () => {
  assert.deepEqual([...m.stockAccounts(MAP)].sort(), ["330-0001", "330-3001", "330-4000", "330-8000", "330-9000"]);
  const renamed = m.stockAccounts(MAP, (c) => (c === "330-4000" ? "330-4001" : c));
  assert.ok(renamed.has("330-4001") && !renamed.has("330-4000"));
});

test("closing stock by account: groups sharing a home add up, an unmapped group falls to the default, WIP / FG on their own", () => {
  const by = m.stockByAccount(MAP, {
    rows: [
      { group: "B.M-FABR", closingSen: 1796250 },
      { group: "B.OTHERS", closingSen: 10000 },
      { group: "OTHERS", closingSen: 5000 },
      { group: "NEW-GRP", closingSen: 700 },
    ],
    wipSen: 4055422,
    fgSen: 1962396,
  });
  assert.equal(by.get("330-0001"), 1796250);
  assert.equal(by.get("330-3001"), 15700);
  assert.equal(by.get("330-8000"), 4055422);
  assert.equal(by.get("330-9000"), 1962396);
});

test("which month a sheet carries: its own; the running month past it; none before the opening month", () => {
  assert.equal(m.sheetStockMonth("2026-09", "2026-05", "2026-10"), "2026-09");
  assert.equal(m.sheetStockMonth("2026-05", "2026-05", "2026-10"), "2026-05");
  assert.equal(m.sheetStockMonth("2026-04", "2026-05", "2026-10"), null);
  assert.equal(m.sheetStockMonth("2026-12", "2026-05", "2026-10"), "2026-10");
  assert.equal(m.sheetStockMonth(null, "2026-05", "2026-10"), "2026-10");
  assert.equal(m.sheetStockMonth("2026-09", null, "2026-10"), null);
});

test("the override: each stock account shows the closing stock; earnings move by closing stock − what the ledger held", () => {
  const accounts = m.stockAccounts(MAP);
  const by = new Map([["330-0001", 1796250], ["330-8000", 4055422]]);
  // Nothing in the ledger: earnings carry the whole stock.
  const none = m.stockOverride(accounts, by, () => 0);
  assert.equal(none.earningsSen, 1796250 + 4055422);
  assert.equal(none.balances.get("330-0001"), 1796250);
  assert.equal(none.balances.get("330-4000"), 0, "a home with no stock reads zero");
  // A ledger balance on a stock account (a bill booked straight to it) is replaced, not added.
  const ledger = new Map([["330-0001", 10789890]]);
  const some = m.stockOverride(accounts, by, (c) => ledger.get(c) ?? 0);
  assert.equal(some.balances.get("330-0001"), 1796250);
  assert.equal(some.earningsSen, 1796250 + 4055422 - 10789890);
  // A year-end entry that matches the count adds nothing.
  const matched = m.stockOverride(accounts, by, (c) => by.get(c) ?? 0);
  assert.equal(matched.earningsSen, 0);
});

test("the drill on a stock account: b/f last month-end, c/f this one, one line per group that moved", () => {
  const opening = { rows: [{ group: "B.OTHERS", closingSen: 10000 }, { group: "OTHERS", closingSen: 0 }], wipSen: 2232006, fgSen: 1796736 };
  const closing = { rows: [{ group: "B.OTHERS", closingSen: 10000 }, { group: "OTHERS", closingSen: 368870 }], wipSen: 4055422, fgSen: 1962396 };
  const d = m.stockDrill("330-3001", MAP, opening, closing);
  assert.equal(d.bfSen, 10000);
  assert.equal(d.cfSen, 378870);
  assert.deepEqual(d.lines, [{ label: "OTHERS", fromSen: 0, toSen: 368870 }], "B.OTHERS did not move");
  const wip = m.stockDrill("330-8000", MAP, opening, closing);
  assert.deepEqual(wip, { bfSen: 2232006, cfSen: 4055422, lines: [{ label: "WIP", fromSen: 2232006, toSen: 4055422 }] });
  // The opening month: nothing brought forward.
  const first = m.stockDrill("330-9000", MAP, null, closing);
  assert.deepEqual(first, { bfSen: 0, cfSen: 1962396, lines: [{ label: "FG", fromSen: 0, toSen: 1962396 }] });
});

test("drill rows: the ledger drill's shape, dated the month end, debit = stock up, credit = stock down", () => {
  const rows = m.stockDrillRows("2026-09", "2026-09-30", [
    { label: "B.M-FABR", fromSen: 1942080, toSen: 1796250 },
    { label: "WIP", fromSen: 2232006, toSen: 4055422 },
  ], (sen) => (sen / 100).toFixed(2));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: "stock:2026-09:B.M-FABR", date: "2026-09-30", description: "Stock take · B.M-FABR: 19420.80 → 17962.50",
    otherSide: [], ref1: "Stock Summary", ref2: null, docs: null, debitSen: 0, creditSen: 145830,
    sourceType: "stock_take", sourceId: "2026-09",
  });
  assert.equal(rows[1].debitSen, 1823416);
  assert.equal(rows[1].creditSen, 0);
});

const API = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");
const UI = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("the sheet's stock is the Stock Summary's closing for its month (the figure the P&L closes on)", () => {
  const fn = slice(API, "async function sheetStockAt(", "\nasync function computePnlWindow(");
  assert.match(fn, /const month = sheetStockMonth\(endYm, openingDate \? openingDate\.slice\(0, 7\) : null, runningMonthYm\(\)\);/);
  assert.match(fn, /stockSummaryRange\(db, orgId, month, month\)/);
  assert.match(fn, /wipSen: s\.wip\.closingSen,\n\s*fgSen: s\.fg\.closingSen,/);
  // Callers holding the material data read the same window + blank-month FG / WIP.
  const at = slice(API, "async function closingStockAt(", "\n}\n");
  assert.match(at, /const w = materialWindow\(matData, ym, ym\);/);
  assert.match(at, /const blank = await blankMonthStock\(db, orgId, ym, matData, dc, override\);/);
});

test("/pl: stock lines replace the ledger's, earnings carry the difference, the sheet says which month", () => {
  const sheet = slice(API, "// --- Balance sheet from the ledger", "\n  return c.json({");
  assert.match(sheet, /if \(!coFilter\.active \|\| coFilter\.orgId === getOrgId\(c\)\) \{/);
  assert.match(sheet, /sheetStock = await sheetStockAt\(\n\s*c\.var\.DB, getOrgId\(c\), endYm, resolveAcct,\n\s*\(code\) => \(bsDr\.get\(code\) \?\? 0\) - \(bsCr\.get\(code\) \?\? 0\),\n\s*\(code\) => \{ const a = coa\.get\(code\); return !!a && bsSectionFor\(code, a\.type, bsOverride\) !== null; \},/);
  // Only accounts the sheet can place take part, so it always balances.
  assert.match(API, /const accounts = new Set\(\[\.\.\.stockAccounts\(map, resolve\)\]\.filter\(placeable\)\);/);
  assert.match(sheet, /const shown = stockSen === undefined \? bal : bsSectionClass\(section\) === "asset" \? stockSen : -stockSen;/);
  assert.match(sheet, /unclosedEarnings \+= sheetStock\?\.earningsSen \?\? 0;/);
  // …and on which accounts, so the page can fold them under Inventories (2026-10-14).
  assert.match(API, /sheetStock: sheetStock \? \{ month: sheetStock\.month, totalSen: sheetStock\.totalSen, accounts: \[\.\.\.sheetStock\.balances\.keys\(\)\] \} : null,\n\s*sheetStockError,/);
});

test("the dashboard and the finance series use the same rule", () => {
  const series = slice(API, "export async function loadFinanceSeries(", "\n}\n");
  assert.match(series, /const stockYm = sheetStockMonth\(ym, openingMonth, runningMonthYm\(\)\);/);
  assert.match(series, /const \{ earningsSen \} = stockOverride\(stockAccts, stockByAccount\(stockMap, closing, resolveAcct\), net\);\n\s*assets \+= earningsSen;\n\s*unclosed \+= earningsSen;/);
  const dash = slice(API, 'app.get("/dashboard"', "// --- Cash flow: THE Cash Flow report's own engine");
  assert.match(dash, /const stockYm = sheetStockMonth\(b\.months\[b\.months\.length - 1\], openingYmDash, runningMonthYm\(\)\);/);
  assert.match(dash, /for \(const \[code, v\] of balances\) nets\.set\(code, v\);/);
  assert.match(dash, /for \(const \[code, net\] of nets\) \{/);
  assert.match(API, /const DASH_PAYLOAD_V = "v(1[8-9]|[2-9]\d)";/);
});

test("the drill on a stock line is the Stock Summary's movement, b/f + lines = c/f", () => {
  const ep = slice(API, 'app.get("/bs-drill"', 'app.get("/pl-monthly"');
  assert.match(ep, /if \(stockAccounts\(stockMap, resolve\)\.has\(account\)\) \{/);
  assert.match(ep, /const d = stockDrill\(account, stockMap, opening, closing, resolve\);/);
  assert.match(ep, /fromStockTake: true,/);
  const panel = slice(UI, "function BsDrillPanel(", "\nfunction ");
  assert.match(panel, /\{data\.fromStockTake && <div/);
});

test("the Stock Summary no longer posts closing stock; the sheet says where its stock comes from", () => {
  const tab = slice(UI, "function StockSummaryTab(", "\nfunction ");
  assert.doesNotMatch(tab, /: "Post closing stock to GL"\}/, "the button label is gone");
  assert.doesNotMatch(tab, /handlePost/);
  assert.doesNotMatch(tab, /\/api\/accounting\/stock\/close-post/);
  const bs = slice(UI, "function BalanceSheetTab(", "\nfunction ");
  assert.match(bs, /Stock lines show the P&amp;L&apos;s closing stock for \{drillMonthLabel\(bsStock\.month\)\}/);
});
