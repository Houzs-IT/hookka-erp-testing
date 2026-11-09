// New models export (owner 2026-11-10): the board report's New models page
// comes from GET /api/products/new-models — models by product created date,
// one per family, cover photo and prices included. Fixtures use the shapes and
// figures read from prod on 2026-11-10 (HIPSTER bedframe, KABBIN sofa combos).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildNewModels, modelNameOf } from "../src/lib/new-models-export.ts";

const bed = (size, sen, createdAt = "2026-10-05T03:00:00Z") => ({
  code: `2138-(${size})`, name: `HIPSTER BEDFRAME (${size}) (183X190CM)`, category: "BEDFRAME",
  sizeLabel: size, sizeCode: size, createdAt, basePriceSen: sen, seatHeightPrices: [],
});
const sofa = (piece, sen, createdAt = "2026-10-20T03:00:00Z") => ({
  code: `5568-${piece}`, name: `KABBIN ${piece}`, category: "SOFA", sizeLabel: piece, sizeCode: piece, createdAt,
  basePriceSen: null, seatHeightPrices: [{ height: "24", priceSen: sen, tier: "PRICE_2" }, { height: "28", priceSen: sen + 5000, tier: "PRICE_2" }],
});
const OCT = { from: "2026-10-01", to: "2026-10-31" };

test("one card per family, sizes folded in, newest first", () => {
  const out = buildNewModels(
    [bed("5FT", 90500), bed("6FT", 111000), bed("SuperKing", 181000), bed("3FT", 88500), sofa("1A(LHF)", 68000), sofa("1A(RHF)", 68000), sofa("1NA", 55000)],
    [], new Map(), OCT,
  );
  assert.deepEqual(out.map((m) => m.code), ["5568", "2138"]);
  const h = out[1];
  assert.equal(h.name, "HIPSTER");
  assert.equal(h.skus, 4);
  assert.equal(h.sizes, "3FT · 5FT · 6FT · Super King");
  assert.equal(h.price, "Q 905 · K 1,110 · SK 1,810");
  assert.equal(h.price2, "3FT 885");
  // Left / right hand pieces are one size on the card.
  assert.equal(out[0].sizes, "1A · 1NA");
});

test("new = the family's FIRST created date; undated and out-of-range families are left out", () => {
  const old = bed("6FT", 111000, "2026-08-01T00:00:00Z");
  const newSizeOnOldModel = bed("3FT", 88500, "2026-10-10T00:00:00Z");
  const undated = { ...sofa("1NA", 55000), createdAt: null };
  assert.deepEqual(buildNewModels([old, newSizeOnOldModel, undated], [], new Map(), OCT), []);
});

test("sofa: combos first (deduped across customers, lowest and highest seat height), then seats", () => {
  const combos = [
    { baseModel: "5568", componentSizes: [["1NA", "2A(LHF)", "2A(RHF)", "L(LHF)", "L(RHF)"]], pricesByHeight: { 24: 258000, 28: 273000 }, fabricTier: "PRICE_2", customerName: "Carress" },
    { baseModel: "5568", componentSizes: [["2A(LHF)", "2A(RHF)", "L(LHF)", "L(RHF)"]], pricesByHeight: { 24: 198000, 28: 208000 }, fabricTier: "PRICE_2", customerName: "Carress" },
    { baseModel: "5568", componentSizes: [["2A(LHF)", "2A(RHF)"], ["L(LHF)", "L(RHF)"]], pricesByHeight: { 24: 198000, 28: 208000 }, fabricTier: "PRICE_2", customerName: "2990 HOME SDN BHD" },
    { baseModel: "5530", componentSizes: [["1S"], ["2S"]], pricesByHeight: { 24: 350000 }, fabricTier: "PRICE_2", customerName: "Houzs Century" },
  ];
  const [k] = buildNewModels([sofa("1A(LHF)", 68000), sofa("1NA", 55000)], combos, new Map(), OCT);
  assert.equal(k.price, "Combo 2A + L: 1,980 (24″) · 2,080 (28″)");
  assert.equal(k.price2, "Combo 1NA + 2A + L: 2,580 (24″) · 2,730 (28″)");
  const [noCombo] = buildNewModels([sofa("1A(LHF)", 50000), sofa("1NA", 55000)], [], new Map(), OCT);
  assert.equal(noCombo.price, "Seats from 550 (1NA) · 500 (1A)");
  assert.equal(noCombo.price2, "No combo price set yet");
});

test("sofa priced by length (DEFAULT height) lists the lengths", () => {
  const len = (s, sen) => ({ code: `8210-${s}`, name: `SOFA 8210 ${s}`, category: "SOFA", sizeLabel: s, sizeCode: s, createdAt: "2026-10-09", basePriceSen: null, seatHeightPrices: [{ height: "DEFAULT", priceSen: sen, tier: "PRICE_2" }] });
  const [m] = buildNewModels([len("7FT", 126000), len("4FT", 72000), len("6FT", 108000)], [], new Map(), OCT);
  assert.equal(m.name, "Sofa 8210");
  assert.equal(m.price, "4FT 720 · 6FT 1,080 · 7FT 1,260");
});

test("photo flags: in the map = has a Catalog photo; null value = photo missing from storage", () => {
  const photos = new Map([["2138", null], ["5568", "data:image/jpeg;base64,AAAA"]]);
  const out = buildNewModels([bed("6FT", 111000), sofa("1NA", 55000)], [], photos, OCT);
  const by = Object.fromEntries(out.map((m) => [m.code, m]));
  assert.equal(by["5568"].photo, "data:image/jpeg;base64,AAAA");
  assert.equal(by["2138"].hasPhoto, true);
  assert.equal(by["2138"].photo, null);
  assert.equal(buildNewModels([bed("6FT", 111000)], [], new Map(), OCT)[0].hasPhoto, false);
});

test("model names", () => {
  assert.equal(modelNameOf("(6FT) (183X190CM)", "2135", "BEDFRAME"), "Model 2135");
  assert.equal(modelNameOf("SOFA 5560 1A(LHF)", "5560", "SOFA"), "Sofa 5560");
  assert.equal(modelNameOf("BREEVA BEDFRAME ( (6FT) (183X190CM)", "2137", "BEDFRAME"), "BREEVA");
  assert.equal(modelNameOf("BACK CUSHION 05", "BC05", "ACCESSORY"), "BACK CUSHION 05");
});

test("route: registered before /:id, read-gated, prices and combos behind their own permissions", () => {
  const src = readFileSync("src/api/routes/products.ts", "utf8");
  const at = src.indexOf('app.get("/new-models"');
  assert.ok(at > 0 && at < src.indexOf('app.get("/:id"'), "must be registered before /:id");
  const body = src.slice(at, src.indexOf("\napp.", at + 10));
  assert.match(body, /requirePermission\(c, "products", "read"\)/);
  assert.match(body, /hasPermission\(c, "product-pricing", "read"\)/);
  assert.match(body, /hasPermission\(c, "sofa-combos", "read"\)/);
  assert.match(body, /canPrice \? base : null/);
  assert.match(body, /if \(canPrice && canCombo\)/);
  // No write path.
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/);
});

// Polish after the first prod read (2026-11-10): unpriced models said nothing,
// one combo priced differently per customer showed as two look-alike lines, and
// SERVICE CHARGE (filed as ACCESSORY) appeared as a "model".
test("a model with no price says so, but only when prices were included", () => {
  const unpriced = { ...sofa("1NA", 0), seatHeightPrices: [] };
  assert.equal(buildNewModels([unpriced], [], new Map(), OCT)[0].price, "No price set yet");
  assert.equal(buildNewModels([unpriced], [], new Map(), OCT, { pricesIncluded: false })[0].price, "");
});

test("the same combo priced differently per customer is one line with ranges", () => {
  const c = (cust, p28, p35) => ({ baseModel: "5568", componentSizes: [["1A(LHF)", "1A(RHF)"], ["2A(LHF)", "2A(RHF)"]], pricesByHeight: { 28: p28, 35: p35 }, fabricTier: "PRICE_2", customerName: cust });
  const [m] = buildNewModels([sofa("1A(LHF)", 68000)], [c("A", 157500, 200200), c("B", 175200, 228000)], new Map(), OCT);
  assert.equal(m.price, "Combo 1A + 2A: 1,575–1,752 (28″) · 2,002–2,280 (35″)");
});

test("charge lines are not models", () => {
  const svc = { code: "SERVICE CHARGE ", name: "SERVICE CHARGE", category: "ACCESSORY", sizeLabel: null, sizeCode: null, createdAt: "2026-10-03", basePriceSen: 10000, seatHeightPrices: [] };
  const pillow = { ...svc, code: "SQUARE PILLOW RDM", name: "SQUARE PILLOW", basePriceSen: 1000 };
  assert.deepEqual(buildNewModels([svc, pillow], [], new Map(), OCT).map((m) => m.code), ["SQUARE PILLOW RDM"]);
});
