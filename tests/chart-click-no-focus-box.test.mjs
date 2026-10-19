// chart-click-no-focus-box.test.mjs — BUG-2026-10-19-335: recharts 3 gives the
// chart surface tabindex=0, so a click focused it and drew a box round the
// chart (and a fast click selected the axis labels). One global rule covers
// every chart; this pins it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("index.css removes the click focus box and text selection on every chart", () => {
  const css = readFileSync("src/index.css", "utf8");
  assert.match(css, /\.recharts-wrapper \{\s*user-select: none;\s*\}/);
  assert.match(css, /\.recharts-wrapper \*:focus \{\s*outline: none;\s*\}/);
});
