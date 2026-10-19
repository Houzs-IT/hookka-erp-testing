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
import { dashAnchorIndex, dashMonthLabel } from "../src/pages/m/screens/finance/m-finance-lib.ts";

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
  assert.match(src, /const at = dashAnchorIndex\(rows\);\n\s*const last = at >= 0 \? rows\[at\] : undefined;/);
  assert.match(src, /rows\.slice\(Math\.max\(0, at - 3\), at \+ 1\)/);
  assert.doesNotMatch(src, /rows\[rows\.length - 1\]|rows\.slice\(-4\)/, "never the API's last rows");
  assert.equal(dashMonthLabel("2026-10", true), "Oct 2026");
  assert.equal(dashMonthLabel("2026-10", false), "Oct");
  assert.equal(dashMonthLabel("2026-Q4", true), "2026-Q4", "a quarter key stays as it is");
});
