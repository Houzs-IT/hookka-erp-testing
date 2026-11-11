// m-product-detail.test.mjs — the phone / tablet Product detail
// (src/pages/m/screens/ProductDetailScreen.tsx, Products Hub v2).
//
// BUG-2026-10-21-346 (class C16 row 12): the generic detail printed
// "Base Price RM 0.00" for every sofa and for every role whose selling prices
// the API strips. These pins keep Products on its own detail, keep the pricing
// card behind product-pricing:read, and keep a missing price from ever being
// formatted as money. The price rules themselves are covered by priceDisplay()
// in tests/m-products-hub.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SCREEN = read("src/pages/m/screens/ProductDetailScreen.tsx");

test("Products route to ProductDetailScreen, not the generic detail with its Base Price row", () => {
  const layout = read("src/pages/m/MobileLayout.tsx");
  const l2 = layout.slice(layout.indexOf("const CUSTOM_L2"), layout.indexOf("};", layout.indexOf("const CUSTOM_L2")));
  assert.match(l2, /\bproducts:\s*ProductDetailScreen\b/, "CUSTOM_L2 must map products → ProductDetailScreen");
});

test("the whole pricing card is gated on product-pricing:read", () => {
  assert.match(SCREEN, /hasPermission\("product-pricing", "read"\)/);
  assert.match(SCREEN, /canPrice \? <PricingCard\b/, "PricingCard renders only when canPrice");
});

test("a missing price is never formatted as money (no RM 0.00)", () => {
  // Prices come only from priceDisplay(), whose kinds carry a positive sen or nothing.
  assert.match(SCREEN, /priceDisplay\(p\)/);
  assert.doesNotMatch(SCREEN, /money\(\s*num\(/, "never money(num(...)) — num() turns a missing key into 0");
  assert.doesNotMatch(SCREEN, /money\(\s*0\s*\)|\?\?\s*0\)/, "never format a defaulted 0");
  // Bedframe columns print "—" for an unset tier instead of formatting undefined.
  assert.match(SCREEN, /v == null \? "—" : money\(v\)/);
  assert.match(SCREEN, /No price set/);
});

test("no 'from' price; the BOM 'Active' badge only for a verified active template", () => {
  assert.doesNotMatch(SCREEN, /\bFROM\b|PRICE FROM|SEAT PRICES FROM/);
  // The badge lives only in the template branch of the BOM section.
  assert.match(SCREEN, /src\.kind === "template"\) \{[\s\S]{0,200}const v = src\.template\.version;[\s\S]{0,700}Active\{v \?/);
  assert.equal((SCREEN.match(/Active\{v \?/g) || []).length, 1);
});

test("BOM / Production read the ACTIVE template for this exact code; legacy rows only as a labelled fallback", () => {
  assert.match(SCREEN, /\/api\/bom\/templates\?productCode=\$\{encodeURIComponent\(code\)\}&versionStatus=ACTIVE/);
  assert.match(SCREEN, /bomSource\(tpl\.data, code, \{ error: !!tpl\.error, status: tpl\.failure\?\.status \?\? null \}\)/);
  assert.match(SCREEN, /showing the SKU’s saved/);
  assert.doesNotMatch(SCREEN, /No BOM components recorded|No department times recorded/, "the old misleading empty states are gone");
});

test("Family sheet: every SKU-row price behind product-pricing:read; Sofa rows carry no price", () => {
  const LIST = read("src/pages/m/screens/ProductsScreen.tsx");
  assert.match(LIST, /canPrice \? <FamilyRowPrice p=\{p\} \/> : null/);
  assert.match(LIST, /function FamilyRowPrice[\s\S]{0,200}if \(p\.category === "SOFA"\) return null;/);
  assert.match(SCREEN, /<FamilySheet[\s\S]{0,200}canPrice=\{canPrice\}/);
  assert.doesNotMatch(LIST, /"FROM"/, "no From stat");
});

test("shared Sheet: the new props are optional and default to the old look", () => {
  const SHEET = read("src/pages/m/components/Sheet.tsx");
  assert.match(SHEET, /bare = false, phoneRadius = 20/);
  assert.match(SHEET, /\{bare \? children : <div style=\{\{ padding: "8px 16px 16px" \}\}>\{children\}<\/div>\}/);
  assert.match(SHEET, /\{title && !bare \? \(/);
});

test("the Production total is the sum of the rows, labelled apart from the hero Prod. time", () => {
  assert.match(SCREEN, /Department Time Total/);
  assert.match(SCREEN, /deptRows\(doc\?\.deptWorkingTimes\)/);
  assert.match(SCREEN, /fmtMinutes\(p\.productionTimeMinutes\)/, "hero tile reads productionTimeMinutes");
});
