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
  assert.match(tab, /\{!edit && <ForecastToggle on=\{forecast\} onToggle=\{\(\) => setForecast\(\(v\) => !v\)\} \/>\}/);
  assert.match(tab, /setCollapsed\(new Set\(\)\); setForecast\(false\);/, "Edit Layout turns the forecast off");
  // Toggle off: the statement request is exactly as before.
  assert.match(tab, /`\/api\/accounting\/cashflow-statement\?period=\$\{period\}\$\{edit \? "&editable=1" : ""\}`/);
});

test("forecast on: a month heading over Actual and Forecast; forecast cells carry the fc token; a blank month prints -", () => {
  assert.match(tab, /<tr data-row="h1">/);
  assert.match(tab, /<tr data-row="h2">/);
  assert.match(tab, /\{cfColWord\(c\)\}<\/th>/, "the second heading row names each column");
  assert.match(tab, /\$\{cols\[j\]\?\.forecast \? " fc" : ""\}/);
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
  assert.match(drill, /<span className="text-\[#C0392B\]">\{word\}<\/span>/);
  assert.match(tab, /P&amp;L forecast \(red\)<\/span>: your Forecast P&amp;L as cash\./, "the footnote says what the P&L forecast is");
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

test("the forecast colour: red on a tint, zero cells stay grey", () => {
  assert.match(css, /th\[data-cell~="fc"\] \{\n  color: #C0392B;\n  border-bottom: 1\.5px dashed #C0392B;/);
  assert.match(css, /td\[data-cell~="fc"\]:not\(\[data-zero\]\) \{\n  color: #C0392B;/);
  // Prod 2026-11-08: the two-row header rules (same specificity, later in the
  // file) overrode the heading's red and dashed rule. It must come after them.
  const fcHead = css.indexOf('> thead > tr > th[data-cell~="fc"] {');
  assert.ok(fcHead > css.indexOf('> thead > tr[data-row="h1"] > th {'), "after the h1 rule");
  assert.ok(fcHead > css.indexOf('> thead > tr[data-row="h2"] > th {'), "after the h2 rule");
});

test("Daily Cash Position: Mark paid, and the Planned payments hint", () => {
  const daily = slice("function DailyCashTab(", "\nfunction ");
  assert.match(daily, /fetch\(`\/api\/accounting\/cash-position\/planned\/\$\{p\.id\}\/paid`/);
  assert.match(daily, /body: JSON\.stringify\(\{ paid: true \}\)/);
  assert.match(daily, /money with no bill and not in Forecast P&amp;L/);
  assert.match(daily, /onClick=\{\(\) => void markPlannedPaid\(p\)\}/);
});
