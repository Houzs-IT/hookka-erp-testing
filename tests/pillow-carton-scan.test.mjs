// Owner 2026-11-20 (pillow carton, step 2): scanning the carton's packing
// sticker packs every pillow of the order, and racking it racks them all.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("scan-complete packs the order's other pillows when a pillow's PACKING card completes", () => {
  const s = readFileSync("src/api/routes/production-orders.ts", "utf8");
  assert.match(s, /import \{ isPillow \} from "\.\.\/\.\.\/lib\/delivery-pipeline";/);
  assert.match(s, /async function completeCartonPillows\(/);
  assert.match(s, /jcJustCompleted &&\s*\n\s*\(target\.jc\.departmentCode \|\| ""\)\.toUpperCase\(\) === "PACKING" &&\s*\n\s*isPillow\(target\.po\)/);
  const fn = s.slice(s.indexOf("async function completeCartonPillows("), s.indexOf('app.post("/:id/scan-complete"'));
  // leaves done / blocked / cancelled cards and held / cancelled orders alone
  assert.match(fn, /status NOT IN \('COMPLETED','TRANSFERRED','BLOCKED','CANCELLED'\)/);
  assert.match(fn, /status NOT IN \('CANCELLED','ON_HOLD'\)/);
  // each card goes through the normal completion side effects
  for (const call of ["recordScanEvents(", "applyWipInventoryChange(", "postJobCardLabor(", "recomputePoStatusAndProgress(", "postProductionOrderCompletion(", "cascadePoCompletionToSO("]) {
    assert.ok(fn.includes(call), `fan-out runs ${call}`);
  }
  assert.ok(fn.indexOf("ensureJobCardCompletedAt(db)") < fn.indexOf("UPDATE job_cards"));
});

test("racking a pillow carton racks the order's other pillow PACKING cards, single-card for the extras", () => {
  const s = readFileSync("src/api/lib/packing-rack-write.ts", "utf8");
  assert.match(s, /export async function applyPackingRack\(/);
  assert.match(s, /async function applyPackingRackOne\(/);
  assert.match(s, /await applyPackingRackOne\(db, s\.cardId, rackingNumber, null\);/);
  assert.match(s, /if \(!po \|\| !isPillow\(po\)\) return res;/);
});

test("isPillow matches the carton's pillows, not other accessories", async () => {
  const { isPillow } = await import("../src/lib/delivery-pipeline.ts");
  assert.equal(isPillow({ productCode: "SQUARE PILLOW", productName: 'SOFA SQUARE PILLOW (16"X16")' }), true);
  assert.equal(isPillow({ productCode: "LONG PILLOW", productName: 'SOFA LONG PILLOW (12"X28")' }), true);
  assert.equal(isPillow({ productCode: "A02", productName: "ARMREST 02" }), false);
});
