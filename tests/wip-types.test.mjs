// ---------------------------------------------------------------------------
// wip-types.test.mjs — the BOM WIP type dropdown list (src/lib/wip-types.ts):
// six fixed built-ins plus the extra names saved in Maintenance (Sandback).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { buildWipTypes, wipTypeCode, wipTypeAllowed, componentBadgeLabel, BUILT_IN_WIP_TYPES } from "../src/lib/wip-types.ts";

const BUILT_IN = Object.keys(BUILT_IN_WIP_TYPES);

test("name -> code", () => {
  assert.equal(wipTypeCode("Sandback"), "SANDBACK");
  assert.equal(wipTypeCode("  Sofa Foot-Rest "), "SOFA_FOOT_REST");
  assert.equal(wipTypeCode(" - "), "");
});

test("nothing saved -> built-ins plus Sandback; a saved empty list -> built-ins only", () => {
  assert.deepEqual(Object.keys(buildWipTypes(undefined)), [...BUILT_IN, "SANDBACK"]);
  assert.deepEqual(Object.keys(buildWipTypes("junk")), [...BUILT_IN, "SANDBACK"]);
  assert.deepEqual(buildWipTypes([]), BUILT_IN_WIP_TYPES);
});

test("extras append after built-ins; blanks, junk and clashes are skipped", () => {
  const t = buildWipTypes(["Sandback", "", 7, "divan", "sandback", "Back Rest"]);
  assert.deepEqual(Object.keys(t), [...BUILT_IN, "SANDBACK", "BACK_REST"]);
  assert.equal(t.SANDBACK.label, "Sandback");
  assert.equal(t.DIVAN.label, "Divan");
});

test("product types allowed per WIP type: unsaved code allows all; other categories read ACCESSORY", () => {
  const saved = { HEADBOARD: ["BEDFRAME"], SANDBACK: [] };
  assert.equal(wipTypeAllowed("HEADBOARD", "BEDFRAME", saved), true);
  assert.equal(wipTypeAllowed("HEADBOARD", "SOFA", saved), false);
  assert.equal(wipTypeAllowed("SANDBACK", "BEDFRAME", saved), false);
  assert.equal(wipTypeAllowed("DIVAN", "SOFA", saved), true);
  assert.equal(wipTypeAllowed("DIVAN", "SOFA", undefined), true);
  assert.equal(wipTypeAllowed("HEADBOARD", "PILLOW", { HEADBOARD: ["ACCESSORY"] }), true);
  assert.equal(wipTypeAllowed("HEADBOARD", undefined, { HEADBOARD: ["SOFA"] }), false);
});

// HK-0116: SB02's Fab Sew sticker printed no badge for a Sandback job card.
test("sticker badge: extra types print their own name; built-ins and wholes unchanged", () => {
  assert.equal(componentBadgeLabel({ wipType: "SANDBACK", wipName: "SB02 -Sandback" }, undefined), "Sandback");
  assert.equal(componentBadgeLabel({ wipType: "SANDBACK" }, ["Sandback"]), "Sandback");
  assert.equal(componentBadgeLabel({ wipType: "BACK_REST" }, ["Back Rest"]), "Back Rest");
  // Removed from Maintenance -> no badge rather than a guess.
  assert.equal(componentBadgeLabel({ wipType: "SANDBACK" }, []), null);
  assert.equal(componentBadgeLabel({ wipType: "ARMREST", wipName: "A01 COVE-13" }, undefined), "Armrest");
  assert.equal(componentBadgeLabel({ wipType: "BASE" }, undefined), "Base");
  for (const wipType of ["HEADREST", "SOFA_HEADREST", "FG_MAIN", "FG", "ACCESSORY", ""]) {
    assert.equal(componentBadgeLabel({ wipType, wipName: "SB02" }, undefined), null, wipType);
  }
  assert.equal(componentBadgeLabel({ wipType: "", wipName: '1007-(Q) 14" Divan' }, undefined), "Divan");
});
