// dashboard-period-keeps-scroll.test.mjs — BUG-2026-10-19-336: a period or day
// change (picker, or a click on a chart) must not scroll the dashboard to the
// top. The layout's <ScrollRestoration> resets scroll on every navigation that
// does not pass preventScrollReset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("desktop dashboard: period writes keep the scroll position", () => {
  const src = readFileSync("src/pages/dashboards/use-dashboard-url-state.ts", "utf8");
  assert.match(src, /\{ replace, preventScrollReset: replace \}/);
  assert.match(src, /const setPeriod = useCallback\(\(period: Period\) => write\(\(\) => \(\{ period \}\), true\)/);
});

test("phone dashboard: period writes keep the scroll position", () => {
  const src = readFileSync("src/pages/m/screens/dashboard/hooks.ts", "utf8");
  assert.match(src, /writePeriod\(prev, p\), \{ replace: true, preventScrollReset: true \}/);
});
