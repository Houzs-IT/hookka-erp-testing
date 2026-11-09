// Monthly P&L — the Forecast beside the Actual (owner 2026-11-09 「我的 PNL
// 我也是想要把 forecast 和 live 的对比」; spec
// docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md section 6).
// The route and the page; the figures are pinned in pnl-forecast.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const slice = (src, start, end) => {
  const a = src.indexOf(start);
  assert.ok(a >= 0, start);
  return src.slice(a, src.indexOf(end, a + start.length));
};
const route = slice(api, "async function plMonthlyResponse(", "\n// Finance Overview, month by month");

test("GET /pl-monthly: the forecast only on request and for Overall; the plain view unchanged", () => {
  assert.match(route, /if \(c\.req\.query\("forecast"\) === "1" && line === "all"\) \{/);
  assert.match(route, /const matrix = buildPnlMatrix\(cols\);\n\s*return c\.json\(\{ success: true, data: \{ fyLabel: fy\.label, line, anchor: anchorYm, columns: matrix\.columns, rows: matrix\.rows \} \}\);/, "without it, exactly as before");
});

test("forecast columns: Accumulated Actual then Forecast over the same months; months ahead Forecast only; each month Actual then Forecast", () => {
  assert.match(route, /\{ key: "fc:acc", label: "Accumulated", accum: true, window: sumPnlWindowLikes\(\[\.\.\.fcMonthCols\.values\(\)\]\) \}/);
  assert.match(route, /\.\.\.cols\.flatMap\(\(col\) => \[col, \{ key: `fc:\$\{col\.key\}`/);
  assert.match(route, /if \(anchorYm === curYm\) \{/, "months ahead only on this month's view");
  assert.match(route, /ym <= addMonthsYm\(curYm, 12\)/, "twelve at most");
  assert.match(route, /buildPnlMatrix\(mcols, \{ spine, rmTypeOf \}\)/, "material types over their purchase groups");
  assert.match(route, /forecast: true, columns, rows: fm\.rows/);
});

test("the forecast reads the Forecast P&L, its line structure and where each department's wages post", () => {
  const load = slice(api, "async function loadMonthlyPlForecast(", "\n}\n");
  assert.match(load, /key = 'forecast_pnl'/);
  assert.match(load, /loadLabourDepartments\(db, orgId\)/);
  assert.match(load, /deptAccount: \(d: string\) => deptAcct\.get\(d\) \?\? null/);
  assert.doesNotMatch(load, /\b(INSERT|UPDATE|DELETE)\b/);
});

test("the page: a Forecast switch for Overall, off on every load; a month over its Actual and Forecast; forecast cells red; the drill leaves forecast columns empty", () => {
  const tab = slice(ui, "function MonthlyPlTab(", "\nfunction ");
  assert.match(tab, /const \[forecast, setForecast\] = useState\(false\);/);
  assert.match(tab, /const fcOn = forecast && line === "all";/);
  assert.match(tab, /\{line === "all" && <ForecastToggle on=\{forecast\} onToggle=\{\(\) => setForecast\(\(v\) => !v\)\} \/>\}/);
  assert.match(tab, /plMonthHeads\(cols\)\.map/);
  assert.match(tab, /\{c\.forecast \? "Forecast" : "Actual"\}/);
  assert.match(tab, /\$\{c\.forecast \? " fc" : ""\}/);
  assert.match(tab, /c\.forecast \? `\$\{c\.label\} Forecast` : c\.label/, "the export says which column is which");
  assert.match(tab, /Net profit is the Forecast P&amp;L&apos;s/, "the footnote");
  const drill = slice(ui, "function PlMonthlyDrillRows(", "\nfunction ");
  assert.match(drill, /const months = cols\.filter\(\(c\) => !c\.accum && !c\.forecast\)/);
  assert.match(drill, /c\.accum \|\| c\.forecast \|\| oldBooks\(c\.key\)/, "a forecast column never fails the tie check");
});
