// ---------------------------------------------------------------------------
// hk-0149-pi-line-uom.test.mjs — a purchase-invoice line may be billed in
// another unit than its PO line (fabric ordered in ROLL, received in MTR).
// The unit is saved on the PI line only; the PO line is never written. With no
// ROLL→MTR factor (Violet 2026-11-12: every roll has different metres), such
// a line also says how many PO units it covers (po_qty): the PO ceiling and
// the PO line's receivedQty count po_qty, and stock receives the metres.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { piLineUom, piLinePoQty, resolvePiLineUoms } from "../src/api/lib/pi-line-uom.ts";
import { planPiAutoGrn, buildPiGrnLinkStatements } from "../src/api/lib/pi-auto-grn.ts";
import { checkPoRemaining } from "../src/api/routes/purchase-invoices.ts";

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

test("piLinePoQty: only with a unit of its own; blank or bad covers nothing", () => {
  assert.equal(piLinePoQty(null, 2), null);
  assert.equal(piLinePoQty("MTR", 2), 2);
  assert.equal(piLinePoQty("MTR", undefined), 0);
  assert.equal(piLinePoQty("MTR", -1), 0);
  assert.equal(piLinePoQty("MTR", "abc"), 0);
});

test("resolvePiLineUoms drops po_qty when the unit is the PO line's", async () => {
  const db = fakeDb([{ id: "poi-1", unit: "ROLL" }]);
  const rows = [
    { uom: "MTR", poQty: 2, poItemId: "poi-1", grnItemId: null },
    { uom: "ROLL", poQty: 2, poItemId: "poi-1", grnItemId: null },
  ];
  await resolvePiLineUoms(db, rows);
  assert.equal(rows[0].poQty, 2);
  assert.equal(rows[1].poQty, null);
});

// Violet's case: PO line 3 ROLL of an MTR material. Invoice 1: 100 MTR for
// 2 rolls. Invoice 2: 50 MTR for the last roll. RM 15.00 per metre.
const PO = { id: "1", poId: "po1", materialCode: "COVE-03", materialName: "Fabric", quantity: 3, receivedQty: 0, poStatus: "CONFIRMED" };
const mtr = (id, qty, poQty) => ({ id, poId: "po1", poItemId: "1", materialCode: "COVE-03", qty, unitPriceSen: 1500, lineType: "STOCKED", grnItemId: null, uom: "MTR", poQty });

test("auto stock-in: stock gets the metres, the PO line gets the rolls", () => {
  const { lines, skipped } = planPiAutoGrn([mtr("a", 100, 2)], [PO]);
  assert.deepEqual(skipped, []);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 100, "100 MTR into stock — never 2");
  assert.equal(lines[0].poQty, 2, "the PO line moves by 2 rolls");
  assert.equal(lines[0].unitPriceSen, 1500, "valued at the billed price per metre");
  assert.equal(lines[0].uom, "MTR");
  assert.equal(lines[0].otherUnit, true);
});

test("auto stock-in: a split bill — the second invoice takes the last roll", () => {
  const second = planPiAutoGrn([mtr("b", 50, 1)], [{ ...PO, receivedQty: 2 }]);
  assert.deepEqual(second.lines.map((l) => [l.qty, l.poQty]), [[50, 1]]);
  // Rolls over what is open are capped; the metres still go in.
  const over = planPiAutoGrn([mtr("b", 50, 5)], [{ ...PO, receivedQty: 2 }]);
  assert.deepEqual(over.lines.map((l) => [l.qty, l.poQty]), [[50, 1]]);
  // Two metre lines in one invoice share the open rolls.
  const two = planPiAutoGrn([mtr("a", 48, 1), mtr("b", 52, 1)], [PO]);
  assert.deepEqual(two.lines.map((l) => [l.qty, l.poQty]), [[48, 1], [52, 1]]);
  // Nothing open any more → not received again.
  assert.deepEqual(planPiAutoGrn([mtr("c", 50, 1)], [{ ...PO, receivedQty: 3 }]).skipped.map((s) => s.reason), ["ALREADY_RECEIVED"]);
});

test("auto stock-in: the metre line gets no grn_item_id pointer (it would read as GRN-sourced)", () => {
  const db = { prepare: (q) => ({ bind: (...a) => ({ q, a }) }) };
  const st = buildPiGrnLinkStatements(db, "grn-pi-x", [{ piLineId: "a", qty: 100, otherUnit: true }]);
  assert.equal(st.length, 1);
  assert.match(st[0].q, /UPDATE grn_items SET invoiced_qty/);
});

/** Fake db for checkPoRemaining: one PO line, and what earlier invoices billed on it. */
function ceilingDb(poLine, invoicedRows) {
  return {
    prepare(q) {
      const stmt = {
        bind: () => stmt,
        all: async () => ({ results: /FROM purchase_order_items/.test(q) ? [poLine] : /FROM purchase_invoice_items/.test(q) ? invoicedRows : [] }),
        first: async () => ({ poNo: "PO-1" }),
      };
      return stmt;
    },
  };
}
const POI = { id: "1", material_code: "COVE-03", materialName: "Fabric", quantity: 3, receivedQty: 0 };
// What poGuardRow makes of a line: a metre line counts its po_qty.
const row = (qty) => ({ materialCode: "COVE-03", qty, poItemId: "1", linked: true, name: "Fabric" });

test("PO ceiling: a metre line counts the rolls it covers, so a split bill fits", async () => {
  assert.deepEqual(await checkPoRemaining(ceilingDb(POI, []), "po1", [row(2)]), { ok: true });
  // 2 rolls already billed (in metres, po_qty 2) → 1 roll is still open.
  const after = ceilingDb(POI, [{ poItemId: "1", mc: "COVE-03", qty: 2 }]);
  assert.deepEqual(await checkPoRemaining(after, "po1", [row(1)]), { ok: true });
  assert.equal((await checkPoRemaining(after, "po1", [row(2)])).ok, false, "2 more rolls would go over 3");
});

test("every quantity counter knows about a different-unit line", () => {
  const pi = read("src/api/routes/purchase-invoices.ts");
  assert.match(pi, /qty: r\.uom \? Number\(r\.poQty\) \|\| 0 : r\.qty/, "a different-unit line counts po_qty on the ceiling");
  assert.match(pi, /CASE WHEN pii\.uom IS NULL THEN pii\.qty ELSE COALESCE\(pii\.po_qty, 0\) END/, "already-invoiced in checkPoRemaining");
  assert.match(pi, /ADD COLUMN IF NOT EXISTS uom TEXT/, "self-applied column");
  assert.match(pi, /ADD COLUMN IF NOT EXISTS po_qty NUMERIC/, "self-applied column");
  assert.match(read("src/api/lib/po-delivered.ts"), /AND pii\.uom IS NULL/, "overdue widget coverage");
  assert.match(read("src/api/routes/procurement-reports.ts"), /AND pii\.uom IS NULL/, "outstanding PO lines");
  const grn = read("src/api/lib/pi-auto-grn.ts");
  assert.match(grn, /pii\.po_qty AS "poQty"/, "auto stock-in reads po_qty");
  assert.match(grn, /qty: l\.poQty \?\? l\.qty/, "PO counter moves by po_qty");
  assert.match(grn, /!sameUom\(l\.uom, rm\.baseUOM/, "metres go in only when stock is kept in that unit");
});
