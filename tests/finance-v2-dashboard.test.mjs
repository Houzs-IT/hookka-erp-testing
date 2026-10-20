// ---------------------------------------------------------------------------
// finance-v2-dashboard.test.mjs — the Financial Dashboard in the v2 look (plan
// 2026-10-17-finance-v2-forecasting Task 1). Same reads and figures. A visible
// y-axis and clearer labels; the tooltip in three aligned columns — bars in
// stack order, a bold Total on stacked charts, lines under a rule and never in
// the Total; chart tabs as the v2 switch; the tables in the v2 list look with
// the period header as the table head and the first column pinned. Made-up
// figures only (the repo is public).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { chartTipRows } from "../src/lib/finance-reports.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = read("src/pages/finance-dashboard.tsx");
const css = read("src/styles/finance-v2.css");
const tip = src.slice(src.indexOf("function ChartTip("), src.indexOf("\n}\n", src.indexOf("function ChartTip(")));

test("tooltip rows: a stacked chart lists the top band first and totals the bands shown", () => {
  const payload = [
    { dataKey: "Fabric", value: 300 },
    { dataKey: "Foam", value: 200 },
    { dataKey: "Wood", value: null },
    { dataKey: "__fctotal__", value: 900 },
  ];
  const r = chartTipRows(payload, ["__fctotal__"], true);
  assert.deepEqual(r.bars.map((p) => p.dataKey), ["Wood", "Foam", "Fabric"]);
  assert.deepEqual(r.lines.map((p) => p.dataKey), ["__fctotal__"]);
  assert.equal(r.total, 500, "the forecast line is never added into the Total; a gap counts nothing");
});

test("tooltip rows: no Total for one band, or on a chart that is not stacked", () => {
  assert.equal(chartTipRows([{ dataKey: "a", value: 10 }, { dataKey: "fc", value: 12 }], ["fc"], true).total, null);
  const side = chartTipRows([{ dataKey: "inflow", value: 10 }, { dataKey: "outflow", value: 4 }, { dataKey: "net", value: 6 }], ["net"], false);
  assert.equal(side.total, null, "money in + money out is not a total");
  assert.deepEqual(side.bars.map((p) => p.dataKey), ["inflow", "outflow"], "side-by-side bars keep their order");
});

test("the tooltip: three aligned columns, the Total in bold, lines under a rule", () => {
  assert.match(tip, /const \{ bars, lines, total, counted \} = chartTipRows\(props\.payload, props\.lineKeys \?\? \[\], !!props\.stackTotal\);/);
  assert.match(tip, /grid grid-cols-\[auto_auto_auto\]/);
  assert.match(tip, /\{showTotal && row\("__total__", "Total", undefined, fmt\("Total", total\), totalShare, true\)\}/);
  assert.match(tip, /border-dashed/);
  // Which series are lines, which charts stack.
  assert.match(src, /<ChartTip shares stackTotal lineKeys=\{\["__cardfc__", "perHead", "perUnit"\]\} \/>/);
  assert.match(src, /<ChartTip lineKeys=\{line \? \[line\.key\] : \[\]\} dashKeys=\{line\?\.dashed \? \[line\.key\] : \[\]\} \/>/);
  assert.match(src, /<ChartTip shares stackTotal lineKeys=\{\["__fctotal__"\]\} \/>/);
});

test("axes: the y-axis line shows; labels 12px", () => {
  assert.doesNotMatch(src, /<YAxis[^>]*axisLine=\{false\}/, "every y-axis draws its line");
  // Since 2026-10-20 every axis takes the design's props (src/components/finance/chart-look.tsx).
  assert.equal((src.match(/<YAxis [^>]*\{\.\.\.yAxisProps\}/g) ?? []).length, 5);
  assert.doesNotMatch(src, /fontSize: 11, fill: "#6B7280"/);
});

test("chart tabs are the v2 switch", () => {
  assert.match(src, /<SegmentedSwitch label=\{title\} options=\{tabs\} value=\{active\} onChange=\{onTab\} \/>/);
});

test("the tables: v2 list look, the period header in the head, the first column pinned", () => {
  assert.equal((src.match(/<table data-fin-list data-fin-stick className="w-full">/g) ?? []).length, 7);
  assert.doesNotMatch(src, /<table className="w-full">/);
  assert.equal((src.match(/<thead>\{periodHead(Split)?\(/g) ?? []).length, 6);
  assert.doesNotMatch(src, /<tbody>\s*\{periodHead/);
  const heads = src.slice(src.indexOf("const periodHead = "), src.indexOf("\n  return (", src.indexOf("const periodHead = ")));
  assert.doesNotMatch(heads, /<td /, "the period header is header cells");
  assert.match(heads, /style=\{\{ color: "#B4452F" \}\}>Forecast<\/th>/, "the forecast column keeps its red cue (the design's #B4452F since 2026-10-20)");
  assert.match(css, /\[data-fin-ui\] table\[data-fin-list\]\[data-fin-stick\] > tbody > tr > td:first-child \{\n  position: sticky;\n  left: 0;/);
  assert.match(css, /tr:not\(\[class\*="bg-"\]\) > td:first-child \{\n  background-color: #FFFFFF;/);
});
