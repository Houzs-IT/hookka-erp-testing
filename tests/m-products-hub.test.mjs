// m-products-hub.test.mjs — pure logic behind the phone Products screen
// (src/pages/m/lib/products-hub.ts): families, category pricing, search,
// filters and family cover photos. Rows mimic GET /api/products output.
import test from "node:test";
import assert from "node:assert/strict";
import {
  toHubProduct, buildFamilies, familyCounts, categoryKeys, priceDisplay, seatPrice, seatRows,
  readSofaTier, searchHub, passesFilters, familyPasses, sizeOptions, sortProducts, coverByFamily,
  fmtMinutes, fmtM3, categoryTone, familyKeyOf, familyOfProduct, materialTone, deptLabel, deptRows,
  pickActiveTemplate, templateDeptRows, templateMaterials, materialLabel, legacyMaterials, bomSource,
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

test("Products Hub v2: category tone, unknown categories fall back to neutral", () => {
  assert.equal(categoryTone("SOFA"), "sofa");
  assert.equal(categoryTone("BEDFRAME"), "bedframe");
  assert.equal(categoryTone("ACCESSORY"), "accessory");
  assert.equal(categoryTone("MATTRESS"), "other");
  assert.equal(categoryTone(""), "other");
});

test("Products Hub v2 keeps the price rules: no 'from' price, missing price stays 'none'", () => {
  // Bedframe keeps both tiers (no minimum collapsed into one), sofa stays the sheet link.
  assert.deepEqual(priceDisplay(byId("prod-3")), { kind: "bedframe", p1: 129900, p2: 149900 });
  assert.deepEqual(priceDisplay(byId("prod-1")), { kind: "sofa" });
  assert.deepEqual(priceDisplay(byId("prod-4")), { kind: "none" });
  assert.deepEqual(priceDisplay(byId("prod-6")), { kind: "none" });
});

test("Product Detail: family lookup by id, else by family key", () => {
  const fams = buildFamilies(products);
  assert.equal(familyKeyOf("1003(A)-(2S)"), "1003");
  assert.equal(familyOfProduct(fams, byId("prod-2")).familyKey, "1003");
  // Deep link before the list holds this SKU: falls back to the family key.
  assert.equal(familyOfProduct(fams, { id: "prod-x", code: "1052-(SK)" }).familyKey, "1052");
  assert.equal(familyOfProduct([], byId("prod-1")), null);
});

test("Product Detail: BOM material tones (fabric / foam / wood / hardware)", () => {
  assert.equal(materialTone("BM_FABRIC"), "fabric");
  assert.equal(materialTone("SM_FABRIC"), "fabric");
  assert.equal(materialTone("B_FILLER"), "foam");
  assert.equal(materialTone("PLYWOOD"), "wood");
  assert.equal(materialTone("WD_STRIP"), "wood");
  assert.equal(materialTone("ACCESSORIES"), "hardware");
  assert.equal(materialTone("WEBBING"), "hardware");
  assert.equal(materialTone(""), "hardware");
});

test("Product Detail: dept rows — labels, bars, and Department Time Total = sum of the rows", () => {
  assert.equal(deptLabel("FABRIC_SEWING"), "Fabric Sewing");
  assert.equal(deptLabel(""), "Department");
  const { rows, totalMinutes } = deptRows([
    { id: "a", departmentCode: "FRAMING", minutes: 90, category: "" },
    { id: "b", departmentCode: "UPHOLSTERY", minutes: 120, category: "SOFA" },
    { departmentCode: "PACKING", minutes: "30" },
    { departmentCode: "QC", minutes: null },
  ]);
  assert.equal(totalMinutes, 240);
  assert.deepEqual(rows.map((r) => [r.dept, r.minutes, r.pct]), [
    ["Framing", 90, 75], ["Upholstery", 120, 100], ["Packing", 30, 25], ["Qc", 0, 0],
  ]);
  assert.equal(rows[2].id, "PACKING-2");
  assert.deepEqual(deptRows(undefined), { rows: [], totalMinutes: 0 });
});

// ---- Active BOM template (GET /api/bom/templates) -----------------------------

const tplResp = (rows) => ({ success: true, data: rows });
const T = (o) => ({ id: "t", productCode: "1003-(3S)", version: "1", versionStatus: "ACTIVE", effectiveFrom: "2026-01-01", l1Processes: [], wipComponents: [], ...o });

test("BOM template: exact code + ACTIVE, newest effectiveFrom first (empty last) — as the API picks", () => {
  const resp = tplResp([
    T({ id: "old", version: "1", effectiveFrom: "2026-01-01" }),
    T({ id: "new", version: "2", effectiveFrom: "2026-06-01" }),
    T({ id: "nodate", version: "3", effectiveFrom: "" }),
    T({ id: "draft", version: "9", versionStatus: "DRAFT", effectiveFrom: "2027-01-01" }),
    T({ id: "nostatus", version: "8", versionStatus: null, effectiveFrom: "2027-02-01" }),
  ]);
  assert.equal(pickActiveTemplate(resp, "1003-(3S)").id, "new");
  assert.equal(pickActiveTemplate(resp, "1003-(2S)"), null, "never another product's template");
  assert.equal(pickActiveTemplate(tplResp([T({ productCode: "1003-(3s)" })]), "1003-(3S)"), null, "exact, case-sensitive match");
  assert.equal(pickActiveTemplate(tplResp([T({ versionStatus: "active" })]), "1003-(3S)").id, "t", "status compared upper-case");
});

test("BOM template: dept minutes use the API rule (L1 once, WIP × quantity, children on their own) — total = productionTimeMinutes", () => {
  const t = pickActiveTemplate(tplResp([T({
    l1Processes: [{ deptCode: "PACKING", dept: "Packing", minutes: 10 }],
    wipComponents: [
      { wipCode: "BASE", quantity: 2, processes: [{ deptCode: "FRAMING", minutes: 30 }, { deptCode: "UPHOLSTERY", minutes: 20 }],
        children: [{ wipCode: "CUSHION", quantity: 3, processes: [{ deptCode: "FOAM", minutes: 5 }, { deptCode: "UPHOLSTERY", minutes: 4 }] }] },
      { wipCode: "ARM", processes: [{ deptCode: "FRAMING", minutes: 7 }] },
    ],
  })]), "1003-(3S)");
  const { rows, totalMinutes } = templateDeptRows(t);
  // API: 10 + (30+20)*2 + (5+4)*3 + 7*1 = 144
  assert.equal(totalMinutes, 144);
  assert.deepEqual(rows.map((r) => [r.dept, r.minutes]), [["Packing", 10], ["Framing", 67], ["Upholstery", 52], ["Foam", 15]]);
});

test("BOM template: materials from the WIP components, as stored (not multiplied), with the component as sub-line", () => {
  const t = pickActiveTemplate(tplResp([T({
    wipComponents: [{ wipCode: "BASE", quantity: 2, materials: [
      { name: "Velvet Charcoal", qty: 4.5, unit: "m", autoDetect: "FABRIC" },
      { code: "PLY-18", name: "Plywood 18mm", qty: 2, unit: "sht" },
      { name: "Bolt set", qty: 0, unit: "set" },
    ], children: [{ wipCode: "CUSHION", materials: [{ name: "HD Foam 32kg", qty: 3, unit: "sht" }] }] }],
  })]), "1003-(3S)");
  assert.deepEqual(templateMaterials(t).map((m) => [m.title, m.sub, m.qty, m.tone]), [
    ["Velvet Charcoal", "BASE", "4.5 m", "fabric"],
    ["Plywood 18mm", "BASE", "2 sht", "wood"],
    ["Bolt set", "BASE", null, "hardware"],
    ["HD Foam 32kg", "CUSHION", "3 sht", "foam"],
  ]);
});

test("BOM legacy rows: readable category labels, waste, qty; never invented", () => {
  assert.equal(materialLabel("BM_FABRIC"), "BM Fabric");
  assert.equal(materialLabel("WD_STRIP"), "WD Strip");
  assert.equal(materialLabel("PLYWOOD"), "Plywood");
  assert.deepEqual(
    legacyMaterials([{ id: "b1", materialCategory: "PLYWOOD", materialName: "Ply 18", qtyPerUnit: 2, unit: "sht", wastePct: 3 }, { materialCategory: "ACCESSORIES" }])
      .map((r) => [r.title, r.sub, r.qty, r.tone]),
    [["Ply 18", "Plywood · +3% waste", "2 sht", "wood"], ["Accessories", "Accessories", null, "hardware"]],
  );
  assert.deepEqual(legacyMaterials(undefined), []);
});

test("BOM source: template / none / forbidden (403) / error / loading — never 'none' while unknown", () => {
  const ok = tplResp([T({})]);
  assert.equal(bomSource(ok, "1003-(3S)", { error: false, status: null }).kind, "template");
  assert.equal(bomSource(tplResp([]), "1003-(3S)", { error: false, status: null }).kind, "none");
  assert.equal(bomSource(tplResp([T({ versionStatus: "DRAFT" })]), "1003-(3S)", { error: false, status: null }).kind, "none");
  // A stale response for another SKU (mid-navigation) is not "no BOM".
  assert.equal(bomSource(ok, "1052-(Q)", { error: false, status: null }).kind, "loading");
  assert.equal(bomSource(undefined, "1003-(3S)", { error: false, status: null }).kind, "loading");
  assert.equal(bomSource(undefined, "1003-(3S)", { error: true, status: 403 }).kind, "forbidden");
  assert.equal(bomSource(undefined, "1003-(3S)", { error: true, status: 500 }).kind, "error");
  assert.equal(bomSource({ success: false, error: "x" }, "1003-(3S)", { error: false, status: null }).kind, "error");
});
