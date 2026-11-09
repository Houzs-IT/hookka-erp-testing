import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/sales/detail.tsx", "utf8");
const api = readFileSync("src/api/routes/sales-orders.ts", "utf8");

// The server locks an IN_PRODUCTION SO once any job card leaves WAITING and
// answers reason "production_started". The page used to drop the Edit button
// with no explanation for that reason.
test("the page explains a production_started lock: banner + disabled Edit", () => {
  assert.match(api, /reason: "production_started"/);
  assert.match(page, /eligibilityResp\?\.reason === "production_started"/);
  assert.match(page, /!canEdit && productionStartedLocked && \(/);
  assert.match(page, /lockReason \?\? \(productionStartedLocked \? productionStartedReason/);
});
