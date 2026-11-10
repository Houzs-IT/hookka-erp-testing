// Monthly P&L Edit forecast, round two (owner 2026-11-10, after the first
// save from it):
//  - 「我这里无法直接填total?」 — a customer box left at 0 kept Sales locked
//    as "keyed by customer" while the figure came from the Sales box. A 0 (or
//    empty) customer box is no customer figure: Sales is typed again.
//  - 「有没有按钮可以点开全部和收起没用到的？」 → 「可以」: Open all / Close all
//    and Hide unused in the editor.
//  - 「我也要一个按钮和cash flow 一样，hide 已经过了的month」 → 「对」: Hide past
//    months on the Monthly P&L with Forecast on (view and editor alike): the
//    past months' Forecast columns go, their Actual stays, as on Cash Flow.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const imp = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const sh = await imp("src/lib/forecast-sheet.ts");
const ed = await imp("src/lib/pl-forecast-edit.ts");
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("customersKeyed: only a customer figure above 0 makes Sales the customers' total", () => {
  assert.equal(sh.customersKeyed({ salesStr: "400000", pct: {}, customers: { c1: "0.00", c2: "" } }), false, "0 and empty are no figure");
  assert.equal(sh.customersKeyed({ salesStr: "400000", pct: {}, customers: { c1: "0.01" } }), true);
  assert.equal(sh.customersKeyed({ salesStr: "", pct: {} }), false);
  assert.equal(sh.customersKeyed(undefined), false);
});

test("plPastForecastCol: a month before the current one, Forecast only — never its Actual, Accumulated or a month ahead", () => {
  const cur = "2026-11";
  assert.equal(ed.plPastForecastCol({ key: "fc:2026-10", forecast: true, accum: false, ym: "2026-10" }, cur), true);
  assert.equal(ed.plPastForecastCol({ key: "2026-10", accum: false, ym: "2026-10" }, cur), false, "the Actual stays");
  assert.equal(ed.plPastForecastCol({ key: "fc:acc", forecast: true, accum: true }, cur), false);
  assert.equal(ed.plPastForecastCol({ key: "fc:2026-11", forecast: true, accum: false, ym: "2026-11" }, cur), false, "this month stays");
  assert.equal(ed.plPastForecastCol({ key: "fc:2026-12", forecast: true, accum: false, ym: "2026-12", future: true }, cur), false);
});

test("plRowUnused: a row with no figure in any column", () => {
  assert.equal(ed.plRowUnused({ values: [0, 0, 0] }), true);
  assert.equal(ed.plRowUnused({ values: [0, -5, 0] }), false);
  assert.equal(ed.plRowUnused({ values: [] }), true);
});

const forecastPage = read("src/pages/forecast.tsx");
const editor = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");
const page = read("src/pages/accounting/index.tsx");
const tab = page.slice(page.indexOf("function MonthlyPlTab("), page.indexOf("\nfunction ", page.indexOf("function MonthlyPlTab(") + 10));

test("both pages lock Sales to the customers' total only when a customer figure exists", () => {
  assert.match(forecastPage, /const customerKeyed = \(ym: string\) => customersKeyed\(months\[ym\]\);/);
  assert.match(editor, /if \(customersKeyed\(m\)\) return figure\(/);
});

test("the editor: Open all / Close all, and Hide unused for rows and details with no figure", () => {
  assert.match(editor, /\{allOpen \? "Close all" : "Open all"\}/);
  assert.match(editor, /Hide unused/);
  assert.match(editor, /plRowUnused\(/);
  assert.match(editor, /detailUsed\(/, "a customer, supplier or department row with nothing keyed hides too");
});

test("Hide past months on the Monthly P&L view and in the editor, as on Cash Flow", () => {
  assert.match(tab, /<HidePastMonthsToggle on=\{hidePast\} onToggle=\{\(\) => setHidePast\(\(v\) => !v\)\} \/>/);
  assert.match(tab, /plPastForecastCol\(/);
  assert.match(tab, /setForecast\(\(v\) => !v\); setHidePast\(false\);/, "switching Forecast shows every month again");
  assert.match(tab, /past months' forecasts hidden/, "the note and the export say so");
  assert.match(tab, /hidePast=\{hidePast\}/, "the editor opens as the view was");
  assert.match(editor, /<HidePastMonthsToggle /);
  assert.match(editor, /plPastForecastCol\(/);
});
