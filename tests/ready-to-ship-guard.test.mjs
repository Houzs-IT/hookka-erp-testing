// BUG-2026-10-17 — production completion pulled shipped / invoiced orders back
// to READY_TO_SHIP. src/api/lib/ready-to-ship-guard.ts is the forward-only rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAdvanceToReadyToShip, READY_TO_SHIP_FROM_SQL, correctedReadyToShipStatus } from "../src/api/lib/ready-to-ship-guard.ts";

test("only the production stages move forward to READY_TO_SHIP", () => {
  for (const s of ["CONFIRMED", "IN_PRODUCTION", "in_production"]) assert.equal(canAdvanceToReadyToShip(s), true, s);
  for (const s of ["SHIPPED", "DELIVERED", "INVOICED", "CLOSED", "ON_HOLD", "CANCELLED", "READY_TO_SHIP", "DRAFT", null, undefined, ""]) {
    assert.equal(canAdvanceToReadyToShip(s), false, String(s));
  }
  assert.equal(READY_TO_SHIP_FROM_SQL, "status IN ('CONFIRMED', 'IN_PRODUCTION')");
});

test("every production-completion cascade uses the guard (SO and CO, both paths)", () => {
  const src = readFileSync(new URL("../src/api/routes/production-orders/_helpers.ts", import.meta.url), "utf8");
  // The old backsliding test, `status !== "READY_TO_SHIP"` before a forward
  // UPDATE, must not come back.
  // (`… !== "READY_TO_SHIP") return;` is the legitimate rollback guard.)
  assert.equal(/(so|co)\.status !== "READY_TO_SHIP"\) \{/.test(src), false);
  const guarded = src.match(/SET status = 'READY_TO_SHIP', updated_at = \? WHERE id = \? AND \$\{READY_TO_SHIP_FROM_SQL\}/g) ?? [];
  assert.equal(guarded.length, 4);
});

test("dispatch ships an SO still in production", () => {
  const src = readFileSync(new URL("../src/api/routes/delivery-orders/_helpers.ts", import.meta.url), "utf8");
  assert.match(src, /\["READY_TO_SHIP", "IN_PRODUCTION", "CONFIRMED"\]\.includes\(soRow\.status\)/);
});

test("repair: a stuck READY_TO_SHIP SO gets the status its own documents prove", () => {
  assert.equal(correctedReadyToShipStatus(["PAID", "PAID"], ["DELIVERED"]).to, "CLOSED");
  assert.equal(correctedReadyToShipStatus(["PAID", "SENT"], []).to, "INVOICED");
  assert.equal(correctedReadyToShipStatus([], ["DELIVERED", "DELIVERED"]).to, "DELIVERED");
  assert.equal(correctedReadyToShipStatus([], ["DELIVERED", "LOADED"]).to, "SHIPPED");
  assert.deepEqual(correctedReadyToShipStatus([], ["DELIVERED", "IN_STOCK"]), { to: null, why: "part shipped" });
  assert.deepEqual(correctedReadyToShipStatus([], ["IN_STOCK"]), { to: null, why: "goods still in the warehouse" });
  assert.deepEqual(correctedReadyToShipStatus([], []), { to: null, why: "no finished-goods units" });
});
