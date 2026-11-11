// Warehouse › Stock Take, round 2 (owner 2026-11-11):
//   「做成好看一点的表格，有线条的」 — the count sheet and the usage export get
//   lines (thin borders on every table cell), a filled bold header, bold shaded
//   series rows spanning the table, a shaded write-in column, five columns that
//   fit A4 portrait and the header row repeated on every printed page;
//   「然后 UOM 如果他导出来换呢」 — a unit changed on the sheet is read, shown
//   before saving and flagged in the usage, never silently mixed.
// Styling is pure (src/lib/styled-xlsx.ts, xlsx-js-style passed in), so it is
// tested on real worksheets, including a write → read round trip.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  COUNT_SHEET_COLS,
  COUNT_SHEET_WRITE_COLS,
  buildCountSheets,
  buildUsage,
  countSheetLayout,
  countUnitsFromLines,
  financeCountAoa,
  normalizeCountLines,
  parseCountWorkbook,
  usageExportLayout,
  usageNote,
} from "../src/lib/stock-count.ts";
import { buildStyledSheet, fitToPageXml, printTitleNames, withFitToPage } from "../src/lib/styled-xlsx.ts";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx-js-style");
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const item = (code, group, uom, extra = {}) => ({ id: "rm-" + code, code, description: code + " desc", uom, group, active: true, ...extra });
const MASTER = [
  item("PC151-01", "B.M-FABR", "ROLL"),
  item("PC151-02", "B.M-FABR", "MTR"),
  item("KS-01", "B.M-FABR", "METER"),
  item("KS-02", "B.M-FABR", "MTR"),
];
const cellAt = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })];
const countSheet = () => {
  const [bm] = buildCountSheets(MASTER, ["B.M-FABR"]);
  return countSheetLayout(bm, { company: "X", ymLabel: "Nov 2026" });
};

// ── Layout: one kind per row ──────────────────────────────────────────────
test("countSheetLayout: title, meta, sign, note, blank, header, then series and item rows", () => {
  const { aoa, kinds } = countSheet();
  assert.equal(kinds.length, aoa.length);
  assert.deepEqual(kinds.slice(0, 6), ["title", "meta", "sign", "note", "blank", "header"]);
  assert.deepEqual(kinds.slice(6), ["series", "item", "item", "series", "item", "item"]);
  assert.equal(aoa[kinds.indexOf("header")][0], "Item Code");
});

test("five count-sheet columns fit A4 portrait at 100% (≈ 7.47 in between 0.4 in margins)", () => {
  // Excel column px ≈ 7 × width + 5 (Calibri 11); A4 printable ≈ 7.47 in × 96 px.
  const px = COUNT_SHEET_COLS.reduce((t, w) => t + 7 * w + 5, 0);
  assert.ok(px <= 7.47 * 96, `${px}px`);
  assert.deepEqual(COUNT_SHEET_WRITE_COLS, [3, 4]);
});

// ── Lines ────────────────────────────────────────────────────────────────
test("buildStyledSheet: thin borders on every table cell, filled bold header, merged bold series rows, shaded write-in columns", () => {
  const { aoa, kinds } = countSheet();
  const ws = buildStyledSheet(XLSX, { name: "B.M-FABR", aoa, kinds, cols: COUNT_SHEET_COLS, writeCols: COUNT_SHEET_WRITE_COLS });
  const h = kinds.indexOf("header");
  for (let c = 0; c < 5; c++) {
    const s = cellAt(ws, h, c).s;
    assert.equal(s.border.top.style, "thin", `header col ${c}`);
    assert.ok(s.fill.fgColor.rgb, `header col ${c} filled`);
    assert.equal(s.font.bold, true);
  }
  const it = kinds.indexOf("item");
  for (let c = 0; c < 5; c++) {
    const cell = cellAt(ws, it, c);
    assert.ok(cell, `item col ${c} exists even when empty, so its lines print`);
    for (const side of ["top", "bottom", "left", "right"]) assert.equal(cell.s.border[side].style, "thin", `item col ${c} ${side}`);
  }
  assert.ok(cellAt(ws, it, 3).s.fill, "Counted Qty is shaded for writing");
  assert.ok(cellAt(ws, it, 4).s.fill, "Remark is shaded for writing");
  assert.ok(!cellAt(ws, it, 0).s.fill, "the item code is not shaded");
  const merges = ws["!merges"].map((m) => `${m.s.r}:${m.s.c}-${m.e.r}:${m.e.c}`);
  assert.ok(merges.includes("0:0-0:4"), "title spans the table");
  const s0 = kinds.indexOf("series");
  assert.ok(merges.includes(`${s0}:0-${s0}:4`), "a series row spans the table");
  assert.equal(cellAt(ws, s0, 0).s.font.bold, true);
  assert.equal(cellAt(ws, s0, 4).s.border.right.style, "thin", "the merged series row is boxed to the last column");
  // "Checked by" sits over the 12-wide Counted Qty column, its line under Remark.
  const sign = kinds.indexOf("sign");
  assert.equal(aoa[sign][3], "Checked by");
  assert.equal(cellAt(ws, sign, 4).s.border.bottom.style, "thin");
  assert.deepEqual(ws["!cols"].map((c) => c.wch), COUNT_SHEET_COLS);
  assert.ok(ws["!rows"][it].hpt >= 18, "rows tall enough to write in");
  assert.ok(ws["!margins"], "print margins set");
});

test("printTitleNames: the header row repeats at the top of every printed page", () => {
  const { aoa, kinds } = countSheet();
  const names = printTitleNames([{ kinds }, { kinds: ["title"] }], ["B.M-FABR", "Notes"]);
  assert.deepEqual(names, [{ Name: "_xlnm.Print_Titles", Sheet: 0, Ref: "'B.M-FABR'!$6:$6" }]);
  assert.equal(printTitleNames([{ kinds }], ["It's"])[0].Ref, "'It''s'!$6:$6");
  // Written and read back by Excel's own format.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildStyledSheet(XLSX, { name: "B.M-FABR", aoa, kinds, cols: COUNT_SHEET_COLS }), "B.M-FABR");
  wb.Workbook = { Names: names };
  const back = XLSX.read(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }), { type: "buffer" });
  const t = (back.Workbook?.Names ?? []).find((n) => n.Name === "_xlnm.Print_Titles");
  assert.ok(t, "the defined name survives the round trip");
  assert.match(t.Ref, /\$6:\$6/);
});

// A printer's own unprintable edge pushed the Remark column onto a second page
// at 100% (measured 2026-11-11 with Excel on the owner's PC), so every sheet is
// set to A4 portrait, fit to one page wide. SheetJS cannot write page setup;
// the sheet XML is patched inside the zip.
test("fitToPageXml: A4 portrait, one page wide, as tall as needed — inserted once, in schema order", () => {
  const xml = '<worksheet xmlns="x"><dimension ref="A1"/><sheetData/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>';
  const out = fitToPageXml(xml);
  assert.match(out, /^<worksheet xmlns="x"><sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr><dimension/);
  assert.match(out, /<pageMargins [^>]*\/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"\/><\/worksheet>$/);
  assert.equal(fitToPageXml(out), out, "applying twice changes nothing");
  // An existing sheetPr keeps its attributes and gains pageSetUpPr last.
  assert.match(fitToPageXml('<worksheet><sheetPr codeName="A"/><sheetData/><pageMargins left="1"/></worksheet>'), /<sheetPr codeName="A"><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.match(fitToPageXml('<worksheet><sheetPr><tabColor rgb="FF0000"/></sheetPr><sheetData/><pageMargins left="1"/></worksheet>'), /<sheetPr><tabColor rgb="FF0000"\/><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
});

test("withFitToPage: the patched workbook still reads, every sheet carries the page setup", () => {
  const { aoa, kinds } = countSheet();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildStyledSheet(XLSX, { name: "A", aoa, kinds, cols: COUNT_SHEET_COLS }), "A");
  XLSX.utils.book_append_sheet(wb, buildStyledSheet(XLSX, { name: "B", aoa, kinds, cols: COUNT_SHEET_COLS }), "B");
  const raw = new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }));
  const patched = withFitToPage(XLSX, raw);
  assert.ok(patched instanceof Uint8Array && patched.length > 1000);
  const back = XLSX.read(patched, { type: "array" });
  assert.deepEqual(back.SheetNames, ["A", "B"]);
  assert.equal(XLSX.utils.sheet_to_json(back.Sheets.A, { header: 1, defval: "" })[kinds.indexOf("header")][0], "Item Code");
  const cfb = XLSX.CFB.read(patched, { type: "array" });
  const sheets = cfb.FullPaths.map((p, i) => [p, cfb.FileIndex[i]]).filter(([p]) => /xl\/worksheets\/sheet\d+\.xml$/.test(p));
  assert.equal(sheets.length, 2);
  for (const [, e] of sheets) assert.match(Buffer.from(e.content).toString("utf8"), /fitToWidth="1"/);
});

test("a styled count sheet still reads back: fill it, write it, read it", () => {
  const { aoa, kinds } = countSheet();
  const filled = aoa.map((r, i) => (kinds[i] === "item" && r[0] === "KS-01" ? [r[0], r[1], r[2], 7.5, "rack B"] : r));
  const ws = buildStyledSheet(XLSX, { name: "B.M-FABR", aoa: filled, kinds, cols: COUNT_SHEET_COLS, writeCols: COUNT_SHEET_WRITE_COLS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "B.M-FABR");
  const back = XLSX.read(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }), { type: "buffer" });
  const sheets = back.SheetNames.map((name) => ({ name, aoa: XLSX.utils.sheet_to_json(back.Sheets[name], { header: 1, defval: "", raw: true, blankrows: true }) }));
  const units = Object.fromEntries(MASTER.map((m) => [m.code, m.uom]));
  const out = parseCountWorkbook(sheets, units);
  assert.deepEqual(out.lines, [{ code: "KS-01", qty: 7.5, remark: "rack B" }]);
  assert.equal(out.blank, 3, "the three untouched items read as not counted; the two family headings are skipped");
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.unitChanges, []);
});

test("usageExportLayout: kinds per row; a negative usage prints red, numbers right-aligned", () => {
  const u = buildUsage({ items: MASTER, groups: ["B.M-FABR"], opening: { "PC151-02": 10 }, closing: { "PC151-02": 20 }, purchases: {}, factors: {} });
  const { aoa, kinds } = usageExportLayout(u, { company: "X", ymLabel: "Nov 2026", prevLabel: "Oct 2026", openingSource: "a", closingSource: "b" });
  assert.equal(kinds.length, aoa.length);
  assert.deepEqual(kinds.slice(0, 6), ["title", "metaLong", "metaLong", "note", "blank", "header"]);
  const ws = buildStyledSheet(XLSX, { name: "Usage", aoa, kinds, cols: Array(11).fill(10), numCols: [5, 6, 7, 8, 9], negRedCols: [9] });
  const r = kinds.indexOf("item");
  const usage = cellAt(ws, r, 9);
  assert.equal(usage.v, -10);
  assert.equal(usage.s.font.color.rgb, "B91C1C");
  assert.equal(usage.s.alignment.horizontal, "right");
  assert.equal(cellAt(ws, r, 2).s.alignment.horizontal, "left");
  const merges = ws["!merges"].map((m) => `${m.s.r}:${m.s.c}-${m.e.r}:${m.e.c}`);
  assert.ok(merges.includes("1:1-1:10"), "the long source line spans the table");
});

// ── A unit changed on the sheet ───────────────────────────────────────────
test("parseCountWorkbook: a unit changed on the sheet stays on the line and is listed; the same unit spelled differently is not", () => {
  const units = { "PC151-01": "ROLL", "KS-01": "METER" };
  const sheet = [["Item Code", "UOM", "Counted Qty"], ["PC151-01", "MTR", 1333.2], ["KS-01", "MTR", 9], ["NEW-1", "PCS", 2], ["KS-02", "", 4]];
  const out = parseCountWorkbook([{ name: "S", aoa: sheet }], units);
  assert.deepEqual(out.lines, [
    { code: "PC151-01", qty: 1333.2, uom: "MTR" },
    { code: "KS-01", qty: 9 },
    { code: "NEW-1", qty: 2, uom: "PCS" },
    { code: "KS-02", qty: 4 },
  ]);
  assert.deepEqual(out.unitChanges, [{ code: "PC151-01", from: "ROLL", to: "MTR" }]);
  // Without the item master the UOM column is not read (the old behaviour).
  assert.deepEqual(parseCountWorkbook([{ name: "S", aoa: sheet }]).lines[0], { code: "PC151-01", qty: 1333.2 });
});

test("normalizeCountLines (server) keeps a line's unit, short", () => {
  const { lines, errors } = normalizeCountLines([{ code: "PC151-01", qty: 5, uom: " MTR " }, { code: "KS-01", qty: 1, uom: "X".repeat(40) }, { code: "KS-02", qty: 1, uom: 7 }]);
  assert.deepEqual(errors, []);
  assert.equal(lines[0].uom, "MTR");
  assert.equal(lines[1].uom.length, 20);
  assert.equal(lines[2].uom, undefined);
});

test("countUnitsFromLines: the units a count names per item — Finance's counted lines, or every warehouse line", () => {
  const fin = { lines: [{ code: "PC151-01", qty: 1333.2, uom: "MTR", counted: true }, { code: "pc151-01", qty: 19, uom: "ROLL", counted: true }, { code: "X", qty: 1, uom: "PCS", counted: false }, { code: "KS-01", qty: 2 }] };
  assert.deepEqual(countUnitsFromLines(fin, true), { "PC151-01": ["MTR", "ROLL"] });
  assert.deepEqual(countUnitsFromLines(fin, false), { "PC151-01": ["MTR", "ROLL"], X: ["PCS"] });
  assert.deepEqual(countUnitsFromLines(null, false), {});
});

test("buildUsage: a count in another unit than the item master is flagged and named; MTR = METER", () => {
  const u = buildUsage({
    items: MASTER,
    groups: ["B.M-FABR"],
    opening: { "PC151-01": 100, "KS-01": 2 },
    closing: { "PC151-01": 1333.2, "KS-01": 3 },
    openingUnits: { "PC151-01": ["ROLL"] },
    closingUnits: { "PC151-01": ["MTR"], "KS-01": ["MTR"] },
    purchases: {},
    factors: {},
  });
  const rows = Object.fromEntries(u.groups[0].series.flatMap((s) => s.rows).map((r) => [r.code, r]));
  assert.ok(rows["PC151-01"].flags.includes("unitChanged"));
  assert.deepEqual(rows["PC151-01"].countedUnits, ["MTR"]);
  assert.match(usageNote(rows["PC151-01"]), /Counted in MTR — item unit ROLL/);
  assert.ok(!rows["KS-01"].flags.includes("unitChanged"), "MTR and METER are the same unit");
  assert.equal(u.summary.units, 1, "a changed unit counts as a unit to check");
});

test("financeCountAoa: the unit counted goes to Finance, not the master's", () => {
  const aoa = financeCountAoa([{ code: "PC151-01", qty: 5, uom: "MTR" }, { code: "KS-01", qty: 1 }], MASTER);
  assert.equal(aoa[1][3], "MTR");
  assert.equal(aoa[2][3], "METER");
});

// ── Wiring ────────────────────────────────────────────────────────────────
test("the page exports both sheets with lines and passes the item units to the import", () => {
  const page = read("src/pages/inventory/stock-take.tsx");
  assert.match(page, /exportStyledWorkbookXlsx\(\s*`stock-count-sheet-\$\{ym\}\.xlsx`/);
  assert.match(page, /cols: COUNT_SHEET_COLS, writeCols: COUNT_SHEET_WRITE_COLS/);
  assert.match(page, /exportStyledWorkbookXlsx\(`stock-usage-\$\{ym\}\.xlsx`/);
  assert.match(page, /parseCountWorkbook\(await readWorkbook\(f\), masterUnits\)/);
  assert.match(page, /unitChanges/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies["xlsx-js-style"], "xlsx-js-style is a dependency");
  const lib = read("src/lib/styled-xlsx.ts");
  assert.match(lib, /await import\("xlsx-js-style"\)/, "loaded only when an export is clicked");
  assert.match(lib, /Names: titles/, "print titles are written");
  // The route reads the units each count names.
  const route = read("src/api/routes/stock-count.ts");
  assert.match(route, /countUnitsFromLines\(/);
  assert.match(route, /openingUnits:/);
  assert.match(route, /closingUnits:/);
});
