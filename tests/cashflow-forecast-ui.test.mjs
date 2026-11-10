// Cash Flow forecast — the page (spec:
// docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md 3 and 6.3).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const css = read("src/styles/finance-v2.css");
const slice = (start, end) => {
  const a = ui.indexOf(start);
  assert.ok(a >= 0, start);
  return ui.slice(a, ui.indexOf(end, a + start.length));
};
const tab = slice("function CashFlowTab(", "\nfunction ");

test("the toggle is off on every load, never in Edit, and fetches the forecast only when on", () => {
  assert.match(tab, /const \[forecast, setForecast\] = useState\(false\);/);
  assert.match(tab, /const fcOn = forecast && !edit;/);
  assert.match(tab, /fcOn \? `\/api\/accounting\/cashflow-forecast\?period=\$\{period\}` : null/);
  assert.match(tab, /\{!edit && <ForecastToggle on=\{forecast\} onToggle=\{\(\) => \{ setForecast\(\(v\) => !v\); setHidePast\(false\); \}\} \/>\}/);
  assert.match(tab, /setCollapsed\(new Set\(\)\); setForecast\(false\);/, "Edit Layout turns the forecast off");
  // Toggle off: the statement request is exactly as before.
  assert.match(tab, /`\/api\/accounting\/cashflow-statement\?period=\$\{period\}\$\{edit \? "&editable=1" : ""\}`/);
});

test("forecast on: a month heading over Actual and Forecast; forecast cells carry the fc token; a blank month prints -", () => {
  assert.match(tab, /<tr data-row="h1">/);
  assert.match(tab, /<tr data-row="h2">/);
  assert.match(tab, /\{cfColWord\(c\)\}<\/th>/, "the second heading row names each column");
  assert.match(tab, /\$\{cfColTok\(cols\[j\]\)\}/, "a forecast cell carries its kind's token");
  assert.match(tab, /\{blank \? "-" : fmt\(v\)\}/);
  assert.match(tab, /Could not load the forecast/);
  assert.match(tab, /No forecast for this period\./);
  assert.match(tab, /Term blank or unreadable, taken as 1 month:/);
});

test("a footnote names the opening-period customer receipts left out of the netting", () => {
  assert.match(tab, /fcData\.openingCredits && \(/);
  assert.match(tab, /\(opening period\) are not netted/);
});

test("Capex & financing: a button with the forecast on opens a twelve-month table that saves the keyed amounts", () => {
  assert.match(tab, /\{fcOn && \(\s*<Button[^>]*onClick=\{\(\) => setInputsOpen\(true\)\}[^>]*>\s*Capex &amp; financing\s*<\/Button>\s*\)\}/);
  assert.match(tab, /\{inputsOpen && <CfForecastInputsDialog /);
  assert.match(tab, /invalidateCachePrefix\("\/api\/accounting\/cashflow-forecast"\)/, "a save refreshes the forecast");
  const dlg = slice("function CfForecastInputsDialog(", "\nfunction ");
  assert.match(dlg, /fetch\("\/api\/accounting\/cashflow-forecast-inputs", \{ cache: "no-store" \}\)/);
  assert.match(dlg, /method: "PUT"/);
  assert.match(dlg, /KEYED_MONTHS/);
  assert.match(dlg, /<MoneyInput/);
  assert.match(dlg, /Money in \+, money out −/);
  assert.match(dlg, /Forecast only/);
  assert.match(dlg, /Planned payments/, "says not to key the same money twice");
});

test("Capex & financing: every account is a row from the start, nothing to pick one by one; the month heading stays while scrolling", () => {
  const dlg = slice("function CfForecastInputsDialog(", "\nfunction ");
  assert.match(dlg, /keyedInputGroups\(accounts, months\)/);
  assert.doesNotMatch(dlg, /Add an account/);
  assert.doesNotMatch(dlg, /<select/);
  assert.match(dlg, /clearKeyedCode\(/, "a row's clear goes through the tested helper");
  assert.match(dlg, /sticky top-0/, "the month heading");
});

test("Capex & financing: one scrollbar — the popup body makes room and the table scrolls inside it", () => {
  const dlg = slice("function CfForecastInputsDialog(", "\nfunction ");
  assert.match(dlg, /<DocDetailModal[^>]*?\bxwide\s+fill\b/);
  assert.match(dlg, /<div className="flex min-h-0 flex-col">\s*<div className="min-h-0 overflow-auto">/, "the card shrinks to the room left; its table scrolls");
  assert.doesNotMatch(dlg, /max-h-\[calc\(/, "no guessed height: at 1236×661 it left the body 5 px to scroll too (prod 2026-11-09)");
});

test("three columns a month: Actual, Docs forecast, P&L forecast — in the headings, the export and the drill (spec 2026-11-09 section 2)", () => {
  assert.match(ui, /const cfColWord = \(c: CfApiCol\): string => \(!c\.forecast \? "Actual" : c\.forecastKind === "pnl" \? "P&L forecast" : "Docs forecast"\);/);
  assert.match(tab, /`\$\{c\.label\} \$\{cfColWord\(c\)\}`/, "the export says which column is which");
  const drill = slice("function CfForecastDrillRows(", "\nfunction ");
  assert.match(drill, /word: cfColWord\(c\)/);
  assert.match(drill, /<span className=\{wordCls\}>\{word\}<\/span>/);
  assert.match(tab, /P&amp;L forecast \(purple\)<\/span>: your Forecast P&amp;L as cash\./, "the footnote says what the P&L forecast is");
  assert.match(tab, /Docs forecast \(blue\)<\/span>/);
});

test("Capex & financing: a Trade finance block per facility — a Drawdown row, tenor and interest, Fill from bills, and the worked-out rows", () => {
  const dlg = slice("function CfForecastInputsDialog(", "\nfunction ");
  assert.match(dlg, /tfFacilities\.map\(\(f\) => \{/);
  assert.match(dlg, /tfPlanSchedule\(\{ \.\.\.inp, plan: p\.months \}\)/);
  assert.match(dlg, /fillTfFromBills\(\{ \.\.\.inp, billsDue: f\.billsDue \}\)/);
  for (const w of ["Fill from bills", "Drawdown", "Interest (est.)", "Repayment", "Owed at month end", "Room left", "% per draw"]) assert.ok(dlg.includes(w), w);
  assert.match(dlg, /body: JSON\.stringify\(\{ months, \.\.\.\(tfFacilities\.length \? \{ tf \} : \{\}\) \}\)/, "saved with the keyed amounts, facilities only");
});

test("a keyed amount reads in the forecast drill as who keyed it and that nothing was posted", () => {
  const drill = slice("function CfForecastDrillRows(", "\nfunction ");
  assert.match(drill, /it\.kind === "pnl" \|\| it\.kind === "input"/);
});

test("the drill: forecast items under the line; the payment drill keeps out of forecast columns", () => {
  assert.match(tab, /<CfForecastDrillRows sources=\{fcData\.forecastSources\?\.\[r\.lineKey\]\} cols=\{cols\} depth=\{r\.depth\} \/>/);
  const drill = slice("function CfMonthlyDrillRows(", "\nfunction ");
  assert.match(drill, /const months = cols\.filter\(\(c\) => !c\.accum && !c\.forecast\)/, "the GL link spans actual months only");
  assert.match(drill, /const on = !c\.forecast && \(c\.accum \|\| c\.key === it\.ym\);/);
  assert.match(drill, /if \(c\.forecast\) return <td key=\{c\.key\} data-cell=\{`num split\$\{acc\(c\)\}`\} \/>;/);
});

test("forecast colours: no red (owner 2026-11-09 「红色对我来说是 negative」); Docs forecast on blue, P&L forecast on lavender (「background colour 要不一样」)", () => {
  assert.doesNotMatch(css, /data-cell~="fc"\][^{]*\{[^}]*#C0392B/, "no forecast red, in a cell or a heading");
  assert.match(css, /> tbody > tr > td\[data-cell~="fc"\] \{\n  background-color: #EEF4FB;\n\}/);
  assert.match(css, /> tbody > tr > td\[data-cell~="fp"\] \{\n  background-color: #F3EFFA;\n\}/);
  assert.ok(css.indexOf('td[data-cell~="fp"] {') > css.indexOf('td[data-cell~="fc"] {'), "a P&L cell carries both tokens: lavender after blue, so it wins");
  // The figures read like any other: a negative keeps the report's own
  // negative colour (data-neg), a zero stays pale (data-zero).
  assert.doesNotMatch(css, /td\[data-cell~="(fc|fp)"\]:not\(\[data-zero\]\)/);
  assert.match(css, /th\[data-cell~="fc"\] \{\n  color: #2F5F9E;\n  border-bottom: 1\.5px dashed #2F5F9E;/);
  assert.match(css, /th\[data-cell~="fp"\] \{\n  color: #6B4FA0;\n  border-bottom: 1\.5px dashed #6B4FA0;/);
  // Prod 2026-11-08: the two-row header rules (same specificity, later in the
  // file) overrode the heading's rule. The forecast headings come after them.
  const fcHead = css.indexOf('> thead > tr > th[data-cell~="fc"] {');
  assert.ok(fcHead > css.indexOf('> thead > tr[data-row="h1"] > th {'), "after the h1 rule");
  assert.ok(fcHead > css.indexOf('> thead > tr[data-row="h2"] > th {'), "after the h2 rule");
  assert.ok(css.indexOf('> thead > tr > th[data-cell~="fp"] {') > fcHead, "the P&L heading after the Docs one");
  assert.match(ui, /const cfColTok = \(c: \{ forecast\?: boolean; forecastKind\?: string \} \| undefined\): string => \(!c\?\.forecast \? "" : c\.forecastKind === "pnl" \? " fc fp" : " fc"\);/);
});

test("forecast colours run down to the totals: a subtotal or result row keeps its kind's colour, a shade deeper (prod 2026-11-09: Cash Surplus / (Deficit) printed both forecasts on the row's beige)", () => {
  // The row kinds' own fill (sub, res) sat at the same specificity after the
  // plain tint and won, so on the row the owner reads most the two forecasts
  // looked alike. One more attribute in the selector wins over the row kind
  // whatever the order; a P&L cell carries both tokens, so its rule comes after
  // the Docs one.
  const rule = (row, tok, bg) => new RegExp(`> tbody > tr\\[data-row="${row}"\\] > td\\[data-cell~="${tok}"\\] \\{\\n  background-color: ${bg};\\n\\}`);
  assert.match(css, rule("sub", "fc", "#E2EBF6"));
  assert.match(css, rule("sub", "fp", "#EAE4F6"));
  assert.match(css, rule("res", "fc", "#D7E3F2"));
  assert.match(css, rule("res", "fp", "#E1D8F1"));
  for (const row of ["sub", "res"]) {
    const fc = css.indexOf(`tr[data-row="${row}"] > td[data-cell~="fc"] {`);
    const fp = css.indexOf(`tr[data-row="${row}"] > td[data-cell~="fp"] {`);
    assert.ok(fc >= 0 && fp > fc, `${row}: lavender after blue`);
  }
});

test("Hide past months (owner 2026-11-10 「先按 forecasting，然后再按不显示 past month」, then 「是把 docs forecast 和 P&L forecast hide 起来，actual 要 remain」): with the forecast on only; the past months' two forecast columns go, their Actual stays, Accumulated and the rest stay; the export follows; any press of Forecast shows them again", () => {
  assert.match(tab, /const \[hidePast, setHidePast\] = useState\(false\);/, "off on every load");
  assert.match(tab, /\{fcData && pastMonths && <HidePastMonthsToggle on=\{hidePast\} onToggle=\{\(\) => setHidePast\(\(v\) => !v\)\} \/>\}/, "only beside a forecast that has past months");
  // Which columns go: a forecast column of a month before the statement's
  // own. Never an Actual column, never Accumulated.
  assert.match(ui, /const pastForecastCol = \(c: CfApiCol, period: string\): boolean => !c\.accum && !!c\.forecast && !!c\.ym && c\.ym < period;/);
  assert.match(tab, /const pastMonths = !!fcData && fcData\.columns\.some\(\(c\) => pastForecastCol\(c, period\)\);/);
  assert.match(tab, /if \(pastForecastCol\(c, period\)\) s\.add\(i\);/);
  assert.doesNotMatch(tab, /if \(!c\.accum && c\.ym && c\.ym < period\) s\.add\(i\);/, "the first build hid the whole month, Actual too");
  assert.match(tab, /const cols: CfApiCol\[\] = hiddenIdx \? allCols\.filter\(\(_, i\) => !hiddenIdx\.has\(i\)\) : allCols;/);
  assert.match(tab, /hiddenIdx \? allRows\.map\(\(r\) => \(\{ \.\.\.r, values: r\.values\.filter\(\(_, i\) => !hiddenIdx\.has\(i\)\) \}\)\) : allRows/, "every row loses the same columns");
  // The export and print read the same cols and rows the screen does.
  const at = tab.indexOf("const buildExport = (): Aoa => {");
  assert.ok(at >= 0, "Cash Flow's own export");
  const exp = tab.slice(at, tab.indexOf("\n  };", at));
  assert.match(exp, /cols\.map\(/);
  assert.match(exp, /for \(const r of cleanRows\)/);
  assert.match(tab, /past months' forecasts hidden/, "the note and the printout say so");
  const shell = read("src/components/finance/report-shell.tsx");
  assert.match(shell, /export function HidePastMonthsToggle\(\{ on, onToggle \}: \{ on: boolean; onToggle: \(\) => void \}\)/);
});

test("Daily Cash Position: Mark paid, and the Planned payments hint", () => {
  const daily = slice("function DailyCashTab(", "\nfunction ");
  assert.match(daily, /fetch\(`\/api\/accounting\/cash-position\/planned\/\$\{p\.id\}\/paid`/);
  assert.match(daily, /body: JSON\.stringify\(\{ paid: true \}\)/);
  assert.match(daily, /money with no bill and not in Forecast P&amp;L/);
  assert.match(daily, /onClick=\{\(\) => void markPlannedPaid\(p\)\}/);
});
