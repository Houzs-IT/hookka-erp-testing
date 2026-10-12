// ---------------------------------------------------------------------------
// fabric-usage.test.mjs — BUG-2026-10-12-283.
//
// GET /api/dashboard/overview/fabric-cost-compare selects the order category
// as "cat", but computeFcFabricUsageMeters reads `itemCategory`. The route
// spread the row as-is, so itemCategory was always undefined and every sofa
// order was planned as a non-sofa: no seat height, so a BOM fabric line that
// scales with seat height was planned at its base quantity.
//
// 1. Behaviour: the same sofa order plans more fabric when the category is
//    passed than when it is missing (the old route's input).
// 2. Structure: the route maps r.cat onto itemCategory.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeFcFabricUsageMeters } from "../src/api/lib/fabric-usage.ts";

// One fabric-cutting node: 2 m of fabric at a 24" seat, +0.1 m per inch.
const BOM = {
  quantity: 1,
  processes: [{ deptCode: "FAB_CUT" }],
  materials: [
    {
      autoDetect: "FABRIC",
      qty: 2,
      wastePct: 0,
      scaling: { dimension: "seatHeight", baseValue: 24, perUnit: 0.1 },
    },
  ],
  children: [],
};

const SOFA_PO = {
  quantity: 1,
  gapInches: null,
  divanHeightInches: null,
  legHeightInches: null,
  sizeCode: "28",
  sizeLabel: null,
};
const FAB_CUT = { departmentCode: "FAB_CUT", wipType: null };

test("a sofa order plans fabric with its seat height", () => {
  const meters = computeFcFabricUsageMeters({ ...SOFA_PO, itemCategory: "SOFA" }, FAB_CUT, BOM);
  // 2 + (28 - 24) * 0.1
  assert.ok(Math.abs(meters - 2.4) < 1e-9, `expected 2.4, got ${meters}`);
});

test("without the category the seat height is ignored (the old route's input)", () => {
  const meters = computeFcFabricUsageMeters({ ...SOFA_PO, itemCategory: undefined }, FAB_CUT, BOM);
  assert.equal(meters, 2);
});

test("fabric-cost-compare passes the order category as itemCategory", () => {
  const src = readFileSync(new URL("../src/api/routes/dashboard-overview.ts", import.meta.url), "utf8");
  const start = src.indexOf('app.get("/fabric-cost-compare"');
  assert.ok(start >= 0, "fabric-cost-compare handler not found");
  const handler = src.slice(start, src.indexOf("\napp.", start + 1));
  const call = handler.slice(handler.indexOf("computeFcFabricUsageMeters("));
  assert.match(
    call.slice(0, call.indexOf(")")),
    /itemCategory:\s*r\.cat\b/,
    "the computeFcFabricUsageMeters call must map r.cat to itemCategory",
  );
});
