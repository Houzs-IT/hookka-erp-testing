// ---------------------------------------------------------------------------
// export-excel-formats.test.mjs — the list Export's Excel file carries real
// date cells and 1,234.00 money, and status reads as on screen.
//
// Before: dates were text ("2026-08-05"), money a bare number (1234.5) and
// status the raw code (IN_PRODUCTION). Houzs writes date cells and #,##0.00;
// Hookka's screen shows dd/mm/yyyy and "IN PRODUCTION", so the file follows
// the screen. CSV is unchanged.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const ge = await import(pathToFileURL(resolve(process.cwd(), "src/lib/grid-export.ts")).href);
const er = await import(pathToFileURL(resolve(process.cwd(), "src/lib/export-report.ts")).href);

test("a YYYY-MM-DD day becomes Excel's day number, from its parts", () => {
  assert.equal(er.excelDateSerial("1900-03-01"), 61);
  assert.equal(er.excelDateSerial("2026-08-05"), 46239);
  assert.equal(er.excelDateSerial("2026-08-05T09:00:00Z"), null, "only a bare day converts");
  assert.equal(er.excelDateSerial("05/08/2026"), null);
});

test("status exports as the screen shows it: underscores become spaces", () => {
  assert.equal(ge.cellExportValue({ key: "status", label: "Status", type: "status" }, { status: "IN_PRODUCTION" }), "IN PRODUCTION");
  assert.equal(
    ge.cellExportValue({ key: "status", label: "Status", type: "status", exportValue: () => "Planning" }, { status: "NOT_ARRIVED" }),
    "Planning",
    "an exportValue still wins",
  );
});

test("Listing formats line up with the Listing columns, control columns dropped", () => {
  const cols = [
    { key: "__select__", label: "" },
    { key: "doNo", label: "DO", type: "docno" },
    { key: "_view", label: "" },
    { key: "orderDate", label: "Date", type: "date" },
    { key: "totalSen", label: "Total", type: "currency" },
    { key: "status", label: "Status", type: "status" },
  ];
  assert.deepEqual(ge.listingXlsxFormats(cols), [undefined, "date", "money", undefined]);
  assert.equal(ge.buildListingAoa(cols, [])[0].length, 4);
});

test("the written .xlsx holds date cells and #,##0.00 money; the header stays text", async () => {
  let blob;
  globalThis.document = { createElement: () => ({ click() {} }) };
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = (b) => { blob = b; return "blob:x"; };
  URL.revokeObjectURL = () => {};
  try {
    const aoa = [
      ["DO", "Date", "Total"],
      ["DO-1", "2026-08-05", 1234.5],
      ["DO-2", "", 0],
    ];
    await er.exportReportXlsx("t.xlsx", "T", aoa, { colFormats: [undefined, "date", "money"] });
  } finally {
    URL.createObjectURL = realCreate;
    delete globalThis.document;
  }
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array", cellNF: true });
  const ws = wb.Sheets.T;
  assert.equal(ws.B1.t, "s", "header is text");
  assert.equal(ws.B2.t, "n");
  assert.equal(ws.B2.v, 46239);
  assert.equal(ws.B2.z, "dd/mm/yyyy");
  assert.equal(ws.B3?.v ?? "", "", "a blank day stays blank");
  assert.equal(ws.C2.v, 1234.5);
  assert.equal(ws.C2.z, "#,##0.00");
  assert.equal(ws.A2.v, "DO-1");
});

test("the grid passes formats on the Listing → Excel item only", () => {
  const src = readFileSync("src/components/ui/data-grid.tsx", "utf8");
  assert.match(src, /run\(listingAoa, "listing", "xlsx", listingXlsxFormats\(/);
  assert.match(src, /run\(listingAoa, "listing", "csv"\)/);
  assert.match(src, /exportReportXlsx\(fname, label, rows, \{ colFormats: xlsxFormats \}\)/);
});
