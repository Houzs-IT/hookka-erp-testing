// ---------------------------------------------------------------------------
// finance-v2-tb.test.mjs — the Trial Balance in the v2 report shell (plan
// 2026-10-16-finance-v2-reports Task 3). Same data call, same server rows and
// totals, the verdict still from the server's own check; new: a month stepper
// (as at month end, or today for the running month), sections by the Chart of
// Accounts rules with fold and subtotal, L1 / L2, double-click → the General
// Ledger on the same as-at date, Excel / Print-PDF download.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const tb = ui.slice(ui.indexOf("function TrialBalanceTab() {"), ui.indexOf("// =============== TAB: GENERAL LEDGER (Phase 2 follow-up, owner)"));
const api = read("src/api/routes/accounting.ts");

test("same data call and the server's rows and totals, untouched", () => {
  assert.match(tb, /fetch\(`\/api\/accounting\/trial-balance\?asOf=\$\{asOf\}\$\{orgIdParam\(company\)\}`\)/);
  assert.match(tb, /const secs = useMemo\(\(\) => \(tb \? tbSections\(tb\.rows\) : \[\]\), \[tb\]\);/);
  assert.match(tb, /<td>TOTAL<\/td>\n\s*<td data-cell="num split">\{fmtAmt\(tb\.totalDr\)\}<\/td>\n\s*<td data-cell="num">\{fmtAmt\(tb\.totalCr\)\}<\/td>/);
  assert.doesNotMatch(tb, /totalDr\s*[+-]=|reduce\(/, "no figure is recomputed on the page");
});

test("the verdict is the server's real cross-check (BUG-2026-08-13-093)", () => {
  assert.match(tb, /<CheckStrip ok=\{tb\.balanced\} label=\{tb\.balanced \? "Balanced ✓" : checkLabel\(tb\.totalDr - tb\.totalCr\)\}>/);
  assert.match(api, /data: \{ asOf, rows, totalDr, totalCr, balanced: totalDr === totalCr \}/);
});

test("month stepper: as at the month's end, or today for the running month", () => {
  assert.match(tb, /const today = todayYmdMY\(\);/);
  assert.match(tb, /const asOf = asAtDate\(ym, today\);/);
  assert.match(tb, /monthOptions\(today\.slice\(0, 7\), 24\)/);
  assert.match(tb, /<PeriodStepper value=\{ym\} options=\{ymOptions\} onChange=\{setYm\} today=\{today\} \/>/);
  assert.match(tb, /title=\{`Trial Balance As At \$\{fmtDocDate\(asOf\)\}`\}/);
});

test("L1 = section totals, L2 = every account; a heading click folds one section", () => {
  assert.match(tb, /const isOpen = \(k: TbSectionKey\) => \(shut\[k\] !== undefined \? !shut\[k\] : level >= 2\);/);
  assert.match(tb, /onChange=\{\(L\) => \{ setLevel\(L\); setShut\(\{\}\); \}\}/, "a level button resets the clicks");
  assert.match(tb, /onClick=\{\(\) => setShut\(\{ \.\.\.shut, \[s\.key\]: open \}\)\}/);
  assert.match(tb, /<td data-cell="num split">\{open \? "" : amt\(s\.debitSen\)\}<\/td>/, "a folded heading carries its totals");
  assert.match(tb, /<td>Total \{s\.label\}<\/td>/, "an open section ends with its subtotal");
});

test("double-click an account → its ledger, same as-at date (both by document date)", () => {
  assert.match(tb, /const openLedger = \(code: string\) => navigate\(glLink\(\{ account: code, fromYm: ym, toDate: asOf \}\)\);/);
  assert.match(tb, /data-row="line"\n\s*onDoubleClick=\{\(\) => openLedger\(r\.accountCode\)\}/);
  // The ledger's B/F + flow lands on the TB balance: both date legs by the
  // source document and skip pre-opening legs.
  const gl = api.slice(api.indexOf('app.get("/gl", async'));
  assert.match(gl, /if \(legBeforeOpening\(l\.sourceType, d10, obDateOne\)\) continue;/);
  assert.match(gl, /if \(d10 < from\) \{\n\s*openingSen \+= delta;/);
  const tbApi = api.slice(api.indexOf('app.get("/trial-balance", async'), api.indexOf('app.get("/gl", async'));
  assert.match(tbApi, /const d10 = docDate\(l\.sourceType, l\.sourceId, l\.postedAt\); \/\/ by document date/);
  assert.match(tbApi, /if \(legBeforeOpening\(l\.sourceType, d10, obDateTb\)\) continue;/);
});

test("the toolbar sits on the title row; one download: Excel and Print / PDF", () => {
  const bar = tb.slice(tb.indexOf("<FinanceTitleActions>"), tb.indexOf("</FinanceTitleActions>"));
  for (const c of ["<ReportToolbar>", "<PeriodStepper", "<DetailLevels levels={[1, 2]}", "<DownloadMenu items={downloads} />"]) {
    assert.ok(bar.includes(c), c);
  }
  assert.match(tb, /label: "Export to Excel"/);
  assert.match(tb, /label: "Print \/ PDF"/);
  assert.match(tb, /company: COMPANY\.HOOKKA\.name,\n\s*print: true,/, "the PDF prints the name the frame shows");
  assert.match(tb, /company=\{COMPANY\.HOOKKA\.name\}/);
});

test("the PDF export takes a company line and falls back to a file when a pop-up is blocked", () => {
  const pdf = read("src/lib/export-report.ts");
  assert.match(pdf, /doc\.text\(opts\?\.company \?\? "HOOKKA MANUFACTURING SDN BHD", 40, 38\);/, "other reports print what they printed before");
  assert.match(pdf, /if \(window\.open\(doc\.output\("bloburl"\), "_blank"\)\) return;\n\s*\}\n\s*doc\.save\(filename\);/);
});
