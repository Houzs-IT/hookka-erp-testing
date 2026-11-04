// Defect rate by category (owner 2026-10-17): cases ÷ units shipped.
import test from "node:test";
import assert from "node:assert/strict";
import { defectRates, productCategoriesOf } from "../src/api/lib/service-issue-stats.ts";

test("productCategoriesOf resolves affected products by id, then code", () => {
  const byId = new Map([["p1", "SOFA"]]);
  const byCode = new Map([["1013-(Q)", "BEDFRAME"]]);
  assert.deepEqual(productCategoriesOf(JSON.stringify([{ productId: "p1" }, { code: "1013-(q)" }]), byId, byCode).sort(), ["BEDFRAME", "SOFA"]);
  assert.deepEqual(productCategoriesOf(null, byId, byCode), []);
});

test("defectRates: per category, unspecified cases have no rate, other months ignored", () => {
  const cases = [
    { createdDate: "2026-10-03", productCategories: ["SOFA"] },
    { createdDate: "2026-10-05", productCategories: ["SOFA", "BEDFRAME"] },
    { createdDate: "2026-10-09", productCategories: [] },
    { createdDate: "2026-09-30", productCategories: ["SOFA"] },
  ];
  const shipped = [{ ym: "2026-10", category: "SOFA", units: 50 }, { ym: "2026-10", category: "BEDFRAME", units: 200 }, { ym: "2026-09", category: "SOFA", units: 99 }];
  const r = Object.fromEntries(defectRates(cases, shipped, ["2026-10"]).map((x) => [x.category, x]));
  assert.deepEqual([r.SOFA.cases, r.SOFA.units, r.SOFA.rate], [2, 50, 4]);
  assert.deepEqual([r.BEDFRAME.cases, r.BEDFRAME.rate], [1, 0.5]);
  assert.equal(r.UNSPECIFIED.rate, null);
});

test("defectRates: accessories are left out of cases and units (owner 2026-10-18)", () => {
  const cases = [
    { createdDate: "2026-10-03", productCategories: ["ACCESSORY"] },
    { createdDate: "2026-10-04", productCategories: ["ACCESSORY", "SOFA"] },
  ];
  const shipped = [{ ym: "2026-10", category: "ACCESSORY", units: 134 }, { ym: "2026-10", category: "SOFA", units: 10 }];
  const r = defectRates(cases, shipped, ["2026-10"]);
  assert.deepEqual(r.map((x) => [x.category, x.cases, x.units]), [["SOFA", 1, 10]]);
});

test("defectRates: a case that is only Transport / Customer is not ours; a mixed one still counts", () => {
  const cases = [
    { createdDate: "2026-10-01", productCategories: ["SOFA"], causes: ["TRANSPORT"] },
    { createdDate: "2026-10-02", productCategories: ["SOFA"], causes: ["CUSTOMER", "TRANSPORT"] },
    { createdDate: "2026-10-03", productCategories: ["SOFA"], causes: ["CUSTOMER", "PRODUCTION"] },
    { createdDate: "2026-10-04", productCategories: ["SOFA"], causes: [] },
  ];
  const shipped = [{ ym: "2026-10", category: "SOFA", units: 100 }];
  const n = (notOurs) => defectRates(cases, shipped, ["2026-10"], notOurs).find((r) => r.category === "SOFA").cases;
  assert.equal(n(), 4);
  assert.equal(n(["TRANSPORT", "CUSTOMER"]), 2);
});
