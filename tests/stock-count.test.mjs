// Warehouse › Stock Take (owner 2026-11-11, WORK-TRACKER 133): a quantity-only
// count — a blank count sheet per stock-take type grouped by item-code series,
// the filled sheet read back, and the month's usage per item
// (opening count + purchased − closing count). Pure helpers in
// src/lib/stock-count.ts; wiring by source pattern (house style).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COUNT_SHEET_HEADER,
  FINANCE_COUNT_HEADER,
  buildCountSheets,
  buildUsage,
  countFromFinanceLines,
  countFromWarehouseLines,
  countSheetAoa,
  financeCountAoa,
  normalizeCountLines,
  parseCountWorkbook,
  parseUomFactor,
  prevYm,
  seriesOf,
  unitKey,
  usageExportAoa,
} from "../src/lib/stock-count.ts";
import { isRmCountShape, parseRmCountRows } from "../src/lib/stock-take-import.ts";
import { safeSheetName } from "../src/lib/export-report.ts";

// Line endings normalised, so the patterns hold on a Windows (CRLF) checkout too.
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const item = (code, group, uom = "MTR", extra = {}) => ({ id: "rm-" + code, code, description: code + " desc", uom, group, active: true, ...extra });

// ── Series ────────────────────────────────────────────────────────────────
test("seriesOf: the family before the last short variant, else the code", () => {
  const cases = {
    "PC151-01": "PC151",
    "PC151-14": "PC151",
    "  pc151-01 ": "PC151",
    "KN390-13": "KN390",
    "KS-02": "KS",
    "AH-1": "AH",
    "STAR 01": "STAR",
    "NINJA 08": "NINJA",
    "M2402-17": "M2402",
    "FG66151-02": "FG66151",
    "BO315-21": "BO315",
    'NLY-D35-2.5"': "NLY-D35",
    'NLY-D35-3"': "NLY-D35",
    'NHL-NC36/60-3"': "NHL-NC36/60",
    'NLY-22GH - 1″': "NLY-22GH",
    'NLY-22GH -0.5"': "NLY-22GH",
    "SL 102": "SL",
    "SLA 120E": "SLA",
    "OPN-A (12KG X 10 ROLL)": "OPN",
    "OPN-A ( 8KG X 5 ROLL)": "OPN",
    "FABR (W) A": "FABR(W)",
    "FABR(W) B": "FABR(W)",
    "POLY 20MM(B)": "POLY",
    "ZS51": "ZS",
    "ZS3.8": "ZS",
    "WB350A": "WB",
    // No short variant at the end: the code is its own family.
    "NON WOVEN BLACK": "NON WOVEN BLACK",
    "M6X9 T NUT": "M6X9 T NUT",
    "15MM 4' X 8'": "15MM 4' X 8'",
    "M4X30MM": "M4X30MM",
    "R.MERANTI F/J": "R.MERANTI F/J",
  };
  for (const [code, want] of Object.entries(cases)) assert.equal(seriesOf(code), want, code);
});

test("unitKey: metre spellings are one unit, the rest upper-cased", () => {
  for (const u of ["MTR", "mtr", "METER", "Metre", "M", " m "]) assert.equal(unitKey(u), "M", u);
  assert.equal(unitKey("pcs"), "PCS");
  assert.equal(unitKey("ROLL"), "ROLL");
  assert.equal(unitKey(""), "");
});

test("prevYm steps back a month, across the year", () => {
  assert.equal(prevYm("2026-11"), "2026-10");
  assert.equal(prevYm("2026-01"), "2025-12");
});

// ── Count sheet ───────────────────────────────────────────────────────────
const MASTER = [
  item("PC151-10", "B.M-FABR"),
  item("PC151-2", "B.M-FABR"),
  item("PC151-01", "B.M-FABR"),
  item("KS-02", "B.M-FABR"),
  item("KS-01", "B.M-FABR"),
  item("NV-1WP", "B.M-FABR"),
  item("FABR(W) B", "B.M-FABR", "YARD"),
  item("OLD-1", "B.M-FABR", "MTR", { active: false }),
  item('NLY-D35-3"', "S.FILLER", "PCS"),
  item('NLY-D35-2.5"', "S.FILLER", "PCS"),
  item("GBEX 90/40", "EQUIPMEN", "UNIT"),
];

test("buildCountSheets: one sheet per chosen type, active items, series sections, singles last", () => {
  const sheets = buildCountSheets(MASTER, ["B.M-FABR", "S.FILLER"]);
  assert.deepEqual(sheets.map((s) => s.group), ["B.M-FABR", "S.FILLER"]);
  const bm = sheets[0];
  assert.equal(bm.itemCount, 7, "the inactive item is left out");
  const shape = bm.rows.map((r) => (r.kind === "series" ? `[${r.series} ${r.count}]` : r.code));
  // KS before PC151 (alphabetical), numbers in natural order, single items last.
  assert.deepEqual(shape, ["[KS 2]", "KS-01", "KS-02", "[PC151 3]", "PC151-01", "PC151-2", "PC151-10", "[Other items 2]", "FABR(W) B", "NV-1WP"]);
  assert.deepEqual(sheets[1].rows.map((r) => (r.kind === "series" ? `[${r.series} ${r.count}]` : r.code)), ["[NLY-D35 2]", 'NLY-D35-2.5"', 'NLY-D35-3"']);
  // A type with no active item gives no sheet; an unknown type neither.
  assert.deepEqual(buildCountSheets(MASTER, ["NOPE"]), []);
});

test("countSheetAoa: title rows, the header, blank quantities — never a system quantity", () => {
  const [bm] = buildCountSheets(MASTER, ["B.M-FABR"]);
  const aoa = countSheetAoa(bm, { company: "HOOKKA INDUSTRIES SDN BHD", ymLabel: "Nov 2026" });
  const h = aoa.findIndex((r) => r[1] === "Item Code");
  assert.ok(h > 0, "the header comes after the title rows");
  assert.deepEqual(aoa[h], COUNT_SHEET_HEADER);
  assert.match(String(aoa[0][0]), /HOOKKA INDUSTRIES SDN BHD/);
  assert.ok(aoa.some((r) => r.includes("B.M-FABR")), "the type is named");
  assert.ok(aoa.some((r) => r.includes("Nov 2026")), "the month is named");
  assert.ok(aoa.some((r) => /Write 0 if there is none/.test(String(r[0] ?? ""))), "blank vs zero is explained");
  const body = aoa.slice(h + 1);
  const itemRows = body.filter((r) => r[1]);
  assert.equal(itemRows.length, 7);
  for (const r of itemRows) assert.equal(r[4], "", "Counted Qty is blank");
  assert.deepEqual(itemRows[0], ["KS", "KS-01", "KS-01 desc", "MTR", "", ""]);
  // A series header row carries no item code.
  assert.deepEqual(body[0], ["KS (2 items)", "", "", "", "", ""]);
});

// ── Reading the filled sheet back ─────────────────────────────────────────
test("parseCountWorkbook: finds the header on every sheet, blank = not counted, 0 = counted", () => {
  const [bm] = buildCountSheets(MASTER, ["B.M-FABR"]);
  const aoa = countSheetAoa(bm, { company: "X", ymLabel: "Nov 2026" });
  const h = aoa.findIndex((r) => r[1] === "Item Code");
  const fill = { "KS-01": 12.5, "KS-02": 0, "PC151-01": "1,333.2", "PC151-2": "  ", "NV-1WP": "abc", "PC151-10": -3 };
  const filled = aoa.map((r, i) => (i > h && r[1] && fill[r[1]] !== undefined ? [r[0], r[1], r[2], r[3], fill[r[1]], r[1] === "KS-01" ? "rack A" : ""] : r));
  const out = parseCountWorkbook([{ name: "B.M-FABR", aoa: filled }, { name: "Notes", aoa: [["just text"]] }]);
  assert.deepEqual(out.lines, [
    { code: "KS-01", qty: 12.5, remark: "rack A" },
    { code: "KS-02", qty: 0 },
    { code: "PC151-01", qty: 1333.2 },
  ]);
  assert.equal(out.sheetsRead, 1);
  assert.deepEqual(out.skippedSheets, ["Notes"]);
  // PC151-2 (spaces) and FABR(W) B (empty) are blank: not counted.
  assert.equal(out.blank, 2);
  assert.deepEqual(out.problems.map((p) => [p.code, p.message]).sort(), [
    ["NV-1WP", "Counted Qty is not a number"],
    ["PC151-10", "Counted Qty is below zero"],
  ]);
  for (const p of out.problems) assert.ok(p.row > h + 1, "rows are 1-based Excel rows");
});

test("parseCountWorkbook: the same item twice adds up and is reported; Balance Qty files are read too", () => {
  const sheetA = [["Item Code", "Counted Qty"], ["KS-01", 5], ["ks-01 ", 2.25]];
  const sheetB = [["Item Code *", "Item Group *", "Balance Qty"], ["KS-01", "B.M-FABR", 1], ["PC151-01", "B.M-FABR", 4.39999999999999]];
  const out = parseCountWorkbook([{ name: "A", aoa: sheetA }, { name: "B", aoa: sheetB }]);
  assert.deepEqual(out.lines, [{ code: "KS-01", qty: 8.25 }, { code: "PC151-01", qty: 4.4 }]);
  assert.deepEqual(out.duplicates, ["KS-01"]);
});

test("normalizeCountLines (server): adds duplicates, refuses bad lines, keeps remarks short", () => {
  const ok = normalizeCountLines([{ code: "KS-01", qty: 1 }, { code: " ks-01", qty: 2, remark: "x".repeat(300) }, { code: "PC151-01", qty: 0 }]);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.lines.map((l) => [l.code, l.qty]), [["KS-01", 3], ["PC151-01", 0]]);
  assert.equal(ok.lines[0].remark.length, 200);
  const bad = normalizeCountLines([{ code: "", qty: 1 }, { code: "A", qty: -1 }, { code: "B", qty: "x" }, { code: "C", qty: Infinity }]);
  assert.equal(bad.errors.length, 4);
  assert.deepEqual(bad.lines, []);
  assert.match(normalizeCountLines("nope").errors[0], /lines must be a list/);
});

test("parseUomFactor: a positive number, blank clears, anything else is refused", () => {
  assert.equal(parseUomFactor(300), 300);
  assert.equal(parseUomFactor("400"), 400);
  assert.equal(parseUomFactor("0.5"), 0.5);
  assert.equal(parseUomFactor(null), null);
  assert.equal(parseUomFactor(""), null);
  for (const v of [0, -2, "abc", 2000000, Infinity]) assert.equal(parseUomFactor(v), undefined, String(v));
});

// ── Counts on file → quantities ───────────────────────────────────────────
test("countFromFinanceLines: only counted lines, quantities added per item; warehouse lines likewise", () => {
  const fin = countFromFinanceLines({
    lines: [
      { code: "PC151-01", qty: 1333.2, counted: true },
      { code: "PC151-01", qty: 19, counted: true },
      { code: "GBEX 90/40", qty: 11, counted: false },
      { code: "KS-01", qty: 3 },
    ],
  });
  assert.deepEqual(fin, { "PC151-01": 1352.2, "KS-01": 3 });
  assert.equal(countFromFinanceLines(null), null);
  assert.equal(countFromFinanceLines({ lines: "x" }), null);
  assert.deepEqual(countFromWarehouseLines({ lines: [{ code: "ks-01", qty: 2 }, { code: "KS-01", qty: 1 }] }), { "KS-01": 3 });
});

// ── Usage ─────────────────────────────────────────────────────────────────
test("buildUsage: opening + purchased − closing per item, with the reasons a figure is missing", () => {
  const out = buildUsage({
    items: MASTER,
    groups: ["B.M-FABR", "S.FILLER"],
    opening: { "PC151-01": 100, "PC151-2": 50, "KS-01": 10, 'NLY-D35-3"': 20, "GONE-1": 4 },
    closing: { "PC151-01": 80, "PC151-2": 70, "KS-02": 5, 'NLY-D35-3"': 6, "NEW-9": 1 },
    purchases: {
      "PC151-01": { qty: 30, minUnitSen: 1200, maxUnitSen: 1200 },
      "PC151-2": { qty: 10, minUnitSen: 800, maxUnitSen: 1200 },
      'NLY-D35-3"': { qty: 2, minUnitSen: 9372, maxUnitSen: 9864 },
      "FABR(W) B": { qty: 3, minUnitSen: 170, maxUnitSen: 31705 },
      "GBEX 90/40": { qty: 1, minUnitSen: 52000, maxUnitSen: 52000 },
    },
    factors: { 'NLY-D35-3"': 2 },
  });
  assert.deepEqual(out.groups.map((g) => g.group), ["B.M-FABR", "S.FILLER"], "only the chosen types; EQUIPMEN is left out");
  const rows = Object.fromEntries(out.groups.flatMap((g) => g.series.flatMap((s) => s.rows)).map((r) => [r.code, r]));
  // 100 + 30 − 80 = 50
  assert.equal(rows["PC151-01"].usage, 50);
  // 50 + 10 − 70 = −10: negative
  assert.equal(rows["PC151-2"].usage, -10);
  assert.deepEqual(rows["PC151-2"].flags, ["negative"]);
  // Counted last month, not this month.
  assert.equal(rows["KS-01"].usage, null);
  assert.deepEqual(rows["KS-01"].flags, ["noClosing"]);
  // Counted this month, not last month.
  assert.equal(rows["KS-02"].opening, null);
  assert.deepEqual(rows["KS-02"].flags, ["noOpening"]);
  // Bought at prices > 3× apart, no factor set: the units may differ.
  assert.ok(rows["FABR(W) B"].flags.includes("units"));
  // A factor turns the purchase unit into the count unit: 20 + 2×2 − 6 = 18.
  assert.equal(rows['NLY-D35-3"'].purchasedRaw, 2);
  assert.equal(rows['NLY-D35-3"'].factor, 2);
  assert.equal(rows['NLY-D35-3"'].purchased, 4);
  assert.equal(rows['NLY-D35-3"'].usage, 18);
  assert.ok(!rows['NLY-D35-3"'].flags.includes("units"));
  // An item with nothing this month or last is not listed.
  assert.equal(rows["NV-1WP"], undefined);
  // Counted codes missing from the item master are listed apart.
  assert.deepEqual(out.unknown.map((r) => r.code).sort(), ["GONE-1", "NEW-9"]);
  // Series total only when every row shares the unit and has a usage.
  const pc = out.groups[0].series.find((s) => s.series === "PC151");
  assert.deepEqual(pc.total, { uom: "MTR", opening: 150, purchased: 40, closing: 150, usage: 40 });
  const ks = out.groups[0].series.find((s) => s.series === "KS");
  assert.equal(ks.total, null);
  assert.deepEqual(out.summary, { items: 6, withUsage: 3, negatives: 1, units: 1 });
});

test("buildUsage: no count on file for a month means no per-row 'not counted' noise", () => {
  const out = buildUsage({ items: MASTER, groups: ["B.M-FABR"], opening: null, closing: { "KS-01": 2 }, purchases: { "KS-02": { qty: 1, minUnitSen: 100, maxUnitSen: 100 } }, factors: {} });
  const rows = out.groups[0].series.flatMap((s) => s.rows);
  assert.deepEqual(rows.map((r) => [r.code, r.opening, r.usage, r.flags]), [
    ["KS-01", null, null, []],
    ["KS-02", null, null, ["noClosing"]],
  ]);
});

test("usageExportAoa: one row per item under its type and series, missing figures blank", () => {
  const out = buildUsage({ items: MASTER, groups: ["B.M-FABR"], opening: { "PC151-01": 100 }, closing: { "PC151-01": 80 }, purchases: { "PC151-01": { qty: 30, minUnitSen: 1, maxUnitSen: 1 } }, factors: {} });
  const aoa = usageExportAoa(out, { company: "X", ymLabel: "Nov 2026", prevLabel: "Oct 2026", openingSource: "Warehouse count", closingSource: "Warehouse count" });
  const h = aoa.findIndex((r) => r[0] === "Type");
  assert.deepEqual(aoa[h], ["Type", "Series", "Item Code", "Description", "UOM", "Opening (Oct 2026)", "Purchased (Nov 2026)", "Unit factor", "Closing (Nov 2026)", "Usage (Nov 2026)", "Note"]);
  assert.deepEqual(aoa[h + 1], ["B.M-FABR", "PC151", "PC151-01", "PC151-01 desc", "MTR", 100, 30, "", 80, 50, ""]);
});

test("financeCountAoa: the saved count in the master-export layout Finance's Stock Take imports", () => {
  const aoa = financeCountAoa([{ code: "KS-01", qty: 3 }, { code: "NEW-9", qty: 1 }], MASTER);
  assert.deepEqual(aoa[0], FINANCE_COUNT_HEADER);
  assert.ok(isRmCountShape(aoa[0]), "Finance's importer recognises the file");
  const rows = parseRmCountRows(aoa);
  assert.deepEqual(rows.map((r) => [r.code, r.group, r.qty]), [["KS-01", "B.M-FABR", 3], ["NEW-9", "", 1]]);
});

test("safeSheetName: Excel's forbidden characters go, 31 characters at most, repeats numbered", () => {
  const used = new Set();
  assert.equal(safeSheetName("S.M-FABR", used), "S.M-FABR");
  assert.equal(safeSheetName("R&D", used), "R&D");
  assert.equal(safeSheetName("A/B:C", used), "A-B-C");
  assert.equal(safeSheetName("s.m-fabr", used), "s.m-fabr (2)");
  const long = safeSheetName("X".repeat(40), used);
  assert.equal(long.length, 31);
  assert.equal(safeSheetName("X".repeat(40), used), "X".repeat(27) + " (2)");
});

// ── Wiring ────────────────────────────────────────────────────────────────
test("API: mounted at /api/stock-count, reads need inventory:read, saves need inventory:create", () => {
  const worker = read("src/api/worker.ts");
  assert.match(worker, /app\.route\("\/api\/stock-count", stockCount\)/);
  const src = read("src/api/routes/stock-count.ts");
  for (const r of ['app.get("/items"', 'app.get("/count"', 'app.get("/usage"']) {
    const at = src.indexOf(r);
    assert.ok(at >= 0, r);
    assert.match(src.slice(at, at + 300), /requirePermission\(c, "inventory", "read"\)/, r);
  }
  for (const r of ['app.put("/count"', 'app.put("/uom-factor"']) {
    const at = src.indexOf(r);
    assert.ok(at >= 0, r);
    assert.match(src.slice(at, at + 300), /requirePermission\(c, "inventory", "create"\)/, r);
  }
  // Quantities only: the warehouse record is its own kv key, never the Finance
  // stock take (stock_take / stock_take_lines are read, not written).
  assert.match(src, /stock_count:\$\{orgId\}:\$\{ym\}/);
  assert.doesNotMatch(src, /INSERT INTO stock_take|UPDATE stock_take|DELETE FROM stock_take/);
  // The only two writes go to the warehouse's own keys; Finance's count is read as a fallback.
  const writes = [...src.matchAll(/writeKv\(c\.var\.DB, ([a-zA-Z]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(writes.sort(), ["countKey", "factorsKey"]);
  assert.match(src, /stock_take_lines:\$\{orgId\}:\$\{ym\}/);
  // No money leaves this route: no price or value field in any response.
  assert.doesNotMatch(src, /unitSen:|valueSen|priceSen/);
  assert.match(src, /resource: "stock-count"/);
});

test("UI: Warehouse › Stock Take in the sidebar, gated like Inventory, lazy route", () => {
  const sidebar = read("src/components/layout/sidebar.tsx");
  assert.match(sidebar, /\{ name: "Stock Take", href: "\/inventory\/stock-take", icon: ClipboardCheck \}/);
  assert.match(sidebar, /!pathname\.startsWith\("\/inventory\/stock-take"\)/);
  assert.match(read("src/api/lib/nav-permissions.ts"), /"\/inventory\/stock-take": "inventory"/);
  const routes = read("src/dashboard-routes.tsx");
  assert.match(routes, /path: '\/inventory\/stock-take'/);
  assert.match(routes, /import\('\.\/pages\/inventory\/stock-take'\)/);
});
