// ---------------------------------------------------------------------------
// product-costing.test.mjs — the cost engine behind the Products costing page
// (owner 2026-11-22, docs/plans/product-costing.md D1, D2, D9).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeCosting,
  pickPrice,
  normaliseFabricTiers,
  DEFAULT_FABRIC_TIERS,
  LABOUR_RATE_PER_MIN_SEN,
  marginOn,
  priceForMargin,
  priceInEffect,
} from "../src/lib/product-costing.ts";

const rms = [
  { itemCode: "PLY18", description: "18MM PLYWOOD", baseUOM: "PCS", itemGroup: "WOOD" },
  { itemCode: "WB150", description: "Webbing 150", baseUOM: "ROLL", itemGroup: "WEBBING" },
  { itemCode: "FOAM1", description: "Foam sheet", baseUOM: "PCS", itemGroup: "FILLER" },
  { itemCode: "CARTON", description: "Carton box", baseUOM: "PCS", itemGroup: "PACKING" },
];
const bindings = [
  { materialCode: "PLY18", supplierName: "Main Wood", unitPrice: 6800, isMainSupplier: 1, effectiveFrom: "2026-01-01" },
  { materialCode: "PLY18", supplierName: "Cheap Wood", unitPrice: 5000, isMainSupplier: 0, effectiveFrom: "2026-10-01" },
  { materialCode: "WB150", supplierName: "Old", unitPrice: 1500, isMainSupplier: 0, effectiveFrom: "2026-01-01" },
  { materialCode: "WB150", supplierName: "New", unitPrice: 1827, isMainSupplier: 0, effectiveFrom: "2026-09-01" },
  { materialCode: "FOAM1", supplierName: "Foamy", unitPrice: 9600, isMainSupplier: true, effectiveFrom: "2026-01-01" },
];

test("labour rate is RM 2,200 / 26 / 9 / 60 (D1)", () => {
  assert.ok(Math.abs(LABOUR_RATE_PER_MIN_SEN - 15.6695) < 0.0001);
});

test("pickPrice: main supplier wins, else the newest; MYR > 0 only (D2)", () => {
  assert.equal(pickPrice(bindings.filter((b) => b.materialCode === "PLY18")).priceSen, 6800);
  assert.equal(pickPrice(bindings.filter((b) => b.materialCode === "WB150")).supplierName, "New");
  assert.equal(pickPrice([{ materialCode: "X", unitPrice: 0, isMainSupplier: 1 }]), null);
  assert.equal(pickPrice([{ materialCode: "X", unitPrice: 500, currency: "CNY", isMainSupplier: 1 }]), null);
  assert.equal(pickPrice([]), null);
});

test("pieces are per finished good and do not compound down the tree", () => {
  const r = computeCosting({
    rawMaterials: rms,
    bindings,
    bom: {
      wipComponents: [
        {
          id: "divan", wipCode: "Divan", quantity: 2,
          processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 18 }],
          children: [
            { id: "wd", wipCode: "Divan WD", quantity: 2, processes: [{ dept: "Wood Cut", deptCode: "WOOD_CUT", minutes: 15 }],
              materials: [{ code: "PLY18", name: "Plywood", qty: 0.5, unit: "PCS" }] },
          ],
        },
      ],
    },
  });
  assert.equal(r.minutes, 18 * 2 + 15 * 2);
  assert.equal(r.nodes.length, 2);
  assert.deepEqual(r.nodes.map((n) => n.level), [2, 3]);
  const ply = r.nodes[1].materials[0];
  assert.equal(ply.qty, 1); // 0.5 × 2, NOT × 4
  assert.equal(ply.amountSen, 6800);
  assert.equal(r.materialSen, 6800);
  assert.equal(r.labourSen, Math.round(36 * LABOUR_RATE_PER_MIN_SEN) + Math.round(30 * LABOUR_RATE_PER_MIN_SEN));
  assert.equal(r.totalSen, r.labourSen + r.materialSen);
  assert.deepEqual(r.byDept.map((d) => [d.deptCode, d.minutes]), [["PACKING", 36], ["WOOD_CUT", 30]]);
});

test("no price → red and NOT counted as 0; unknown code → no-code", () => {
  const r = computeCosting({
    rawMaterials: rms,
    bindings,
    bom: { wipComponents: [{ quantity: 1, materials: [
      { code: "CARTON", qty: 1, unit: "PCS" },
      { name: "Some typed thing", qty: 2, unit: "PCS" },
    ] }] },
  });
  const [carton, typed] = r.nodes[0].materials;
  assert.equal(carton.status, "no-price");
  assert.equal(carton.amountSen, null);
  assert.equal(typed.status, "no-code");
  assert.equal(r.missingLines, 2);
  assert.equal(r.materialSen, 0);
});

test("wastage expands qty; filler cut size uses a fraction of the sheet; unit mismatch is flagged", () => {
  const r = computeCosting({
    rawMaterials: rms,
    bindings,
    bom: { wipComponents: [{ quantity: 1, materials: [
      { code: "WB150", qty: 0.2, unit: "ROLL", wastePct: 10 },
      { code: "FOAM1", qty: 1, unit: "PCS", cutLengthIn: 48, cutWidthIn: 24 },
      { code: "PLY18", qty: 1, unit: "SHEET" },
    ] }] },
  });
  const [wb, foam, ply] = r.nodes[0].materials;
  assert.ok(Math.abs(wb.qty - 0.22) < 1e-9);
  assert.equal(wb.amountSen, Math.round(0.22 * 1827));
  assert.equal(foam.qty, 0.25); // 48×24 of a 96×48 sheet
  assert.equal(foam.amountSen, 2400);
  assert.equal(ply.unitMismatch, true);
  assert.equal(wb.unitMismatch, false);
});

test("fabric from order: priced at each tier's MAX, headline at the chosen tier (D9)", () => {
  const input = {
    rawMaterials: rms,
    bindings,
    bom: { wipComponents: [{ quantity: 2, materials: [
      { autoDetect: "FABRIC", qty: 3, unit: "M" },
      { code: "PLY18", qty: 0.5, unit: "PCS" },
    ] }] },
  };
  const lv1 = computeCosting(input);
  const fabric = lv1.nodes[0].materials[0];
  assert.equal(fabric.status, "fabric-tier");
  assert.equal(fabric.qty, 6);
  assert.deepEqual(fabric.tierAmountsSen, { Lv1: 7200, Lv2: 9600, Lv3: 12600, Lv4: 15000 });
  assert.equal(lv1.tier, "Lv1");
  assert.equal(lv1.materialSen, 7200 + 6800);
  assert.deepEqual(lv1.tiers.map((t) => t.materialSen), [14000, 16400, 19400, 21800]);
  const lv3 = computeCosting(input, { tier: "Lv3" });
  assert.equal(lv3.materialSen, 12600 + 6800);
  assert.equal(lv3.fabricFromOrderLines, 1);
});

test("leg from order is unknown until the order: red, not counted", () => {
  const r = computeCosting({ rawMaterials: rms, bindings, bom: { wipComponents: [{ materials: [{ autoDetect: "LEG", qty: 4, unit: "PCS" }] }] } });
  assert.equal(r.nodes[0].materials[0].status, "from-order");
  assert.equal(r.missingLines, 1);
  assert.equal(r.tiers.length, 0);
});

test("product-level (L1) processes and materials are their own level-1 node", () => {
  const r = computeCosting({ rawMaterials: rms, bindings, bom: {
    l1Processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 10 }],
    l1Materials: [{ code: "PLY18", qty: 1, unit: "PCS" }],
    wipComponents: [],
  } });
  assert.equal(r.nodes[0].level, 1);
  assert.equal(r.nodes[0].materialSen, 6800);
  assert.equal(r.minutes, 10);
});

test("fabric tiers: stored values used, anything malformed falls back to the defaults", () => {
  assert.deepEqual(normaliseFabricTiers(null), DEFAULT_FABRIC_TIERS);
  assert.deepEqual(normaliseFabricTiers([{ level: "A", minSen: 500, maxSen: 400 }]), DEFAULT_FABRIC_TIERS);
  assert.deepEqual(normaliseFabricTiers([{ level: "A", minSen: "100", maxSen: "900" }]), [{ level: "A", minSen: 100, maxSen: 900 }]);
});

test("calculator: margin on a price, price for a margin (D5)", () => {
  assert.deepEqual(marginOn(71000, 23603), { marginSen: 47397, pct: (47397 / 71000) * 100 });
  assert.equal(marginOn(0, 100).pct, null);
  assert.equal(priceForMargin(23603, 60), 59008);
  assert.equal(priceForMargin(100, 100), null);
});

test("route: mounted, read-only on business data, ACTIVE BOM first", () => {
  const w = readFileSync(resolve(process.cwd(), "src/api/worker.ts"), "utf8");
  assert.match(w, /app\.route\("\/api\/product-costing", productCosting\);\s*app\.route\("\/api\/products", products\);/);
  const r = readFileSync(resolve(process.cwd(), "src/api/routes/product-costing.ts"), "utf8");
  assert.match(r, /WHEN versionStatus = 'ACTIVE' THEN 0/);
  assert.doesNotMatch(r, /UPDATE bom_templates|INSERT INTO bom_templates|supplier_material_bindings SET/);
});

test("price in effect TODAY: a saved future price has not started yet (owner: effective date like customer prices)", () => {
  const today = "2026-11-22";
  // Price raised 50 → 60 effective 1 Dec, saved on 20 Nov: today is still 50.
  const future = [
    { oldPrice: 0, newPrice: 4000, effectiveFrom: "2026-01-01", changedDate: "2026-01-01" },
    { oldPrice: 4000, newPrice: 5000, effectiveFrom: "2026-06-01", changedDate: "2026-06-01" },
    { oldPrice: 5000, newPrice: 6000, effectiveFrom: "2026-12-01", changedDate: "2026-11-20" },
  ];
  assert.deepEqual(priceInEffect({ unitPrice: 6000, effectiveFrom: "2026-12-01" }, future, today), { priceSen: 5000, effectiveFrom: "2026-06-01" });
  // On 1 Dec the new price applies.
  assert.equal(priceInEffect({ unitPrice: 6000, effectiveFrom: "2026-12-01" }, future, "2026-12-01").priceSen, 6000);
  // Started binding price is used as is.
  assert.equal(priceInEffect({ unitPrice: 5000, effectiveFrom: "2026-06-01" }, future.slice(0, 2), today).priceSen, 5000);
  // No trail, no date: the binding price.
  assert.equal(priceInEffect({ unitPrice: 700 }, [], today).priceSen, 700);
  // First-ever price is in the future: no price yet.
  assert.equal(priceInEffect({ unitPrice: 900, effectiveFrom: "2027-01-01" }, [{ oldPrice: 0, newPrice: 900, effectiveFrom: "2027-01-01" }], today), null);
});
