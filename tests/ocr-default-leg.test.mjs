// Owner 2026-11-11: a scanned customer PO that names no leg gets the product's
// Default Leg Height (Products › Variant Defaults), as the typed Sales Order
// form already does — the FG sticker read "Leg —" for scanned 5540 orders.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const eng = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/scan-engine.ts")).href);
const read = (p) => readFileSync(p, "utf8");

test("defaultLegInchesOf reads products.defaultVariants.legHeight", () => {
  assert.equal(eng.defaultLegInchesOf('{"legHeight":"6\\""}'), 6);
  assert.equal(eng.defaultLegInchesOf({ legHeight: '1"' }), 1);
  assert.equal(eng.defaultLegInchesOf({ legHeight: "No Leg" }), null);
  assert.equal(eng.defaultLegInchesOf(null), null);
  assert.equal(eng.defaultLegInchesOf("not json"), null);
});

test("scan catalog carries the default; extraction applies it only when the PO names no leg", () => {
  const e = read("src/api/lib/scan-engine.ts");
  assert.match(e, /SELECT code, name, category, sizeLabel, defaultVariants FROM products/);
  assert.match(e, /defaultLegInches: defaultLegInchesOf\(p\.defaultVariants \?\? p\.default_variants\),/);
  const s = read("src/api/routes/scan-po.ts");
  assert.match(s, /item\.legHeightInches == null && !item\.noLeg && !saysNoLeg/);
  assert.match(s, /if \(prod\?\.defaultLegInches\) item\.legHeightInches = prod\.defaultLegInches;/);
});

test("backfill: open orders only, product defaults, skips 'no leg', dry-run by default", () => {
  const s = read("src/api/routes/import-completion/sofa-pricing.ts");
  assert.match(s, /app\.post\("\/backfill-default-leg-heights"/);
  assert.match(s, /so\.status IN \('DRAFT','CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','ON_HOLD'\)/);
  assert.match(s, /const dryRun = body\.dryRun !== false;\n  const db = c\.var\.DB;\n  const orgId = getOrgId\(c\);/);
  assert.match(s, /if \(NO_LEG\.test\(/);
});
