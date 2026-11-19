// HK-0165: Add Raw Material can name a supplier. The link is a
// supplier_material_bindings row, the same row the supplier's Pricing & SKUs
// tab writes, so it shows there and in PO / GRN / PI autofill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMainSupplierBinding,
  linkSupplierToRawMaterial,
  toActiveSupplierOptions,
} from "../src/pages/inventory/rm-supplier-link.ts";

const link = { supplierId: "sup-1", itemCode: "PC151 01", description: "Plywood 9mm" };

test("bindingUsesItemCodeAsSupplierCodeWithNoPrice", () => {
  assert.deepEqual(buildMainSupplierBinding(link), {
    supplierId: "sup-1",
    materialCode: "PC151 01",
    materialName: "Plywood 9mm",
    supplierSku: "PC151 01",
    unitPrice: 0,
    isMainSupplier: true,
  });
});

test("linkPostsBindingToSupplierMaterials", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true }), { status: 201 });
  });
  await linkSupplierToRawMaterial(link);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/supplier-materials");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), buildMainSupplierBinding(link));
});

test("linkThrowsServerErrorWhenRejected", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ success: false, error: "Forbidden" }), { status: 403 }),
  );
  await assert.rejects(linkSupplierToRawMaterial(link), /Forbidden/);
});

test("supplierOptionsListOnlyActiveSuppliers", () => {
  const options = toActiveSupplierOptions([
    { id: "sup-1", code: "S001", name: "Alpha Wood", status: "ACTIVE" },
    { id: "sup-2", code: "S002", name: "Old Supplier", status: "INACTIVE" },
    { id: "sup-3", code: "", name: "No Code Co", status: "ACTIVE" },
  ]);
  assert.deepEqual(options, [
    { value: "sup-1", label: "S001 · Alpha Wood" },
    { value: "sup-3", label: "No Code Co" },
  ]);
});

test("addRawMaterialLinksSupplierFromCreatedRow", () => {
  const page = readFileSync(new URL("../src/pages/inventory/index.tsx", import.meta.url), "utf8");
  assert.match(page, /await linkSupplierToRawMaterial\(\{ supplierId: rmForm\.supplierId, itemCode: json\.data\.itemCode, description: json\.data\.description \}\)/);
  assert.match(page, /was created, but the supplier was not linked/);
});
