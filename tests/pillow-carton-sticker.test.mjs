// Owner 2026-11-20: every pillow of an order is packed in ONE box with its own
// packing sticker (item + colour + qty lines, total), numbered after the sofa
// pieces (2 sofa + pillows → 3/3). The old corner note on the last sofa
// compartment is gone. Foam Bonding's print brings the order's pillows too.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const s = readFileSync("src/pages/production/index.tsx", "utf8");

test("pillows are ONE extra piece per order, a carton sticker", () => {
  assert.match(s, /compartmentCount \+ \(hasLegs \? 1 : 0\) \+ \(hasPillow \? 1 : 0\)/);
  assert.match(s, /buildPillowCarton\(rawPillows, compartmentCount \+ legShift \+ 1, totalPacks, fullCompartment\)/);
  // pillow-only order: a 1/1 carton, not loose stickers
  assert.match(s, /nonSofa\.push\(buildPillowCarton\(pillows, 1, 1, ""\)\)/);
  assert.match(s, /isPillowCarton: true,\s*\n\s*isSyntheticPillow: false,\s*\n\s*comboPairKey: undefined,/);
});

test("the carton body renders on screen, in the Foam preview and in print", () => {
  for (const scale of ["screen", "foam", "print"]) {
    assert.match(s, new RegExp(`<PillowCartonLines s=\{s\} scale="${scale}" />`));
  }
  assert.match(s, /function splitPillowName\(/);
});

test("labels say Packing Sticker", () => {
  assert.match(s, /Packing Sticker Preview/);
  assert.doesNotMatch(s, /FG Sticker Preview/);
});

test("Foam Bonding print brings the order's pillows", () => {
  assert.match(s, /\(isPillowPo\(o\) && soSet\.has\(o\.companySOId \|\| ""\)\)/);
});
