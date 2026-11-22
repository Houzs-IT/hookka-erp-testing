// BUG-2026-11-22-542: picking another fabric tier on the costing page blanked
// the whole page to "Loading costing…" for a moment (the URL changes, so the
// cached fetch reseeds to null). The page now keeps the last costing of the
// same product on screen while the new tier loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/pages/products/costing.tsx", import.meta.url), "utf8");

test("tier switch keeps the last costing of the same product on screen", () => {
  assert.match(src, /const c = resp\?\.data \?\? \(loading && sameProduct\(shown\) \? shown : undefined\);/);
  assert.match(src, /d\.product\.id === id \|\| d\.product\.code === id/);
});

test("the clicked tier highlights at once and the page dims while loading", () => {
  assert.match(src, /selected=\{switchingTier \? tier : c\.tier\}/);
  assert.match(src, /aria-busy=\{switchingTier \|\| undefined\}/);
});
