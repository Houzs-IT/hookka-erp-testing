// BUG-2026-11-24-552 — a 2025 demo bom_versions row (bom-v-3, 5530-1A sofa)
// shared productId prod-5 with the real product 1003(A)-(K), so the MRP, RM
// deduction and costing used the sofa's materials (AM275-1 7 m + 8%) instead
// of 1003(A)-(K)'s own BOM template. Owner 2026-11-24: 「最主要是跟着BOM 就对了」.
import { test } from "node:test";
import assert from "node:assert/strict";

const stubDb = {
  prepare() {
    const q = { bind: () => q, all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) };
    return q;
  },
};

const sofaTree = JSON.stringify({ materials: [{ code: "FAB-SM-001", name: "SM Fabric (KN390)", qty: 7, unit: "METER", wastePct: 8, inventoryCode: "AM275-1" }] });
const hiltonTpl = JSON.stringify([
  { wipType: "DIVAN", wipCode: "DIVAN", quantity: 1, materials: [{ code: "AM275-1-NOT", name: "Divan board", qty: 2, unit: "PCS", inventoryCode: "PLY-1" }] },
]);

function cacheWith() {
  const rm = (itemCode, itemGroup) => ({ id: `rm-${itemCode}`, itemCode, description: itemCode, itemGroup, baseUOM: "MTR" });
  return {
    versionsByProductId: new Map([["prod-5", { id: "bom-v-3", productId: "prod-5", productCode: "5530-1A", status: "ACTIVE", tree: sofaTree }]]),
    versionsByProductCode: new Map([["5530-1A", { id: "bom-v-3", productId: "prod-5", productCode: "5530-1A", status: "ACTIVE", tree: sofaTree }]]),
    templatesByProductCode: new Map([["1003(A)-(K)", { id: "bom-tpl-1003(A)-(K)", wipComponents: hiltonTpl }]]),
    rmByItemCode: new Map([["AM275-1", rm("AM275-1", "S.M-FABR")], ["PLY-1", rm("PLY-1", "PLYWOOD")]]),
    rmByDescriptionLower: new Map(),
    kitsByParent: new Map(),
  };
}

test("an order uses its OWN product's BOM, never a version that only shares its productId", async () => {
  const { computeRequiredLines } = await import("../src/api/lib/po-cost-cascade.ts");
  const po = { id: "po1", poNo: "SO-1-01", productId: "prod-5", productCode: "1003(A)-(K)", quantity: 1, itemCategory: "BEDFRAME" };
  const lines = await computeRequiredLines(stubDb, po, { cache: cacheWith(), sheetDefaults: {} });
  const codes = lines.map((l) => l.rm?.itemCode ?? l.code);
  assert.ok(!codes.includes("AM275-1"), `sofa demo BOM leaked in: ${codes.join(",")}`);
  assert.ok(codes.includes("PLY-1"), `own template not used: ${codes.join(",")}`);
});

test("a version whose product code matches is still used", async () => {
  const { computeRequiredLines } = await import("../src/api/lib/po-cost-cascade.ts");
  const po = { id: "po2", poNo: "SO-2-01", productId: "prod-5", productCode: "5530-1A", quantity: 1, itemCategory: "SOFA" };
  const lines = await computeRequiredLines(stubDb, po, { cache: cacheWith(), sheetDefaults: {} });
  assert.ok(lines.some((l) => (l.rm?.itemCode ?? l.code) === "AM275-1"));
});
