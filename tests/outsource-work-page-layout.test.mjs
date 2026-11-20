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

test("full-width stacked layout: Issue Work bar on top, table below", () => {
  assert.ok(!page.includes("lg:grid-cols-[340px_minmax(0,1fr)]"));
  assert.match(page, /<IssueWorkBar [^>]*\/>\s*<TrackingLedger /);
  assert.ok(page.includes("md:grid-cols-[260px_minmax(0,1fr)_auto]"));
  assert.ok(page.includes("<SessionIssuesPopover issue={issue} canUndo={canUndo} />"));
});

test("toolbar: status tabs + search on row 1, filters + buttons on row 2", () => {
  assert.ok(page.includes("toolbarStart={<StatusTabs issue={issue} />}"));
  assert.ok(page.includes("toolbarSecondRow={<TrackingFilters issue={issue} />}"));
  assert.match(grid, /\{toolbarSecondRow && \(\s*<>\s*<div className="basis-full h-0" aria-hidden \/>/);
});

test("columns: Product & Item merged, Piece hidden by default, Actions pinned last with a solid edge", () => {
  assert.ok(page.includes('label: "Product & Item"'));
  assert.ok(!page.includes('label: "Item"'));
  assert.match(page, /label: "Piece",[^}]*defaultHidden: true/);
  assert.ok(page.includes("shortWorkerName(row.workerName)"));
  assert.ok(page.includes('gridId="outsource-issue-tracking-v4"'));
  assert.match(page, /label: "Actions",[\s\S]*?stickyEnd: true[\s\S]*?\n {4}\},\n {2}\];/);
  assert.ok(page.includes("[&_td.sticky.right-0]:border-l"));
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
  assert.match(page, /aria-label="Status" className="flex max-w-full overflow-x-auto rounded-md bg-slate-100 p-1"/);
  assert.match(page, /"bg-white text-slate-900 shadow-xs"/);
});
