// ---------------------------------------------------------------------------
// hk-0149-pi-line-uom.test.mjs — a purchase-invoice line may be billed in
// another unit than its PO line (fabric ordered in ROLL, received in MTR).
// The unit is saved on the PI line only; the PO line is never written. With no
// ROLL→MTR factor (Violet 2026-11-12: every roll has different metres), such
// a line CLOSES its PO line: it takes what the line has open on the PO
// ceiling, and auto stock-in receives the open rolls once at the bill's value.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { piLineUom, resolvePiLineUoms } from "../src/api/lib/pi-line-uom.ts";
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

// Violet's case: PO line 3 ROLL, invoice lines 48 + 52 + 50 MTR at RM 15.00/m.
const PO = { id: "1", poId: "po1", materialCode: "COVE-03", materialName: "Fabric", quantity: 3, receivedQty: 0, poStatus: "CONFIRMED" };
const mtr = (id, qty) => ({ id, poId: "po1", poItemId: "1", materialCode: "COVE-03", qty, unitPriceSen: 1500, lineType: "STOCKED", grnItemId: null, uom: "MTR" });

test("auto stock-in: 48 + 52 + 50 MTR on a 3 ROLL line receives the 3 rolls once, at the bill's value", () => {
  const { lines, skipped } = planPiAutoGrn([mtr("a", 48), mtr("b", 52), mtr("c", 50)], [PO]);
  assert.deepEqual(skipped, []);
  assert.equal(lines.length, 1, "one receipt line for the PO line, not one per metre line");
  assert.equal(lines[0].qty, 3, "the open rolls — never 150");
  assert.equal(lines[0].qty * lines[0].unitPriceSen, 150 * 1500, "stock value = what the invoice bills");
  assert.equal(lines[0].otherUnit, true);
  // A PO line already part-received (1 roll by GRN) gets only the 2 still open.
  const part = planPiAutoGrn([mtr("a", 100)], [{ ...PO, receivedQty: 1 }]);
  assert.deepEqual(part.lines.map((l) => l.qty), [2]);
  // Fully received already → nothing more.
  assert.deepEqual(planPiAutoGrn([mtr("a", 150)], [{ ...PO, receivedQty: 3 }]).skipped.map((s) => s.reason), ["ALREADY_RECEIVED"]);
});

test("auto stock-in: the metre line gets no grn_item_id pointer (it would read as GRN-sourced)", () => {
  const db = { prepare: (q) => ({ bind: (...a) => ({ q, a }) }) };
  const st = buildPiGrnLinkStatements(db, "grn-pi-x", [{ piLineId: "a", qty: 3, otherUnit: true }]);
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
const row = (qty, closesLine) => ({ materialCode: "COVE-03", qty, poItemId: "1", linked: true, name: "Fabric", closesLine });

test("PO ceiling: 150 MTR is accepted against a 3 ROLL line and closes it", async () => {
  const first = ceilingDb(POI, []);
  assert.deepEqual(await checkPoRemaining(first, "po1", [row(48, true), row(52, true), row(50, true)]), { ok: true });
  // After that bill: the line is closed — another metre bill or a roll bill is refused.
  const closed = ceilingDb(POI, [{ poItemId: "1", mc: "COVE-03", qty: 0, closes: 1 }]);
  assert.equal((await checkPoRemaining(closed, "po1", [row(20, true)])).ok, false);
  assert.equal((await checkPoRemaining(closed, "po1", [row(1, false)])).ok, false);
  // 1 roll billed in ROLL first → a metre bill still closes the other 2.
  const part = ceilingDb(POI, [{ poItemId: "1", mc: "COVE-03", qty: 1, closes: 0 }]);
  assert.deepEqual(await checkPoRemaining(part, "po1", [row(100, true)]), { ok: true });
});

test("every quantity counter knows about a different-unit line", () => {
  const pi = read("src/api/routes/purchase-invoices.ts");
  assert.match(pi, /closesLine: !!r\.uom/, "a different-unit line closes its PO line on the ceiling");
  assert.match(pi, /MAX\(CASE WHEN pii\.uom IS NULL THEN 0 ELSE 1 END\) AS "closes"/, "already-invoiced in checkPoRemaining");
  assert.match(pi, /ADD COLUMN IF NOT EXISTS uom TEXT/, "self-applied column");
  assert.match(read("src/api/lib/po-delivered.ts"), /AND pii\.uom IS NULL/, "overdue widget coverage");
  assert.match(read("src/api/routes/procurement-reports.ts"), /AND pii\.uom IS NULL/, "outstanding PO lines");
  assert.match(read("src/api/lib/pi-auto-grn.ts"), /pii\.uom AS "uom"/, "auto stock-in reads the unit");
});
