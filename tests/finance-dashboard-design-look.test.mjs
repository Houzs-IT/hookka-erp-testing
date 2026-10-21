// ---------------------------------------------------------------------------
// finance-dashboard-design-look.test.mjs — the Financial Dashboard as the
// owner's design draws it (owner 2026-10-20 「先把dashboard 那边做好，就是我
// 设计稿那边的动画，颜色，曲线等等」): the design's categorical palette, its
// chart (warm-grey axes, a faint grid, bars rounded 3 that ease over half a
// second, the pointed period lifting while the others fade, hollow dots on
// smooth lines, forecasts red and dashed 6 / 4), only the periods that have
// happened, 6 months by default from July, or 12. Made-up rows.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
const look = await import(pathToFileURL(resolve(process.cwd(), "src/lib/finance-chart-look.ts")).href);
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const page = read("src/pages/finance-dashboard.tsx");
const chart = read("src/components/finance/chart-look.tsx");

test("the design's palette (Categorical)", () => {
  assert.deepEqual({ ...look.CH }, {
    actual: "#5FA8A0", fc: "#D9534F", teal: "#2F6E7C", green: "#2F7A3B", out: "#E07A5F",
    in: "#7FB7BE", liab: "#BDB6AA", net: "#1F2A44", single: "#5FA8A0", assets: "#5FA8A0",
  });
  assert.deepEqual([...look.CS_COLOURS], [
    "#5B7BA6", "#8E7DBE", "#7FB7BE", "#F2B880", "#81B29A", "#B5838D",
    "#98C1D9", "#F4D35E", "#9A8C98", "#D4A373", "#C9ADA7", "#5FA8D3",
  ]);
  assert.equal(look.FORECAST_DASH, "6 4");
  assert.equal(look.CHART_MS, 500);
});

const months = (yms, ahead = []) => [
  ...yms.map((key) => ({ key, actual: { sales: 1 } })),
  ...ahead.map((key) => ({ key, actual: null })),
];

test("only the periods that have happened; 6 months from July by default, or 12", () => {
  const rows = months(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], ["2026-11", "2026-12"]);
  const keys = (r) => r.map((x) => x.key);
  assert.deepEqual(keys(look.dashPeriods(rows, { span: 6, granularity: "month", explicit: false })), ["2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(keys(look.dashPeriods(rows, { span: 12, granularity: "month", explicit: false })), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(keys(look.dashPeriods(rows, { span: 6, granularity: "month", explicit: true })), keys(rows).slice(0, 6), "a range shows all of its months that happened");
  // A year on, the six roll: the oldest drops off as a month arrives.
  const later = months(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(keys(look.dashPeriods(later, { span: 6, granularity: "month", explicit: false })), ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
  // Quarters: 6 months = 2 quarters, 12 = 4; a quarter starts in its first month.
  const qs = months(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  assert.equal(look.periodStartYm("2026-Q3"), "2026-07");
  assert.deepEqual(keys(look.dashPeriods(qs, { span: 6, granularity: "quarter", explicit: false })), ["2026-Q3", "2026-Q4"]);
  assert.deepEqual(keys(look.dashPeriods(qs, { span: 12, granularity: "quarter", explicit: false })), ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  // Nothing from July yet: the latest months that happened, never an empty view.
  assert.deepEqual(keys(look.dashPeriods(months(["2026-05", "2026-06"]), { span: 6, granularity: "month", explicit: false })), ["2026-05", "2026-06"]);
});

test("the chart pieces: axes and grid, a bar that lifts while the rest fade, hollow dots", () => {
  assert.match(chart, /export const gridProps = \{ stroke: AXIS\.grid, vertical: false \} as const;/);
  assert.match(chart, /axisLine: \{ stroke: AXIS\.line \},\n  tickLine: \{ stroke: AXIS\.line \},\n  tickSize: 4,/);
  assert.match(chart, /export const anim = \{ isAnimationActive: true, animationDuration: CHART_MS, animationEasing: "ease-out" \} as const;/);
  assert.match(chart, /opacity: dim \? 0\.45 : 1,\n\s+transform: me \? "translateY\(-4px\)" : "none",\n\s+filter: me \? "drop-shadow\(0 4px 6px rgba\(31,42,68,\.22\)\)" : "none",/);
  assert.match(chart, /rx=\{3\}\n\s+ry=\{3\}/);
  assert.match(chart, /stroke=\{opts\.stacked \? "#FFFFFF" : "none"\}/);
  assert.match(chart, /export const dotOf = \(color: string\) => \(\{ r: 3, fill: "#FFFFFF", stroke: color, strokeWidth: 2 \}\);/);
  assert.match(chart, /export const activeDotOf = \(color: string\) => \(\{ r: 5, fill: color, stroke: color, strokeWidth: 2 \}\);/);
});

test("every chart on the page uses them; the cards' colours are the design's", () => {
  assert.doesNotMatch(page, /const (GOLD|RUST|TEAL|CS_COLOURS) = /, "no page-local palette left");
  const bars = page.match(/<Bar [\s\S]*?(\/>|>)/g) ?? [];
  assert.ok(bars.length >= 4);
  for (const b of bars) assert.match(b, /shape=\{liftBar\([^)]*\)\} \{\.\.\.anim\}/, b);
  const lines = page.match(/<Line[\s\S]*?\/>/g) ?? [];
  assert.ok(lines.length >= 4);
  for (const l of lines) {
    assert.match(l, /type="monotone"/, l);
    assert.match(l, /dot=\{dotOf\(/, l);
    assert.match(l, /\{\.\.\.anim\}/, l);
  }
  assert.equal((page.match(/<Tooltip cursor=\{false\}/g) ?? []).length, (page.match(/<Tooltip /g) ?? []).length, "no grey hover block");
  assert.match(page, /bars=\{\[\{ key: "actual", name: "Actual", color: CH\.actual \}\]\}\n\s+line=\{\{ key: "forecast", name: "Forecast", color: CH\.fc, dashed: true \}\}/);
  assert.match(page, /bars=\{\[\{ key: "inflow", name: "Money in", color: CH\.in \}, \{ key: "outflow", name: "Money out", color: CH\.out \}\]\}\n\s+line=\{\{ key: "net", name: "Net change", color: CH\.net \}\}/);
  assert.match(page, /\{ key: "assets", name: "Total assets", color: CH\.assets \},\n\s+\{ key: "liabilities", name: "Total liabilities", color: CH\.liab \},/);
  assert.match(page, /line=\{\{ key: "debtPct", name: "Debt to assets %", color: CH\.net, axis: "right" \}\}/);
  assert.match(page, /color: CH\.single \}\]\}/);
  assert.match(page, /dataKey="perHead" name="RM \/ head" stroke=\{CH\.teal\}/);
  assert.match(page, /dataKey="perUnit" name="RM \/ unit" stroke=\{CH\.green\}/);
});

test("the periods: 6 / 12 months beside the range, every card reads the shown periods", () => {
  assert.match(page, /const \[span, setSpan\] = useState<DashSpan>\(6\);/);
  assert.match(page, /dashPeriods\(rows \?\? \[\], \{ span, granularity, explicit: explicitRange \}\)/);
  assert.match(page, /\(\[6, 12\] as const\)\.map\(\(n, i\) => \{/);
  assert.doesNotMatch(page, /\(rows \?\? \[\]\)\.map\(/, "no card reads the unfiltered rows");
  // "vs last period" still compares with the month before, shown or not.
  assert.match(page, /const at = all\.indexOf\(r\);\n\s+const prev = at > 0 \? all\[at - 1\]\.actual : null;/);
});

test("months read as the design labels them", () => {
  assert.equal(look.dashPeriodLabel("2026-07", false), "Jul 2026");
  assert.equal(look.dashPeriodLabel("2026-09", false), "Sep 2026");
  assert.equal(look.dashPeriodLabel("2026-10", true), "Oct 2026 *");
  assert.equal(look.dashPeriodLabel("2026/Q3", true), "2026/Q3 *");
  assert.doesNotMatch(page, /r\.label \+ \(r\.partial \? " \*" : ""\)/, "every card names its periods the one way");
  assert.equal((page.match(/dashPeriodLabel\(r\.label, r\.partial\)/g) ?? []).length, 7);
});

test("motion: the dashboard's switches are the design's pills; revealed rows fade in", () => {
  assert.match(page, /<SegmentedSwitch tone="pill" label="Cost measure"/);
  assert.match(page, /<SegmentedSwitch tone="pill" label="Product line"/);
  assert.match(page, /<SegmentedSwitch tone="pill" label="Cash flow view"/);
  const shell = read("src/components/finance/report-shell.tsx");
  assert.match(shell, /rounded-\[9px\] border border-\[#E5E7EB\] bg-\[#F3F4F6\] p-\[3px\]/, "the grey track");
  assert.match(shell, /bg-white font-semibold text-\[#111827\] shadow-\[0_1px_2px_rgba\(17,24,39,\.10\),0_0_0_1px_rgba\(17,24,39,\.06\)\]/, "the chosen one a white pill");
  assert.equal((page.match(/data-fin-reveal=""/g) ?? []).length, 2);
  assert.match(read("src/styles/finance-v2.css"), /\[data-fin-ui\] \[data-fin-reveal\] \{\n  animation: fin-reveal \.18s ease-out;\n\}/);
  assert.match(read("src/index.css"), /@keyframes fin-reveal \{\n  from \{ opacity: 0; transform: translateY\(-3px\); \}\n  to \{ opacity: 1; transform: none; \}\n\}/);
});
