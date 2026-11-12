// ---------------------------------------------------------------------------
// hk-0149-pi-line-uom.test.mjs — a purchase-invoice line may be billed in
// another unit than its PO line (fabric ordered in ROLL, received in MTR).
// The unit is saved on the PI line only; the PO line is never written. With no
// ROLL→MTR factor in the system, such a line is left out of every quantity
// counter: the PO ceiling, PI auto stock-in, overdue / outstanding coverage.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { piLineUom, resolvePiLineUoms } from "../src/api/lib/pi-line-uom.ts";
import { planPiAutoGrn } from "../src/api/lib/pi-auto-grn.ts";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** A fake D1 that records every SQL statement it is asked to run. */
function fakeDb(poLines, variantsConfig = null) {
  const sql = [];
  return {
    sql,
    prepare(q) {
      sql.push(q);
      const stmt = {
        bind: () => stmt,
        all: async () => ({ results: /FROM purchase_order_items/.test(q) ? poLines : [] }),
        first: async () => (/kv_config/.test(q) ? { value: JSON.stringify(variantsConfig) } : null),
      };
      return stmt;
    },
  };
}

test("piLineUom: stored only when it differs from the PO line's unit", () => {
  assert.equal(piLineUom("MTR", "ROLL"), "MTR");
  assert.equal(piLineUom(" mtr ", "ROLL"), "MTR");
  assert.equal(piLineUom("ROLL", "ROLL"), null);
  assert.equal(piLineUom("roll", "Roll"), null, "case never makes a difference");
  assert.equal(piLineUom("", "ROLL"), null);
  assert.equal(piLineUom("MTR", null), null, "no PO line unit → nothing to differ from");
});

test("PI line UOM changed to MTR; the PO line (ROLL) is only read, never written", async () => {
  const db = fakeDb([{ id: "poi-1", unit: "ROLL" }]);
  const rows = [
    { uom: "MTR", poItemId: "poi-1", grnItemId: null },
    { uom: "ROLL", poItemId: "poi-1", grnItemId: null },
  ];
  const res = await resolvePiLineUoms(db, rows);
  assert.deepEqual(res, { ok: true });
  assert.equal(rows[0].uom, "MTR", "billed in MTR is kept on the PI line");
  assert.equal(rows[1].uom, null, "same unit as the PO line → null (counted as before)");
  assert.ok(db.sql.length > 0);
  for (const q of db.sql) assert.match(q.trim(), /^SELECT/i, `PO line must not be written: ${q}`);
});

test("only a PO-picked line may carry a unit; GRN and manual lines are reset", async () => {
  const db = fakeDb([{ id: "poi-1", unit: "ROLL" }]);
  const rows = [
    { uom: "MTR", poItemId: "poi-1", grnItemId: "77" }, // GRN line: invoiced_qty is in the GRN's unit
    { uom: "MTR", poItemId: null, grnItemId: null }, // manual line
  ];
  await resolvePiLineUoms(db, rows);
  assert.equal(rows[0].uom, null);
  assert.equal(rows[1].uom, null);
});

test("a unit not on the RM unit list is refused", async () => {
  const db = fakeDb([{ id: "poi-1", unit: "ROLL" }]);
  const res = await resolvePiLineUoms(db, [{ uom: "YARD", poItemId: "poi-1", grnItemId: null }]);
  assert.equal(res.ok, false);
  assert.match(res.error, /YARD/);
  const added = fakeDb([{ id: "poi-1", unit: "ROLL" }], { extraUoms: ["YARD"] });
  assert.deepEqual(await resolvePiLineUoms(added, [{ uom: "YARD", poItemId: "poi-1", grnItemId: null }]), { ok: true });
});

test("auto stock-in skips a line billed in another unit; the PO line stays open", () => {
  const po = { id: "1", poId: "po1", materialCode: "COVE-03", materialName: "Fabric", quantity: 2, receivedQty: 0, poStatus: "CONFIRMED" };
  const mtr = { id: "a", poId: "po1", poItemId: "1", materialCode: "COVE-03", qty: 50, unitPriceSen: 1500, lineType: "STOCKED", grnItemId: null, uom: "MTR" };
  const { lines, skipped } = planPiAutoGrn([mtr], [po]);
  assert.deepEqual(lines, [], "50 MTR must not be received as 50 ROLL");
  assert.deepEqual(skipped.map((s) => s.reason), ["UOM_DIFFERS"]);
  // A later invoice in the PO's own unit still receives the full 2 rolls.
  const roll = { ...mtr, id: "b", qty: 2, uom: null };
  const second = planPiAutoGrn([mtr, roll], [po]);
  assert.deepEqual(second.lines.map((l) => [l.piLineId, l.qty]), [["b", 2]]);
});

test("every quantity counter leaves a different-unit line out", () => {
  const pi = read("src/api/routes/purchase-invoices.ts");
  assert.match(pi, /qty: r\.uom \? 0 : r\.qty/, "requested qty of a different-unit line draws nothing from the PO ceiling");
  assert.match(pi, /pi\.status != 'CANCELLED' AND pii\.uom IS NULL/, "already-invoiced in checkPoRemaining");
  assert.match(pi, /ADD COLUMN IF NOT EXISTS uom TEXT/, "self-applied column");
  assert.match(read("src/api/lib/po-delivered.ts"), /AND pii\.uom IS NULL/, "overdue widget coverage");
  assert.match(read("src/api/routes/procurement-reports.ts"), /AND pii\.uom IS NULL/, "outstanding PO lines");
  assert.match(read("src/api/lib/pi-auto-grn.ts"), /pii\.uom AS "uom"/, "auto stock-in reads the unit");
});
