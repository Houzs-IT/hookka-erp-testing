// Owner 2026-11-23: a phone punch MUST carry a location (no more "No GPS"
// punches), the factory fence shrinks 200 m → 150 m, and a refused punch shows
// a popup in the worker's language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the server refuses a punch with no coordinates", () => {
  const src = read("src/api/routes/worker.ts");
  assert.match(src, /if \(lat == null \|\| lng == null\) \{\s*return c\.json\(\s*\{\s*success: false,\s*code: "LOCATION_REQUIRED"/);
});

test("the factory fence is 150 m everywhere it is drawn", async () => {
  const { DEFAULT_FACTORY_GEOFENCE } = await import("../src/api/lib/geofence.ts");
  assert.equal(DEFAULT_FACTORY_GEOFENCE.radiusM, 150);
  assert.match(read("src/pages/employees.tsx"), /radiusM: 150 \}/);
  assert.match(read("src/pages/m/screens/employees/attendance-location.ts"), /radiusM: 150 \}/);
  assert.match(read("src/pages/employees.tsx"), /vs the \{ATT_FENCE\.radiusM\}&nbsp;m factory fence/);
});

test("a refused punch opens a popup whose text comes from the worker's language", () => {
  const page = read("src/pages/worker/index.tsx");
  assert.match(page, /if \(!loc\) \{[\s\S]{0,200}setLocPopup\(true\);\s*return;/);
  assert.match(page, /code === "LOCATION_REQUIRED"\) \{\s*setLocPopup\(true\);/);
  assert.match(page, /\{t\("home\.locationRequired"\)\}/);
  const i18n = read("src/lib/worker-i18n.ts");
  const block = i18n.slice(i18n.indexOf("'home.locationRequired'"), i18n.indexOf("'home.locationRequired'") + 600);
  for (const lang of ["en:", "ms:", "zh:", "my:"]) assert.ok(block.includes(lang), `missing ${lang}`);
});
