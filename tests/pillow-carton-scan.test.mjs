// Owner 2026-11-20 (pillow carton, step 2): scanning the carton's packing
// sticker packs every pillow of the order, and racking it racks them all.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("scan-complete packs the order's other pillows when a pillow's PACKING card completes", () => {
  const s = readFileSync("src/api/routes/production-orders.ts", "utf8");
  assert.match(s, /import \{ isPillow \} from "\.\.\/\.\.\/lib\/delivery-pipeline";/);
  assert.match(s, /async function completeCartonPillows\(/);
  assert.match(s, /jcJustCompleted &&\s*\n\s*!cartonCardDone &&\s*\n\s*\(target\.jc\.departmentCode \|\| ""\)\.toUpperCase\(\) === "PACKING" &&\s*\n\s*isPillow\(target\.po\)/);
  // re-scan of a carton whose own pillow is already done still packs the rest, before any guard
  assert.ok(s.indexOf("if (cartonCardDone) {") < s.indexOf("// Same-worker guard."));
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
  assert.match(s, /if \(!po \|\| !isPillow\(po\)\) return;/);
});

test("isPillow matches the carton's pillows, not other accessories", async () => {
  const { isPillow } = await import("../src/lib/delivery-pipeline.ts");
  assert.equal(isPillow({ productCode: "SQUARE PILLOW", productName: 'SOFA SQUARE PILLOW (16"X16")' }), true);
  assert.equal(isPillow({ productCode: "LONG PILLOW", productName: 'SOFA LONG PILLOW (12"X28")' }), true);
  assert.equal(isPillow({ productCode: "A02", productName: "ARMREST 02" }), false);
});

test("stickers already printed are not affected: a pillow with its own sticker token is left to its own scan", () => {
  const s = readFileSync("src/api/routes/production-orders.ts", "utf8");
  const fn = s.slice(s.indexOf("async function completeCartonPillows("), s.indexOf('app.post("/:id/scan-complete"'));
  assert.match(fn, /AND \(qr_token IS NULL OR qr_token = ''\)/);
  assert.ok(fn.indexOf("ensureJobCardQrTokenColumn(db)") < fn.indexOf("qr_token IS NULL"));
  const w = readFileSync("src/api/lib/packing-rack-write.ts", "utf8");
  assert.match(w, /AND \(jc\.qr_token IS NULL OR jc\.qr_token = ''\)/);
});

test("the /r/ rack page's scan-in racks the carton's riders too", () => {
  const q = readFileSync("src/api/routes/public-rack-qr.ts", "utf8");
  assert.match(q, /await rackCartonRiders\(c\.var\.DB, it\.jobCardId, rackLabel\);/);
  const w = readFileSync("src/api/lib/packing-rack-write.ts", "utf8");
  assert.match(w, /export async function rackCartonRiders\(/);
  assert.match(w, /if \(res\.ok && jobCardId\) await rackCartonRiders\(db, jobCardId, rackingNumber \?\? ""\);/);
});

test("an order's pillows ship on ONE delivery order (create, edit and packing-list-first share the check)", () => {
  const h = readFileSync("src/api/routes/delivery-orders/_helpers.ts", "utf8");
  const fn = h.slice(h.indexOf("export async function validateDoComposition("), h.indexOf("export async function createDeliveryOrderForPOs("));
  assert.match(fn, /PILLOW CARTON \(owner 2026-11-20\)/);
  assert.match(fn, /All pillows of an order go in one box, so they ship on one delivery order\./);
  // pillows already on another non-cancelled DO don't block (orders split before the rule)
  assert.match(fn, /AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM delivery_order_items di/);
});
