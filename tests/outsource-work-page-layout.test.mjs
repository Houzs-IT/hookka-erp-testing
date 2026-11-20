import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readLf = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const page = readLf("src/pages/production/outsource-issue.tsx");
const grid = readLf("src/components/ui/data-grid.tsx");

test("issuing on PC: scanner Enter, an Issue button and Scan QR all issue; the field clears", () => {
  assert.match(page, /<Button type="submit"[^>]*>\s*<ArrowRight[^>]*\/>\s*Issue\s*<\/Button>/);
  assert.match(page, /<ScanLine[^>]*\/>\s*Scan QR/);
  assert.match(page, /<QrCameraScanner\s+onDecode=\{\(text\) => void issue\.issueByScan\(text\)\}/);
  assert.match(page, /onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*submitScan\(\);/);
  assert.match(page, /setScanText\(""\);\s*void issue\.issueByScan\(text\);/);
  assert.match(page, /if \(selectedWorkerId && !isIssuing && !isCameraOpen\) scanInputRef\.current\?\.focus\(\);/);
});

test("default columns fit a 902px table (1366px screen) with Actions pinned last", () => {
  const widthOf = (label) => Number(new RegExp(`label: "${label}",\\s*width: "(\\d+)px"`).exec(page)?.[1]);
  const issuedAt = Number(/key,\s*label,\s*width: "(\d+)px"/.exec(page)?.[1]);
  const visible = [issuedAt, widthOf("Worker"), widthOf("PO no"), widthOf("Product"), widthOf("Item"), widthOf("Piece"), widthOf("Status"), widthOf("Actions")];
  assert.ok(visible.every(Number.isFinite), JSON.stringify(visible));
  assert.ok(visible.reduce((sum, width) => sum + width, 0) <= 902);
  assert.match(page, /label: "Department", width: "\d+px", sortable: true, defaultHidden: true/);
  assert.match(page, /label: "Actions",[\s\S]*?stickyEnd: true[\s\S]*?\n {4}\},\n {2}\];/);
});

test("the grid can hide its toolbar record count; search never collapses", () => {
  assert.match(page, /hideToolbarCount/);
  assert.match(grid, /\{!hideToolbarCount && \(/);
  assert.match(grid, /relative flex-1 min-w-\[180px\] max-w-\[280px\]/);
});

test("the tracking table sits on its own white card with a neutral header and solid white rows", () => {
  assert.match(page, /<div className=\{NEUTRAL_GRID_SURFACE\}>\s*<DataGrid<OutsourceIssueWithDone>/);
  assert.match(page, /"rounded-lg border border-slate-200 bg-white"/);
  assert.match(page, /\[&_thead_th\]:!bg-slate-50/);
  assert.match(page, /\[&_\[data-dg=row\]\]:!bg-white \[&_\[data-dg=row\]:hover\]:!bg-slate-50/);
  assert.doesNotMatch(page, /NEUTRAL_GRID_SURFACE = \[\s*"overflow-hidden/);
});

test("Approve is AA-contrast emerald and the status tabs are borderless slate", () => {
  assert.match(page, /APPROVE_BUTTON_CLASS = "bg-emerald-700 text-white hover:bg-emerald-800"/);
  assert.match(page, /className=\{APPROVE_BUTTON_CLASS\}/);
  assert.match(page, /aria-label="Status" className="flex rounded-md bg-slate-100 p-1"/);
  assert.match(page, /"bg-white text-slate-900 shadow-xs"/);
});
