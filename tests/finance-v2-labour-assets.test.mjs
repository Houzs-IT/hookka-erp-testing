// ---------------------------------------------------------------------------
// finance-v2-labour-assets.test.mjs — Labour and Fixed Assets in the v2
// Monthly look (plan 2026-10-16-finance-v2-monthly Tasks 3–4). Every write
// keeps its handler, endpoint, confirm and label; only where it sits changes.
// The status banners read only what the server says (the labour preview's
// posted flag; the depreciation preview's rows still to run).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const body = (sig) => { const a = ui.indexOf(sig); return ui.slice(a, ui.indexOf("\n}\n", a)); };
const lab = body("function LaborTab({ accounts }: { accounts: ChartOfAccount[] }) {");
const fa = body("function FixedAssetsTab({ accounts }: { accounts: ChartOfAccount[] }) {");
// The Add Asset form is its own component since 2026-10-17 (backlog item 11,
// tests/fixed-asset-from-voucher.test.mjs); the tab renders it.
const faForm = body("function FixedAssetAddForm(");

test("Labour: Post / Unpost unchanged and on the title row", () => {
  assert.match(lab, /fetch\("\/api\/accounting\/labor\/post", \{\n\s*method: "POST",/);
  assert.match(lab, /fetch\("\/api\/accounting\/labor\/unpost", \{\n\s*method: "POST",/);
  assert.match(lab, /title: `Unpost labour for \$\{month\}\?`,/, "the confirm is the same");
  const bar = lab.slice(lab.indexOf("<FinanceTitleActions>"), lab.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /onClick=\{handleUnpost\}/);
  assert.match(bar, /onClick=\{handlePost\}>\n\s*\{posting \? "Posting…" : `Post \$\{formatCurrency\(data\.totalSen\)\} to GL`\}/);
  assert.match(bar, /<PeriodStepper value=\{month\}/);
  assert.match(bar, /<Link to="\/employees"/, "Check in Payroll opens HR");
});

test("Labour: the banner and cards read the preview's posted flag and totals", () => {
  assert.match(lab, /<StatusBanner\n\s*done=\{data\.posted\}/);
  assert.match(lab, /label: `Production labour · \$\{mLabel\}`, value: formatCurrency\(data\.totalSen\)/);
  assert.match(lab, /<table data-fin-list className="w-full text-sm">/);
});

test("Fixed Assets: Save / dispose / del / Post unchanged; the preview is a read with the month", () => {
  assert.match(faForm, /fetch\("\/api\/accounting\/fixed-assets", \{\n\s*method: "POST",/);
  assert.match(fa, /<FixedAssetAddForm\n/);
  assert.match(fa, /method: "PUT",\n\s*headers: \{ "Content-Type": "application\/json" \},\n\s*body: JSON\.stringify\(\{ dispose: true \}\),/);
  assert.match(fa, /fetch\(`\/api\/accounting\/fixed-assets\/\$\{row\.id\}`, \{ method: "DELETE" \}\)/);
  assert.match(fa, /fetch\("\/api\/accounting\/fixed-assets\/depreciation-run", \{\n\s*method: "POST",/);
  assert.match(fa, /title: "Dispose asset\?"/);
  assert.match(fa, /title: "Delete asset\?"/);
  assert.match(fa, /fetch\(`\/api\/accounting\/fixed-assets\/depreciation-preview\?month=\$\{runMonth\}`\)/);
  assert.match(fa, /\}, \[runMonth, previewKey\]\);/);
  const bar = fa.slice(fa.indexOf("<FinanceTitleActions>"), fa.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /onClick=\{handleRun\}/);
  assert.match(bar, /<Plus className="h-4 w-4" \/> Add Asset/);
});

test("Fixed Assets: grouped by asset account, subtotals and a total that leave out disposed assets", () => {
  assert.match(fa, /const sumOf = \(xs: FaRow\[\], f: \(r: FaRow\) => number\) => xs\.filter\(\(r\) => !r\.disposedAt\)\.reduce/);
  assert.match(fa, /<td colSpan=\{3\}>TOTAL \(in use\)<\/td>/);
  assert.match(fa, /title=\{runState === "done" \? "Nothing left to run" : "Not run"\}/);
  assert.match(fa, /runState: "loading" \| "none" \| "todo" \| "done" =/);
});
