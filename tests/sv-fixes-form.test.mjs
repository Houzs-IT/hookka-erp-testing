// ---------------------------------------------------------------------------
// sv-fixes-form.test.mjs — regressions for the mobile SV form fixes (C1 custom scope seed/lock, C2/C3 duplicate
// PO/SO warning outcomes, G1 line totals from the shared pricing sum, G2 draft hub clearing) + the case screen's
// New-SV entry. Pure logic; no real data. Desktop refs: repair-scope-picker.tsx handleScopePresetChange /
// toggleScopeDept, create.tsx ~1948 (warning) and getLineTotal, edit.tsx getLineTotal, sales-orders.ts PUT hubId.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blankHeader, blankLine, createOutcome, editBody, FULL_SCOPE, isLockedDept, lineBody, lineFromServer, lineProblem, lineTotalSen,
  resultCard, scopeForPreset, scopeFromStored, scopeToStored, toggleScopeDept, totals, unitPriceSen,
} from "../src/pages/m/screens/orders/sv-form-model.ts";
import { calculateLineTotal, calculateUnitPrice } from "../src/lib/pricing.ts";
import { validateRepairScopeInput } from "../src/lib/repair-scope.ts";

const header = (p = {}) => ({ ...blankHeader("2026-11-10"), customerId: "c1", hubId: "h1", ...p });
const line = (p = {}) => ({ ...blankLine(), productId: "p1", productCode: "HB-1", itemCategory: "BEDFRAME", fabricCode: "LN-005", ...p });

// ---- C1 ---------------------------------------------------------------------------------------------------------
test("C1: Custom starts with exactly Upholstery + Packing, no components; locked depts ignore taps", () => {
  const c = scopeForPreset(FULL_SCOPE(), "CUSTOM");
  assert.deepEqual(c, { preset: "CUSTOM", depts: ["UPHOLSTERY", "PACKING"], components: [] });
  assert.ok(isLockedDept("UPHOLSTERY") && isLockedDept("PACKING") && !isLockedDept("FRAMING"));
  assert.deepEqual(toggleScopeDept(c, "UPHOLSTERY"), c);
  assert.deepEqual(toggleScopeDept(c, "PACKING"), c);
  const t = toggleScopeDept(toggleScopeDept(c, "FRAMING"), "FAB_CUT");
  assert.deepEqual(t.depts, ["FAB_CUT", "FRAMING", "UPHOLSTERY", "PACKING"]); // chain order, not tick order
  assert.deepEqual(toggleScopeDept(t, "FRAMING").depts, ["FAB_CUT", "UPHOLSTERY", "PACKING"]);
});

test("C1: every reachable Custom payload carries Upholstery + Packing and passes the shared validator", () => {
  let s = scopeForPreset(FULL_SCOPE(), "CUSTOM");
  for (const d of ["WOOD_CUT", "FRAMING", "WOOD_CUT", "UPHOLSTERY", "PACKING"]) s = toggleScopeDept(s, d);
  const stored = JSON.parse(scopeToStored(s));
  assert.ok(stored.depts.includes("UPHOLSTERY") && stored.depts.includes("PACKING"));
  assert.equal(lineProblem(line({ scope: s })), "");
  assert.equal(validateRepairScopeInput(scopeToStored(s)).ok, true);
  const seeded = JSON.parse(lineBody(line({ scope: scopeForPreset(FULL_SCOPE(), "CUSTOM") })).repairScope);
  assert.deepEqual(seeded.depts, ["UPHOLSTERY", "PACKING"]);
});

test("C1: switching presets back and forth resets like desktop; named presets drop components", () => {
  const custom = { preset: "CUSTOM", depts: ["FAB_CUT", "UPHOLSTERY", "PACKING"], components: [{ key: "k", label: "L", qty: 1 }] };
  assert.equal(scopeForPreset(custom, "CUSTOM"), custom); // same preset: no-op
  const fabric = scopeForPreset(custom, "FABRIC");
  assert.deepEqual(fabric, { preset: "FABRIC", depts: [], components: [] });
  assert.deepEqual(JSON.parse(scopeToStored(fabric)).depts, ["FAB_CUT", "FAB_SEW", "UPHOLSTERY", "PACKING"]);
  assert.deepEqual(scopeForPreset(fabric, "CUSTOM"), { preset: "CUSTOM", depts: ["UPHOLSTERY", "PACKING"], components: [] });
  assert.equal(scopeToStored(scopeForPreset(custom, "FULL")), null);
  assert.deepEqual(toggleScopeDept(fabric, "FRAMING"), fabric); // toggling only applies to Custom
});

test("C1: a stored Custom scope round-trips unchanged on edit load (picks kept, desktop does not rewrite depts)", () => {
  const raw = JSON.stringify({ preset: "CUSTOM", depts: ["FRAMING", "UPHOLSTERY", "PACKING"], components: [{ key: "a::0::HB::X", label: "Headboard", qty: 2 }] });
  const l = lineFromServer({ id: "i1", productId: "p", productCode: "HB", repairScope: raw }, 0);
  assert.equal(scopeToStored(l.scope), raw);
  assert.equal(scopeToStored(toggleScopeDept(l.scope, "UPHOLSTERY")), raw); // locked tap changes nothing
  assert.equal(toggleScopeDept(l.scope, "FAB_CUT").components.length, 1); // picks survive a dept toggle
  assert.deepEqual(scopeFromStored(raw).depts, ["FRAMING", "UPHOLSTERY", "PACKING"]);
});

// ---- C2 / C3 ------------------------------------------------------------------------------------------------------
test("C2/C3: duplicate PO/SO warning outcomes", () => {
  assert.deepEqual(createOutcome(false, "PO already on SO-1"), { kind: "warn_draft", text: "PO already on SO-1" });
  assert.deepEqual(createOutcome(true, "PO already on SO-1"), { kind: "warn_unconfirmed", text: "PO already on SO-1" });
  assert.deepEqual(createOutcome(false, undefined), { kind: "open" });
  assert.deepEqual(createOutcome(false, "   "), { kind: "open" });
  assert.deepEqual(createOutcome(true, null), { kind: "confirm" });
});

test("C2/C3: result cards - warning never offers a confirm retry; real confirm failure does", () => {
  assert.equal(resultCard("warn_unconfirmed").title, "Draft saved; not confirmed");
  assert.equal(resultCard("warn_unconfirmed").retry, false);
  assert.equal(resultCard("warn_draft").retry, false);
  assert.equal(resultCard("confirm_failed").title, "Draft saved; confirmation failed.");
  assert.equal(resultCard("confirm_failed").retry, true);
  assert.ok(!/confirmation failed/i.test(resultCard("warn_unconfirmed").title));
});

// ---- G1 ------------------------------------------------------------------------------------------------------------
test("G1: displayed line total = shared pricing sum x qty - discount, surcharges included", () => {
  const stored = lineFromServer({ id: "i1", productId: "p", productCode: "HB", quantity: 3, basePriceSen: 100000, divanPriceSen: 5000, legPriceSen: 2000, totalHeightPriceSen: 3000, specialOrderPriceSen: 4000, discountSen: 7000 }, 0);
  const unit = calculateUnitPrice({ basePriceSen: 100000, divanPriceSen: 5000, legPriceSen: 2000, totalHeightPriceSen: 3000, specialOrderPriceSen: 4000 });
  assert.equal(unit, 114000);
  assert.equal(unitPriceSen(stored), unit);
  assert.equal(lineTotalSen(stored), Math.max(0, calculateLineTotal(unit, 3) - 7000));
  assert.equal(lineTotalSen(stored), 335000);
  assert.deepEqual(totals([stored, line({ quantity: 2, basePriceSen: 1000 })]), { lines: 2, qty: 5, subtotalSen: 337000, totalSen: 337000 });
});

test("G1: zero-price line is 0, a discount never goes below 0, sent surcharges are unchanged", () => {
  assert.equal(lineTotalSen(line({ basePriceSen: 0 })), 0);
  assert.equal(lineTotalSen(line({ basePriceSen: 1000, discountSen: 5000 })), 0);
  const stored = lineFromServer({ id: "i1", productId: "p", productCode: "HB", quantity: 1, basePriceSen: 100, divanPriceSen: 50, specialOrderPriceSen: 25 }, 0);
  const body = lineBody(stored);
  assert.equal(body.divanPriceSen, 50);
  assert.equal(body.specialOrderPriceSen, 25);
  assert.equal(body.basePriceSen, 100);
});

// ---- G2 ---------------------------------------------------------------------------------------------------------------
test("G2: draft whose customer changed to one with no hub sends hubId ''", () => {
  const stored = { customerId: "c1", hubId: "h1" };
  const b = editBody(header({ customerId: "c2", hubId: "" }), [line()], { draft: true, stored });
  assert.equal(b.hubId, "");
  assert.equal(editBody(header({ hubId: "" }), [line()], { draft: true, stored }).hubId, ""); // hub cleared, same customer
});

test("G2: new hub is sent; unchanged hub / no hub stays as before; confirmed orders never send hubId", () => {
  const stored = { customerId: "c1", hubId: "h1" };
  assert.equal(editBody(header({ customerId: "c2", hubId: "h9" }), [line()], { draft: true, stored }).hubId, "h9");
  assert.equal(editBody(header(), [line()], { draft: true, stored }).hubId, "h1");
  assert.ok(!("hubId" in editBody(header({ hubId: "", customerId: "c1" }), [line()], { draft: true, stored: { customerId: "c1", hubId: "" } })));
  assert.ok(!("hubId" in editBody(header({ customerId: "c2", hubId: "" }), [line()], { draft: false, stored })));
  assert.ok(!("hubId" in editBody(header({ hubId: "h9" }), [line()], { draft: false, stored })));
  assert.ok(!("hubId" in editBody(header({ hubId: "" }), [line()], { draft: true }))); // no stored info: legacy behaviour
});

// ---- Case screen: New SV entry ----------------------------------------------------------------------------------------
test("case screen: stale 'not available on phone' sheet is gone and New SV opens the mobile form with fromCase", () => {
  const src = readFileSync(new URL("../src/pages/m/screens/cases/CaseDetailScreen.tsx", import.meta.url), "utf8");
  assert.ok(!/isn.t available on phone/i.test(src));
  assert.ok(!src.includes("setSvInfo"));
  assert.ok(src.includes("SV_NEW_PATH") && src.includes("?fromCase=${encodeURIComponent(c.id)}"));
  const mods = readFileSync(new URL("../src/pages/m/config/modules.ts", import.meta.url), "utf8");
  assert.ok(!mods.includes("/sales/create?fromCase="));
  assert.ok(mods.includes("/m/serviceorders/sv/new?fromCase="));
});
