import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Owner 2026-11-17 「forecast 上个月 这个月 前三个月-6个月…labor Rawmaterial 等等全部都是…
// 有些有forecast有些没有 怪怪的」: every month chart shows the same six months, and
// carries its forecast where the Forecast P&L has one.
const lib = readFileSync("src/lib/board-report.ts", "utf8");
const fin = readFileSync("src/pages/board-report/pages-finance.tsx", "utf8");

test("one window for every chart: six closed months from BOARD_DATA_FROM", () => {
  assert.match(lib, /export const CHART_MONTHS = 6;/);
  assert.match(lib, /closedMonths\(rows, month\)\.filter\(\(r\) => r\.key >= BOARD_DATA_FROM\)\.slice\(-CHART_MONTHS\)/);
  assert.doesNotMatch(lib, /\.slice\(-12\)/, "no chart keeps twelve months");
  assert.equal((lib.match(/chartMonths\(d\.rows, month\)/g) ?? []).length, 3, "labour, materials, production value");
  assert.match(lib, /actual\.slice\(-CHART_MONTHS\), \.\.\.points\.filter\(\(p\) => p\.ym > month\)/);
  assert.match(lib, /return \{ ok: true, data: \{ points: tail, summary, last3 \} \};/);
  assert.match(fin, /const cols = \[\.\.\.shown\.slice\(-6\), \.\.\.fc\];/);
});

test("labour and income charts gain their forecast line", () => {
  assert.match(lib, /const forecast = fcs\.some\(\(x\) => x !== 0\) \? sum\(fcs\) : row\.forecast\?\.labour \?\? null;/);
  assert.match(fin, /\{ key: "__fc", label: "Forecast \(all labour\)", color: C\.ink, type: "line" as const, dashed: true \}/);
  assert.match(fin, /values: \{ s: p\.sales, g: p\.gross, n: p\.net, f: p\.forecastSales \}/);
  assert.match(fin, /label: deptName\(s\)/, "department names, not codes, in the labour legend");
});
