// m-products-hub.test.mjs — pure logic behind the phone Products screen
// (src/pages/m/lib/products-hub.ts): families, category pricing, search,
// filters and family cover photos. Rows mimic GET /api/products output.
import test from "node:test";
import assert from "node:assert/strict";
import {
  toHubProduct, buildFamilies, familyCounts, categoryKeys, priceDisplay, seatPrice, seatRows,
  readSofaTier, searchHub, passesFilters, familyPasses, sizeOptions, sortProducts, coverByFamily,
  fmtMinutes, fmtM3,
} from "../src/pages/m/lib/products-hub.ts";

const rows = [
  { id: "prod-1", code: "1003-(3S)", name: "Sofa A", category: "SOFA", baseModel: "1003", sizeLabel: "3 Seater",
    unitM3: 1.62, productionTimeMinutes: 200,
    seatHeightPrices: [{ height: "28", priceSen: 259000 }, { height: "30", priceSen: 0, tier: "PRICE_1" }, { height: "35\"", priceSen: 280000, tier: "PRICE_3" }] },
  { id: "prod-2", code: "1003(A)-(2S)", name: "Sofa A", category: "SOFA", baseModel: "1003(A)", sizeLabel: "2 Seater" },
  { id: "prod-3", code: "1052-(Q)", name: "Bed B", category: "BEDFRAME", baseModel: "1052", sizeLabel: "Queen",
    basePriceSen: 149900, price1Sen: 129900 },
  { id: "prod-4", code: "1052-(K)", name: "Bed B", category: "BEDFRAME", baseModel: "1052", sizeLabel: "King",
    basePriceSen: 0, price1Sen: null },
  { id: "prod-5", code: "ACC-001", name: "Leg set", category: "ACCESSORY", baseModel: "ACC-001", sizeLabel: "", basePriceSen: 12000 },
  { id: "prod-6", code: "ACC-002", name: "Headboard", category: "ACCESSORY", base_model: "ACC-002" },
];
const products = rows.map(toHubProduct);
const byId = (id) => products.find((p) => p.id === id);

test("families follow familyOf + baseModel, as desktop Catalog", () => {
  const fams = buildFamilies(products);
  const keys = fams.map((f) => f.familyKey).sort();
  assert.deepEqual(keys, ["1003", "1052", "ACC-001", "ACC-002"]);
  const sofa = fams.find((f) => f.familyKey === "1003");
  assert.deepEqual(sofa.variants.map((v) => v.baseModel), ["1003", "1003(A)"]);
  assert.equal(familyCounts(sofa), "2 variants · 2 SKUs");
  assert.equal(familyCounts(fams.find((f) => f.familyKey === "ACC-001")), "1 variant · 1 SKU");
});

test("missing / zero prices never become a price", () => {
  assert.deepEqual(priceDisplay(byId("prod-1")), { kind: "sofa" });
  assert.deepEqual(priceDisplay(byId("prod-2")), { kind: "none" });
  assert.deepEqual(priceDisplay(byId("prod-3")), { kind: "bedframe", p1: 129900, p2: 149900 });
  assert.deepEqual(priceDisplay(byId("prod-4")), { kind: "none" });
  assert.deepEqual(priceDisplay(byId("prod-5")), { kind: "single", base: 12000 });
  assert.deepEqual(priceDisplay(byId("prod-6")), { kind: "none" });
});

test("sofa seat grid: untiered = P2, zero = unset, heights normalised", () => {
  const p = byId("prod-1");
  assert.equal(seatPrice(p, "28", "PRICE_2"), 259000);
  assert.equal(seatPrice(p, "28\"", "PRICE_2"), 259000);
  assert.equal(seatPrice(p, "28", "PRICE_1"), null);
  assert.equal(seatPrice(p, "30", "PRICE_1"), null);
  assert.equal(seatPrice(p, "35", "PRICE_3"), 280000);
  // Maintenance sizes lead; a priced height missing from Maintenance is appended.
  assert.deepEqual(seatRows(p, ["24", "28", "30"]), ["24", "28", "30", "35"]);
});

test("tier preference reads the desktop key's values", () => {
  assert.equal(readSofaTier("PRICE_1"), "PRICE_1");
  assert.equal(readSofaTier("P3"), "PRICE_3");
  assert.equal(readSofaTier(null), "PRICE_2");
  assert.equal(readSofaTier("junk"), "PRICE_2");
});

test("categories: All + the three known, then extras", () => {
  const extra = [...products, toHubProduct({ id: "x", code: "Z-1", category: "service" })];
  assert.deepEqual(categoryKeys(extra), ["all", "SOFA", "BEDFRAME", "ACCESSORY", "SERVICE"]);
});

test("search: exact code first, category-scoped, families by model", () => {
  const fams = buildFamilies(products);
  const r = searchHub(products, fams, "1052-(q)", "all");
  assert.equal(r.exactId, "prod-3");
  assert.equal(r.skus[0].id, "prod-3");
  const scoped = searchHub(products, fams, "1003", "BEDFRAME");
  assert.equal(scoped.skus.length, 0);
  assert.equal(scoped.families.length, 0);
  const model = searchHub(products, fams, "1003(a)", "all");
  assert.deepEqual(model.families.map((f) => f.familyKey), ["1003"]);
  assert.deepEqual(searchHub(products, fams, "   ", "all").skus, []);
});

test("size filter, size options and sort", () => {
  const f = { sizes: ["Queen"], sort: "name" };
  assert.equal(passesFilters(byId("prod-3"), f), true);
  assert.equal(passesFilters(byId("prod-4"), f), false);
  const fams = buildFamilies(products);
  assert.equal(familyPasses(fams.find((x) => x.familyKey === "1052"), f), true);
  assert.equal(familyPasses(fams.find((x) => x.familyKey === "1003"), f), false);
  assert.deepEqual(sizeOptions(products, "BEDFRAME"), ["King", "Queen"]);
  // localeCompare, the same comparison the desktop list and Catalog use.
  assert.equal(sortProducts(products, "code")[0].code, "1003-(3S)");
  assert.equal(sortProducts(products, "code").at(-1).code, "ACC-002");
  assert.equal(sortProducts(products, "name")[0].name, "Bed B");
});

test("family cover: lowest sortOrder, then newest; non-images skipped", () => {
  const covers = coverByFamily([
    { id: "a", resourceId: "1003", contentType: "image/jpeg", uploadedAt: "2026-01-01", sortOrder: null },
    { id: "b", resourceId: "1003", contentType: "image/jpeg", uploadedAt: "2026-02-01", sortOrder: null },
    { id: "c", resourceId: "1052", contentType: "image/png", uploadedAt: "2026-01-01", sortOrder: 0 },
    { id: "d", resourceId: "1052", contentType: "image/png", uploadedAt: "2026-03-01", sortOrder: 2 },
    { id: "e", resourceId: "ACC-001", contentType: "application/pdf" },
  ]);
  assert.equal(covers.get("1003"), "b");
  assert.equal(covers.get("1052"), "c");
  assert.equal(covers.has("ACC-001"), false);
  assert.equal(coverByFamily(undefined).size, 0);
});

test("spec formatting hides missing values", () => {
  assert.equal(fmtMinutes(200), "3h 20m");
  assert.equal(fmtMinutes(45), "45m");
  assert.equal(fmtMinutes(120), "2h");
  assert.equal(fmtMinutes(0), null);
  assert.equal(fmtM3(1.624), "1.62 m³");
  assert.equal(fmtM3(null), null);
});
