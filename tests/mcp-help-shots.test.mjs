// show_me screenshots (owner 2026-11-27): freshness without running
// Playwright — every recorded button label must still exist in src/, every
// screenshot file must exist and the set stays small. If this fails, the UI
// changed: re-capture screenshots (npm run dev, then npm run help:shots).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { HELP_SHOTS, HELP_SHOTS_VIEWPORT } from "../src/api/lib/howto/help-shots.ts";
import { SCREENS } from "../src/api/lib/mcp-screens.ts";
import { annotatedSvg, pickShot, realPageLink, TEST_DATA_NOTE } from "../src/api/lib/mcp-show-me.ts";
import { labelExists } from "./_howto-check.mjs";

const pub = (f) => new URL(`../public${f}`, import.meta.url);

test("help shots: every recorded label still exists in src/ (else re-capture screenshots)", () => {
  const stale = [];
  for (const s of HELP_SHOTS) for (const b of s.boxes) if (!labelExists(b.label)) stale.push(`${s.page} · "${b.label}"`);
  assert.deepEqual(stale, [], `re-capture screenshots (npm run dev, then npm run help:shots) — these labels are gone from src/:\n${stale.join("\n")}`);
});

test("help shots: files exist, pages are real, boxes sit inside the viewport, total under 8 MB", () => {
  let bytes = 0;
  const pages = new Set(SCREENS.map((s) => s.path));
  for (const s of HELP_SHOTS) {
    assert.ok(existsSync(pub(s.file)), `missing ${s.file} — re-capture screenshots`);
    bytes += statSync(pub(s.file)).size;
    assert.ok(pages.has(s.page), `${s.page} is not in the screen map`);
    for (const b of s.boxes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0, `${s.page} ${b.label} box`);
      assert.ok(b.x + b.w <= HELP_SHOTS_VIEWPORT.width && b.y + b.h <= HELP_SHOTS_VIEWPORT.height, `${s.page} ${b.label} outside the viewport`);
    }
  }
  assert.ok(bytes < 8 * 1024 * 1024, `screenshots are ${(bytes / 1048576).toFixed(1)} MB`);
});

test("show_me: picks a box by path + label and by guide step; draws a red box", () => {
  if (!HELP_SHOTS.length) return;
  const s = HELP_SHOTS[0];
  const b = s.boxes[0];
  const pick = pickShot({ path: s.page, label: b.label });
  assert.ok(!("error" in pick), JSON.stringify(pick));
  assert.equal(pick.box.label, b.label);
  assert.ok(realPageLink("https://erp.example", pick).includes("?highlight="));
  const svg = annotatedSvg("data:image/webp;base64,AAAA", pick.box, "caption <&>");
  assert.match(svg, /<image /);
  assert.match(svg, /stroke="#E11D2E"/);
  assert.match(svg, /caption &lt;&amp;&gt;/);
  assert.ok("error" in pickShot({ path: "/nope-not-a-page", label: "x" }));
  assert.ok("error" in pickShot({ guide_id: "no-such-guide" }));
  assert.match(TEST_DATA_NOTE, /test data/);
});
