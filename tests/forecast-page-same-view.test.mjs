// Forecast P&L page = the Monthly P&L's Edit forecast (owner 2026-11-11, screenshot
// of the Forecast P&L page: 「这个actual purchase 会confuse」「这个forecast P&L 就
// align with montly report 那个的功能就好不就行了？就是两边都应该是一样的view等等」).
// One editor, two doors: the Forecast P&L page shows it straight away; the
// Monthly P&L opens it with Edit forecast. Each month's Actual sits beside its
// Forecast — no separate "Actual purchases" rows. What the old page could do
// and the editor could not comes with it: removing a month, arrow keys between
// the boxes, stepping the financial year.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const page = read("src/pages/forecast.tsx");
const editor = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");
const ui = read("src/pages/accounting/index.tsx");

test("the Forecast P&L page shows the Monthly P&L's Edit forecast, nothing of its own", () => {
  assert.match(page, /import \{ MonthlyPlForecastEditor \} from "@\/pages\/accounting\/monthly-pl-forecast-editor";/);
  assert.match(page, /<MonthlyPlForecastEditor\s/);
  assert.doesNotMatch(page, /Actual purchases/, "no separate actual rows");
  assert.doesNotMatch(page, /<table/, "no table of its own");
  assert.ok(!existsSync("src/lib/forecast-actuals.ts"), "the old page's actual-purchase rows' helper is gone");
  // Still a finance page with its title.
  assert.match(page, /data-fin-ui/);
  assert.match(page, /<FinancePageTitle\s/);
});

test("both doors step the financial year inside the editor; a step with unsaved changes asks first", () => {
  assert.match(editor, /period\?: \{ options: string\[\]; onChange: \(ym: string\) => void \}/);
  assert.match(editor, /<PeriodStepper value=\{anchor\} options=\{period\.options\}/);
  assert.match(editor, /if \(dirty && !\(await confirm\(\{ title: "Discard changes\?", message: "Your forecast changes are not saved\. Show another year without saving\?", danger: true \}\)\)\) return;/);
  assert.match(page, /period=\{\{ options: periodOptions, onChange: setAnchor \}\}/);
  assert.match(ui, /<MonthlyPlForecastEditor[\s\S]{0,200}period=\{\{ options: anchorOptions, onChange: setAnchor \}\}/);
});

test("Done only where there is a view to go back to (the Monthly P&L)", () => {
  assert.match(editor, /onClose\?: \(saved: boolean\) => void/);
  assert.match(editor, /\{onClose && \(\n\s*<Button size="sm" variant="outline" onClick=\{\(\) => void close\(\)\}>/);
  assert.doesNotMatch(page, /onClose=/);
});

test("a forecast month can be removed: the × asks first and the month goes on Save", () => {
  assert.match(editor, /const removeMonth = async \(ym: string\) => \{/);
  assert.match(editor, /if \(!\(await confirm\(\{ title: "Remove month\?", message: `Remove \$\{labelOfYm\(ym\)\}'s forecast\? It goes when you Save\.`, danger: true \}\)\)\) return;/);
  assert.match(editor, /onClick=\{\(\) => void removeMonth\(ym\)\}/);
  assert.match(editor, /aria-label=\{`Remove \$\{labelOfYm\(ym\)\}'s forecast`\}/);
});

test("arrow keys and Enter move between the keyed boxes, as the old page did; Up / Down never nudge a number", () => {
  assert.match(editor, /import \{ caretEdges, nextCell, type CellPos \} from "@\/lib\/grid-keys";/);
  assert.match(editor, /const onCellKey = \(e: KeyboardEvent<HTMLInputElement>\) => \{/);
  assert.match(editor, /if \(e\.key === "ArrowUp" \|\| e\.key === "ArrowDown"\) e\.preventDefault\(\);/);
  // Every box knows its column: the RM box at 2 × the column's place, the % box beside it.
  assert.match(editor, /data-fc-col=\{col\}/);
  assert.match(editor, /col=\{colOf\(c\)\}/);
  assert.match(editor, /col=\{colOf\(c\) \+ 1\}/);
});
