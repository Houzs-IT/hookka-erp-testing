// ---------------------------------------------------------------------------
// m-dashboard-anchor-month.test.mjs — BUG-2026-10-17-308.
//
// /api/accounting/dashboard also sends the months ahead that carry only a
// forecast (actual: null). The phone's Finance Dashboard (#944) anchored on
// the API's LAST row, so on prod it showed "—" for the running month, charted
// four future months with no actuals, and gave the cash card of a month with
// no books. It now anchors on the latest month with actual figures and charts
// the four months ending there. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { dashAnchorIndex, dashMonthLabel, phoneDashMonths } from "../src/pages/m/screens/finance/m-finance-lib.ts";

const ROWS = [
  { key: "2026-07", actual: { sales: 100 } },
  { key: "2026-08", actual: { sales: 200 } },
  { key: "2026-09", actual: { sales: 300 } },
  { key: "2026-10", actual: { sales: 150 }, partial: true },
  { key: "2026-11", actual: null },
  { key: "2026-12", actual: null },
];

test("BUG-308: the anchor is the latest month with actuals, not the last row", () => {
  assert.equal(dashAnchorIndex(ROWS), 3);
  assert.equal(dashAnchorIndex(ROWS.slice(0, 4)), 3);
  assert.equal(dashAnchorIndex([{ key: "2027-01", actual: null }]), -1, "no actuals at all");
  assert.equal(dashAnchorIndex([]), -1);
});

test("BUG-308: the screen charts the four months ending at the anchor and names them", () => {
  const src = readFileSync("src/pages/m/screens/finance/DashScreen.tsx", "utf8").replace(/\r\n/g, "\n");
  // Since 2026-10-20 (the owner's phone design): the last four months that
  // happened — the same guarantee, through the desktop's period rule.
  assert.match(src, /const months = phoneDashMonths\(rows\);/);
  assert.match(src, /const last = sel >= 0 \? months\[sel\] : undefined;/);
  assert.doesNotMatch(src, /rows\[rows\.length - 1\]|rows\.slice\(-4\)/, "never the API's last rows");
  const rows = ["2026-07", "2026-08", "2026-09", "2026-10"].map((key) => ({ key, actual: { sales: 1 } }))
    .concat(["2026-11", "2026-12"].map((key) => ({ key, actual: null })));
  assert.deepEqual(phoneDashMonths(rows).map((r) => r.key), ["2026-07", "2026-08", "2026-09", "2026-10"], "the forecast-only months ahead are never shown");
  assert.equal(dashMonthLabel("2026-10", true), "Oct 2026");
  assert.equal(dashMonthLabel("2026-10", false), "Oct");
  assert.equal(dashMonthLabel("2026-Q4", true), "2026-Q4", "a quarter key stays as it is");
});
