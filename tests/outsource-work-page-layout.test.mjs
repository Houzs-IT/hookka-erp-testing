import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/production/outsource-issue.tsx", "utf8");
const grid = readFileSync("src/components/ui/data-grid.tsx", "utf8");

test("issuing is scanner-only: no camera, no Issue button, Enter submits and clears", () => {
  assert.doesNotMatch(page, /QrCameraScanner|>\s*Camera\s*</);
  assert.doesNotMatch(page, /type="submit"/);
  assert.match(page, /onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*submitScan\(\);/);
  assert.match(page, /setScanText\(""\);\s*void issue\.issueByScan\(text\);/);
  assert.match(page, /if \(selectedWorkerId && !isIssuing\) scanInputRef\.current\?\.focus\(\);/);
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
