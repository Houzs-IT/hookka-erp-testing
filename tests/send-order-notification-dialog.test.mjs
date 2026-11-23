// HK-0170: the Send Notification dialog showed no workers and no ERP users.
// Its loader effect depended on depts.length, so setting the departments
// re-ran the effect, whose cleanup cancelled the same load before the worker
// and ERP-user lists were set. The loader must run once, on open.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("src/pages/production/components/SendOrderNotificationDialog.tsx", "utf8");

test("the recipient loader runs once and does not depend on its own results", () => {
  const effect = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("const shownPeople"));
  assert.match(effect, /fetch\("\/api\/workers"\)/);
  assert.match(effect, /fetch\("\/api\/announcements\/erp-users"\)/);
  assert.match(effect, /\}, \[\]\);/, "deps must be [] - a dep the loader itself sets cancels the load");
  assert.doesNotMatch(effect, /depts\.length/);
});
