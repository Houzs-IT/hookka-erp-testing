// show_me screenshots (owner 2026-11-27): freshness without running
// Playwright — every recorded button label must still exist in src/, every
// screenshot file must exist and the set stays small. If this fails, the UI
// changed: re-capture screenshots (npm run dev, then npm run help:shots).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync, readFileSync } from "node:fs";
import { HELP_SHOTS, HELP_SHOTS_VIEWPORT } from "../src/api/lib/howto/help-shots.ts";
import { SCREENS } from "../src/api/lib/mcp-screens.ts";
import { annotatedSvg, pickShot, realPageLink, showMeContent, TEST_DATA_NOTE } from "../src/api/lib/mcp-show-me.ts";
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

// BUG-2026-11-27-596: Claude does not accept SVG image content. The tool's
// image item is the plain WebP; the red box goes into the text as coordinates;
// the annotated SVG stays behind the 15-minute link.
test("show_me: image item is the plain WebP (never SVG); red-box coordinates and the 15-minute link in the text", () => {
  if (!HELP_SHOTS.length) return;
  const s = HELP_SHOTS[0];
  const pick = pickShot({ path: s.page, label: s.boxes[0].label });
  assert.ok(!("error" in pick));
  const content = showMeContent({ webpBase64: "UklGRg==", pick, imageLink: "https://r2.example/show-me.svg?sig=1", realPage: "https://erp.example/x?highlight=y", capturedAt: "2026-11-27" });
  const images = content.filter((c) => c.type === "image");
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, "image/webp");
  assert.equal(images[0].data, "UklGRg==");
  assert.ok(!content.some((c) => c.type === "image" && /svg/i.test(c.mimeType)), "no SVG image item");
  const t = JSON.parse(content.find((c) => c.type === "text").text);
  assert.deepEqual(t.redBox, { x: pick.box.x, y: pick.box.y, width: pick.box.w, height: pick.box.h, screenshotWidth: HELP_SHOTS_VIEWPORT.width, screenshotHeight: HELP_SHOTS_VIEWPORT.height });
  assert.equal(t.imageLink, "https://r2.example/show-me.svg?sig=1");
  assert.equal(t.imageLinkExpires, "15 minutes");
  assert.equal(t.press, pick.box.label);
  assert.match(t.note, /test data/);
  // No link → no expiry claim.
  const noLink = JSON.parse(showMeContent({ webpBase64: "A", pick, imageLink: null, realPage: null, capturedAt: "x" })[1].text);
  assert.equal(noLink.imageLinkExpires, undefined);
});

test("show_me route: sends showMeContent, never an image/svg+xml image item", () => {
  const src = readFileSync(new URL("../src/api/routes/mcp.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('name === "show_me"'), src.indexOf("HELP_TOOLS.has(name)"));
  assert.match(block, /showMeContent\(/);
  assert.doesNotMatch(block, /type: "image"[^}]*svg/);
  // The SVG is still uploaded behind the link.
  assert.match(block, /uploadExportAndSign\([^)]*"image\/svg\+xml"/);
});
