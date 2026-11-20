// HK-0168: export the customer quotation for selected models only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  pickQuotationModels,
  quotationModelOptions,
} from "../src/lib/quotation-model-filter.ts";

const productById = new Map([
  ["bf-k", { baseModel: "1003" }],
  ["bf-q", { baseModel: "1003" }],
  ["bfa-q", { baseModel: "1003(A)" }],
  ["sofa-1a", { baseModel: "5530" }],
  ["acc-pillow", { baseModel: "5530" }],
  ["acc-a01", { baseModel: null }],
]);

const env = {
  customer: { id: "c1", code: "C-1" },
  asOf: "2026-11-20",
  products: [
    { productId: "bf-k", code: "1003-(K)" },
    { productId: "bf-q", code: "1003-(Q)" },
    { productId: "bfa-q", code: "1003(A)-(Q)" },
    { productId: "sofa-1a", code: "5530-1A(LHF)" },
    { productId: "acc-pillow", code: "5530-PILLOW" },
    { productId: "acc-a01", code: "A01" },
  ],
  sofaCombos: [{ baseModel: "5530" }, { baseModel: "5531" }],
  maintenanceConfig: {},
};

test("no models picked exports everything (the old Export all)", () => {
  assert.equal(pickQuotationModels(env, [], productById), env);
});

test("picked models keep only their SKUs and sofa combos", () => {
  const out = pickQuotationModels(env, ["5530", "A01"], productById);
  assert.deepEqual(out.products.map((p) => p.productId), ["sofa-1a", "acc-pillow", "acc-a01"]);
  assert.deepEqual(out.sofaCombos, [{ baseModel: "5530" }]);
  assert.equal(out.customer, env.customer);
  assert.equal(out.maintenanceConfig, env.maintenanceConfig);
});

test("1003 does not pull in 1003(A)", () => {
  const out = pickQuotationModels(env, ["1003"], productById);
  assert.deepEqual(out.products.map((p) => p.productId), ["bf-k", "bf-q"]);
});

test("model options are unique, sorted, and fall back to the SKU code", () => {
  const rows = env.products.map((p) => ({ productId: p.productId, productCode: p.code }));
  assert.deepEqual(quotationModelOptions(rows, productById), ["1003", "1003(A)", "5530", "A01"]);
});

test("customers page filters both Export and Email quotation by the picked models", () => {
  const src = readFileSync("src/pages/customers.tsx", "utf8");
  const calls = src.match(/pickQuotationModels\(json\.data, quotationModels, productById\)/g) ?? [];
  assert.equal(calls.length, 2);
  assert.match(src, /<CheckboxMultiSelect[\s\S]{0,200}allLabel="All models"/);
});
