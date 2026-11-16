// ---------------------------------------------------------------------------
// so-price-edit.test.mjs — HK-0156. SO-2610-469 reached READY_TO_SHIP with a
// line priced RM 0.00, and the only way to fix a price was the full Edit page,
// which locks once production starts. PATCH /api/sales-orders/:id/prices now
// changes base prices only (no items, qty or specs) until the SO is invoiced.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repriceSoItems, soPriceEditBlock } from "../src/api/lib/so-price-edit.ts";

// SO-2610-469 as stored on prod (16 Nov 2026), plus a surcharge on line 3.
const stored = [
  { id: "i1", lineNo: 1, quantity: 1, basePriceSen: 0, divanPriceSen: 0, legPriceSen: 0, totalHeightPriceSen: 0, specialOrderPriceSen: 0, unitPriceSen: 0, discountSen: 0, lineTotalSen: 0 },
  { id: "i2", lineNo: 2, quantity: 1, basePriceSen: 55000, divanPriceSen: 0, legPriceSen: 0, totalHeightPriceSen: 0, specialOrderPriceSen: 0, unitPriceSen: 55000, discountSen: 0, lineTotalSen: 55000 },
  { id: "i3", lineNo: 3, quantity: 2, basePriceSen: 70000, divanPriceSen: 0, legPriceSen: 3000, totalHeightPriceSen: 0, specialOrderPriceSen: 0, unitPriceSen: 73000, discountSen: 1000, lineTotalSen: 145000 },
];

test("a new base price re-prices the line and the SO total, keeping surcharges, qty and discount", () => {
  const r = repriceSoItems(stored, [
    { id: "i1", basePriceSen: 60000 },
    { id: "i3", basePriceSen: 72000 },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.changed.map((c) => [c.id, c.basePriceSen, c.unitPriceSen, c.lineTotalSen, c.oldUnitPriceSen, c.lineIndex]),
    [
      ["i1", 60000, 60000, 60000, 0, 0],
      ["i3", 72000, 75000, 149000, 73000, 2],
    ],
  );
  assert.equal(r.subtotalSen, 60000 + 55000 + 149000);
});

test("an unchanged price is not a change", () => {
  const r = repriceSoItems(stored, [{ id: "i2", basePriceSen: 55000 }]);
  assert.equal(r.ok, true);
  assert.equal(r.changed.length, 0);
  assert.equal(r.subtotalSen, 200000);
});

test("bad input is refused", () => {
  for (const edits of [
    [],
    [{ id: "nope", basePriceSen: 100 }],
    [{ id: "i1", basePriceSen: -1 }],
    [{ id: "i1", basePriceSen: 10.5 }],
    [{ id: "i1", basePriceSen: "abc" }],
    [{ id: "i1", basePriceSen: 100 }, { id: "i1", basePriceSen: 200 }],
  ]) {
    assert.equal(repriceSoItems(stored, edits).ok, false, JSON.stringify(edits));
  }
});

test("prices stay editable through production and delivery, until invoiced", () => {
  for (const s of ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "ON_HOLD"]) {
    assert.equal(soPriceEditBlock(s, false), null, s);
  }
  for (const s of ["INVOICED", "CLOSED", "CANCELLED"]) {
    assert.match(soPriceEditBlock(s, false), /price/i, s);
  }
  assert.match(soPriceEditBlock("DELIVERED", true), /invoice/i);
});

test("the route uses the helpers, the permission gate and writes an override row", () => {
  const src = readFileSync(resolve("src/api/routes/sales-orders.ts"), "utf8");
  const start = src.indexOf('app.patch("/:id/prices"');
  assert.ok(start > 0, "PATCH /:id/prices exists");
  const body = src.slice(start, src.indexOf("\napp.", start + 10));
  assert.match(body, /requirePermission\(c, "sales-orders", "update"\)/);
  assert.match(body, /soPriceEditBlock\(/);
  assert.match(body, /repriceSoItems\(/);
  assert.match(body, /INSERT INTO price_overrides/);
  assert.match(body, /emitAudit\(/);
});
