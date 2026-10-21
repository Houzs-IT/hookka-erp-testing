// ---------------------------------------------------------------------------
// The yuan is CNY (owner 2026-10-20, Currency & FX — the design's code),
// replacing RMB everywhere. Measured on prod that day: no document, party,
// price-list row or GRN held RMB, so nothing is rewritten; a stored or typed
// RMB reads as CNY. The three tables whose 0001_init CHECK said ('MYR','RMB')
// are widened at runtime — catalogue-driven, NOT VALID — before the first CNY
// write, and only then. Made-up values only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { CURRENCY_ALIASES, normaliseCurrencyCode } from "../src/lib/currency-code.ts";
import { CURRENCY_CHECK_TABLES, CURRENCY_CHECK_V2, currencyCheckStatements } from "../src/api/lib/currency-checks.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("one reading of a currency code: upper-case, MYR when blank, RMB as CNY", () => {
  assert.equal(normaliseCurrencyCode(" rmb "), "CNY");
  assert.equal(normaliseCurrencyCode("CNY"), "CNY");
  assert.equal(normaliseCurrencyCode("usd"), "USD");
  assert.equal(normaliseCurrencyCode(""), "MYR");
  assert.equal(normaliseCurrencyCode(undefined), "MYR");
  assert.equal(normaliseCurrencyCode(null, ""), "", "a caller can ask for blank instead of MYR");
  assert.deepEqual({ ...CURRENCY_ALIASES }, { RMB: "CNY" });
});

test("widening a table's currency CHECK: drop whatever the catalogue names, add v2 NOT VALID", () => {
  assert.deepEqual([...CURRENCY_CHECK_TABLES], ["supplier_material_bindings", "price_histories", "goods_in_transit"]);
  assert.equal(CURRENCY_CHECK_V2, "CHECK (currency IN ('MYR','RMB','CNY'))", "an old RMB row stays valid");
  assert.deepEqual(
    currencyCheckStatements("price_histories", [{ conname: "price_histories_currency_check", def: "CHECK ((currency = ANY (ARRAY['MYR'::text, 'RMB'::text])))" }]),
    [
      'ALTER TABLE price_histories DROP CONSTRAINT IF EXISTS "price_histories_currency_check"',
      "ALTER TABLE price_histories ADD CONSTRAINT price_histories_currency_chk_v2 CHECK (currency IN ('MYR','RMB','CNY')) NOT VALID",
    ],
  );
  assert.deepEqual(
    currencyCheckStatements("goods_in_transit", [{ conname: "goods_in_transit_currency_chk_v2", def: "CHECK ((currency = ANY (ARRAY['MYR'::text, 'RMB'::text, 'CNY'::text])))" }]),
    [],
    "already admits CNY: nothing to do",
  );
  assert.deepEqual(
    currencyCheckStatements("supplier_material_bindings", []),
    ["ALTER TABLE supplier_material_bindings ADD CONSTRAINT supplier_material_bindings_currency_chk_v2 CHECK (currency IN ('MYR','RMB','CNY')) NOT VALID"],
    "no CHECK found: just add it",
  );
  const lib = read("src/api/lib/currency-checks.ts");
  assert.match(lib, /FROM pg_constraint\n\s+WHERE conrelid = '\$\{table\}'::regclass\n\s+AND contype = 'c'\n\s+AND pg_get_constraintdef\(oid\) ILIKE '%currency%'/);
  assert.match(lib, /return memoizeSelfApply\(/, "once per isolate, retried after a failure");
});

test("the price list, its history and goods in transit store CNY — and touch the schema only for a CNY write", () => {
  const sm = read("src/api/routes/supplier-materials.ts");
  assert.match(sm, /currency: normaliseCurrencyCode\(body\.currency\) === "CNY" \? "CNY" : "MYR",/);
  assert.match(sm, /if \(row\.currency === "CNY"\) \{\n\s+await ensureCnyCurrency\(c\.var\.DB, "supplier_material_bindings"\);\n\s+await ensureCnyCurrency\(c\.var\.DB, "price_histories"\);\n\s+\}/);
  assert.match(sm, /if \(merged\.currency === "CNY"\) \{\n\s+await ensureCnyCurrency\(c\.var\.DB, "supplier_material_bindings"\);/);
  assert.match(sm, /currency: normaliseCurrencyCode\(r\.currency\),/, "an old RMB row reads as CNY");
  const ph = read("src/api/routes/price-history.ts");
  assert.match(ph, /if \(row\.currency === "CNY"\) await ensureCnyCurrency\(c\.var\.DB, "price_histories"\);/);
  const git = read("src/api/routes/goods-in-transit.ts");
  assert.match(git, /if \(row\.currency === "CNY"\) await ensureCnyCurrency\(c\.var\.DB, "goods_in_transit"\);/);
  for (const [name, src] of [["supplier-materials", sm], ["price-history", ph], ["goods-in-transit", git]]) {
    assert.doesNotMatch(src, /"RMB"/, `${name} no longer writes RMB`);
  }
});

test("the screens offer CNY, never RMB", () => {
  const grn = read("src/pages/procurement/grn-detail.tsx");
  assert.match(grn, /<option value="CNY">CNY<\/option>/);
  assert.doesNotMatch(grn, /value="RMB"/);
  const types = read("src/types/index.ts");
  assert.doesNotMatch(types, /"MYR" \| "RMB"/);
});
