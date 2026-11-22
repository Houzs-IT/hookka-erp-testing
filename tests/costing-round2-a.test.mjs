// costing-round2-a.test.mjs — owner 2026-11-22 round 2 (design canvas v2 ①③④):
// fabric tier prices set from the costing page; customer prices changed on
// the product page through the SAME price history; list dropdown tiles on
// total cost + Export PDF from the list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateFabricTiers, normaliseFabricTiers } from "../src/lib/product-costing.ts";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("tier save is strict: names unique, From ≤ To, To > 0, 1–10 levels", () => {
  assert.deepEqual(validateFabricTiers([{ level: "Lv1", minSen: "1000", maxSen: 1200 }]), [{ level: "Lv1", minSen: 1000, maxSen: 1200 }]);
  assert.equal(validateFabricTiers([{ level: "Lv1", minSen: 1300, maxSen: 1200 }]), null);
  assert.equal(validateFabricTiers([{ level: "A", minSen: 0, maxSen: 100 }, { level: "a", minSen: 0, maxSen: 200 }]), null);
  assert.equal(validateFabricTiers([]), null);
  assert.equal(validateFabricTiers([{ level: "", minSen: 0, maxSen: 100 }]), null);
  assert.equal(validateFabricTiers(Array.from({ length: 11 }, (_, i) => ({ level: `L${i}`, minSen: 0, maxSen: 100 }))), null);
});

test("tiers are stored with who/when; old bare-array value still reads", () => {
  const r = read("src/api/routes/product-costing.ts");
  assert.match(r, /JSON\.stringify\(\{ tiers, updatedBy, updatedAt \}\)/);
  assert.match(r, /const tiers = validateFabricTiers\(incoming\);/);
  assert.match(r, /normaliseFabricTiers\(obj \? obj\.tiers : v\)/);
  assert.equal(normaliseFabricTiers([{ level: "X", minSen: 1, maxSen: 2 }]).length, 1);
});

test("costing page: Set tier prices on the tier card, saves through the API, refreshes every reader", () => {
  const card = read("src/pages/products/fabric-tier-card.tsx");
  assert.match(card, />Set tier prices</);
  assert.match(card, /fetch\("\/api\/product-costing\/fabric-tiers", \{\s*method: "PUT"/);
  assert.match(card, /invalidateCachePrefix\("\/api\/product-costing"\)/);
  assert.match(read("src/pages/products/costing.tsx"), /<FabricTierCard/);
});

test("customer price change = the customer page's price history (one source), with effective date", () => {
  const ca = read("src/pages/products/customer-assignments.tsx");
  assert.match(ca, /\/api\/customer-products\/\$\{encodeURIComponent\(a\.id\)\}\/prices`, \{\s*method: "POST"/);
  assert.match(ca, /effectiveFrom: form\.from/);
  assert.match(ca, /invalidateCachePrefix\("\/api\/customer-products"\)/);
  assert.match(read("src/api/routes/customer-products.ts"), /\(await actorName\(c, body\.createdBy\)\)/);
  assert.match(read("src/pages/products/customers.tsx"), /costSen=\{data\?\.data\?\.totalSen \?\? null\}/);
  assert.match(read("src/pages/products/customers.tsx"), /`\/api\/product-costing\/\$\{encodeURIComponent\(id\)\}`/);
});

test("list dropdown: cost tiles on TOTAL cost, Export PDF from the list, CNC folded", () => {
  const p = read("src/pages/products/index.tsx");
  assert.doesNotMatch(p, /Price vs Labor \(Margin\)/);
  assert.match(p, /const total = hasMat \? laborCostSen \+ cs\.materialSen : null;/);
  assert.match(p, /<CostingExportMenu productId=\{p\.id\} align="left" \/>/);
  assert.match(p, /<summary[^>]*>CNC cutting template<\/summary>/);
  assert.match(read("src/pages/products/costing.tsx"), /<CostingExportMenu productId=\{c\.product\.id\} tier=\{c\.tier\} \/>/);
});

test("customer prices say Price 2 (not 'base price') and a bedframe shows its worked-out Price 3", () => {
  const ca = readFileSync(new URL("../src/pages/products/customer-assignments.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ca, />Base Price</);
  assert.match(ca, />Price 2</);
  assert.match(ca, /New Price 2 \(RM\)/);
  assert.match(ca, /const isBed = category === "BEDFRAME";/);
  assert.match(ca, /bedframePrice3Sen\(newBase\)/);
  assert.match(readFileSync(new URL("../src/pages/products/customers.tsx", import.meta.url), "utf8"), /category=\{p\.category\}/);
});
