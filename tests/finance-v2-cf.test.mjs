// ---------------------------------------------------------------------------
// finance-v2-cf.test.mjs — the Statement of Cash Flow in the v2 look (plan
// 2026-10-16-finance-v2-reports Task 7). Same engine call and rows, months-only
// periods (BUG-2026-08-13-092), the Trade Finance block and drag-to-reclassify
// untouched; new: the report toolbar (stepper, Edit Layout, L1–L3, download),
// the frame (company line as printed so far), Accumulated shading, the
// engine's row kinds in the report look, pale zeros, and the drill as detail
// rows with "Open In GL →". The table keeps to its content's width (owner
// 2026-10-01).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const cf = ui.slice(ui.indexOf("function CashFlowTab() {"), ui.indexOf("\n}\n", ui.indexOf("function CashFlowTab() {")));
const drill = ui.slice(ui.indexOf("function CfMonthlyDrillRows("), ui.indexOf("\n}\n", ui.indexOf("function CfMonthlyDrillRows(")));
const css = read("src/styles/finance-v2.css");

test("same engine call; drag-to-reclassify and supplier categories untouched", () => {
  assert.match(cf, /`\/api\/accounting\/cashflow-statement\?period=\$\{period\}\$\{edit \? "&editable=1" : ""\}`/);
  assert.match(cf, /void moveTo\(src, r\.section, r\.accountCode\);/);
  assert.match(cf, /onChange=\{\(e\) => void saveSupCat\(sup, e\.target\.value\)\}/);
});

test("toolbar: months-only stepper, Edit Layout, L1–L3 (hidden while editing), one download", () => {
  assert.match(cf, /<PeriodStepper value=\{period\} options=\{periodOpts\} onChange=\{setPeriod\} today=\{today\} \/>/);
  assert.match(cf, /<EditLayoutToggle on=\{edit\}/);
  assert.match(cf, /\{!edit && <DetailLevels levels=\{\[1, 2, 3\]\} value=\{level\} onChange=\{applyLevel\} \/>\}/);
  for (const l of ["Export to Excel", "Print / PDF", "Export to CSV"]) assert.ok(cf.includes(`label: "${l}"`), l);
  assert.match(cf, /<EditLayoutBanner>/);
});

test("the frame keeps the company line the statement printed; content width; Accumulated shaded", () => {
  assert.match(cf, /company="HOOKKA INDUSTRIES SDN\. BHD\."/);
  assert.match(cf, /title="Statement Of Cash Flow"/);
  assert.match(cf, /<table data-col-resize="first" data-fin-report data-fin-fit>/);
  assert.match(cf, /<th key=\{c\.key\} data-cell=\{`num split\$\{c\.accum \? " acc" : ""\}`\}>\{c\.label\}<\/th>/);
});

test("the engine's row kinds in the report look; zeros pale, negatives red", () => {
  assert.match(cf, /r\.kind === "result" \|\| r\.kind === "total" \? "res" :/);
  assert.match(cf, /r\.kind === "cf" \? "fin" :/, "Bank c/f closes with the double line");
  assert.match(cf, /data-zero=\{v === 0 \? "" : undefined\}/);
  assert.match(css, /td\[data-zero\] \{\n  color: #C4BDB3;\n\}/);
  assert.match(cf, /data-neg=\{typeof v === "number" && v < 0 \? "" : undefined\}/);
});

test("the drill: detail rows, a detail-total row that ties and opens the ledger", () => {
  assert.match(drill, /<tr key=\{it\.key\} data-row="det" title=\{hover \|\| undefined\}>/);
  assert.match(drill, /<tr data-row="detsum">/);
  assert.match(drill, /\{!data\.tied && <span/, "still says when the payments do not add up to the line");
  assert.match(drill, /Open In GL →<\/Link>/);
});
