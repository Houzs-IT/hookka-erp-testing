// Board Report batch 2 (owner 2026-11-19, investment-bank standard): action
// titles, the cash-flow waterfall and the actual-vs-forecast strip.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cashHeadline, equityHeadline, outlookHeadline, trendHeadline } from "../src/pages/board-report/headlines.ts";
import { waterfallBars } from "../src/pages/board-report/chart-math.ts";

globalThis.React = React;
const { ComboChart } = await import("../src/pages/board-report/charts.tsx");

test("trend headline: the last ACTUAL month, change on the month before, gap to forecast", () => {
  const pts = [
    { label: "Sep 26", value: 37_143_000, actual: true },
    { label: "Oct 26", value: 46_332_400, forecast: 46_500_000, actual: true },
    { label: "Nov 26", value: 60_000_000, actual: false },
  ];
  assert.equal(trendHeadline("Revenue", pts), "Revenue RM 463k in Oct 26, +24.7% on Sep 26, 0.4% below forecast");
  assert.equal(trendHeadline("Net profit", [{ label: "Aug 26", value: -10_600_000, actual: true }], { lossName: "Net loss" }), "Net loss RM 106k in Aug 26");
  assert.equal(trendHeadline("Revenue", [{ label: "Nov 26", value: 1, actual: false }]), null, "no actual month → no conclusion");
});

test("cash, equity and outlook headlines", () => {
  assert.equal(cashHeadline("Oct 26", { operating: -4_490_800, investing: -1_318_300, financing: 5_755_500, net: -203_600 }),
    "Cash fell RM 2k in Oct 26: operating −45k, investing −13k, financing +58k");
  assert.equal(equityHeadline([{ label: "Sep 26", equity: 7_000_000 }, { label: "Oct 26", equity: 11_000_000 }]), "Equity RM 110k at Oct 26 month end, +RM 40k on Sep 26");
  assert.equal(outlookHeadline([{ label: "Nov 26", sales: 60_000_000 }, { label: "Dec 26", sales: 68_000_000 }]), "Forecast revenue RM 600k in Nov 26, rising to RM 680k by Dec 26");
});

test("waterfall: a total resets the level, a step moves it", () => {
  const b = waterfallBars([{ value: 3_500_000, total: true }, { value: -4_500_000 }, { value: 5_800_000 }, { value: 4_800_000, total: true }]);
  assert.deepEqual(b.map((x) => [x.from, x.to]), [[0, 3_500_000], [3_500_000, -1_000_000], [-1_000_000, 4_800_000], [0, 4_800_000]]);
});

test("variance strip: actual months only, % vs forecast, red when worse (inverted for costs)", () => {
  const html = renderToStaticMarkup(React.createElement(ComboChart, {
    w: 600, h: 300, variance: { a: "a", f: "f", invert: true },
    data: [{ label: "Oct", values: { a: 23_900_000, f: 21_830_000 } }, { label: "Nov F", faded: true, values: { a: 1, f: 2 } }],
    series: [{ key: "a", label: "Used", color: "#2B5797", type: "bar" }, { key: "f", label: "Forecast", color: "#5B6270", type: "line", dashed: true }],
  }));
  assert.match(html, /\+9\.5%/);
  assert.match(html, /fill="#B4233C"/, "a cost above forecast is red");
  assert.doesNotMatch(html, /−50\.0%/, "the forecast month is not compared");
});

test("pages carry action titles and the cash-flow waterfall", () => {
  const fin = readFileSync("src/pages/board-report/pages-finance.tsx", "utf8");
  const biz = readFileSync("src/pages/board-report/pages-business.tsx", "utf8");
  assert.ok((fin.match(/<ChartTitle /g) ?? []).length >= 8);
  assert.ok((biz.match(/<ChartTitle /g) ?? []).length >= 4);
  assert.match(fin, /<Waterfall w=\{w\} h=\{h\} steps=\{steps\} \/>/);
  assert.match(biz, /m\.ym <= r\.month/, "the bank headline speaks of the report month, not the running one");
});

test("batch 3: the executive summary quotes the same materials % as page 4, and flags concentration", async () => {
  const { execSummary } = await import("../src/pages/board-report/headlines.ts");
  const s = execSummary({
    month: "Oct 26", prevMonth: "Sep 26",
    tiles: [
      { label: "Revenue", value: 46_332_400, prev: 37_143_000, forecast: 46_500_000 },
      { label: "Net profit", value: 9_343_600, prev: 5_205_700, forecast: 6_290_000 },
      { label: "Cash at bank, month end", value: 3_270_800, prev: 3_474_400, forecast: null },
    ],
    materials: [{ name: "PLYWOOD", spend: 3_291_100, forecast: 1_395_000 }, { name: "FABRIC", spend: 6_820_200, forecast: 5_580_000 }],
    materialsMonth: { actual: 23_913_400, forecast: 21_830_000 },
    largest: { name: "Houzs Century", pct: 71 },
  });
  assert.equal(s[0], "Revenue RM 463k (+24.7% on Sep 26, 0.4% below forecast); net profit RM 93k — 20.2% margin, +79.5% on Sep 26, 48.5% above forecast.");
  assert.equal(s[1], "Cash at bank RM 33k at Oct 26 end, −5.9% on Sep 26.");
  assert.match(s[2], /^Watch: raw materials 9\.5% above forecast, led by plywood \(\+RM 19k, \+135\.9%\)\.$/);
  assert.match(s[3], /Houzs Century is 71% of confirmed orders/);
});

test("page-4 table total uses the P&L pair (owner 2026-11-19: 22.6% -> 9.5%)", () => {
  const fin = readFileSync("src/pages/board-report/pages-finance.tsx", "utf8");
  assert.match(fin, /const fcTotal = month && typeof month\.forecast === "number" \? month\.forecast : catFc;/);
  assert.match(fin, /Forecast not split by category/);
  assert.doesNotMatch(fin, /changePct\(catSpend, fc\)/, "the old basis is gone");
});

test("cash forecast page says to read the P&L forecast (owner 2026-11-19)", () => {
  const biz = readFileSync("src/pages/board-report/pages-business.tsx", "utf8");
  assert.match(biz, /Read the P&amp;L forecast\./);
});
