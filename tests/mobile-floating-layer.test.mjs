// Phase 1 step 2: floating layers. Toasts and bars are placed by ONE primitive
// (ResponsiveActionDock) instead of hard-coded fixed offsets. These tests pin the
// positions it produces and that the two migrated toasts keep their phone offsets.
// They prove the arithmetic and the wiring, not how it looks on a device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PaneProvider,
  ResponsiveLayoutProvider,
  resolveContainerLayout,
  resolveResponsiveLayout,
} from "../src/pages/m/lib/responsive-layout.tsx";
import { ResponsiveActionDock } from "../src/pages/m/components/ResponsiveActionDock.tsx";

// The app uses Vite's automatic JSX runtime; tsx under node:test needs React in scope.
globalThis.React = React;

const SAFE = "env(safe-area-inset-bottom)";
const src = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

function dock(shell, props = {}, pane) {
  const layout = resolveResponsiveLayout(shell);
  let tree = h(ResponsiveActionDock, props, h("i", null, "x"));
  if (pane) tree = h(PaneProvider, { value: resolveContainerLayout(pane.width, pane.kind) }, tree);
  return renderToStaticMarkup(h(ResponsiveLayoutProvider, { value: layout }, tree));
}

// ---- the dock ---------------------------------------------------------------

test("phone: left/right 0 and the phone gap plus the safe-area inset", () => {
  const html = dock(390, { phoneBottom: 104, zIndex: 80 });
  assert.match(html, /left:0/);
  assert.match(html, /right:0/);
  assert.ok(html.includes(`bottom:calc(104px + ${SAFE})`), html);
  assert.match(html, /z-index:80/);
  assert.match(html, /pointer-events:none/);
});

test("defaults are unchanged for every existing caller", () => {
  // phoneBottom 56, tablet flush at the bottom, content scope.
  const phone = dock(390);
  assert.ok(phone.includes(`bottom:calc(56px + ${SAFE})`));
  const tablet = dock(820);
  assert.match(tablet, /bottom:0/);
  assert.doesNotMatch(tablet, /safe-area/);
  assert.match(tablet, /data-responsive-action-dock="content"/);
  assert.match(tablet, /left:72px/); // the compact rail
});

test("tablet: a floating toast gets its own gap plus the safe-area inset", () => {
  const html = dock(820, { tabletBottom: 84 });
  assert.ok(html.includes(`bottom:calc(84px + ${SAFE})`), html);
  assert.match(html, /left:72px/);
});

test("split view: list and detail scopes align to their own pane", () => {
  const list = dock(1024, { scope: "list" });
  assert.match(list, /left:198px/);
  assert.match(list, /width:320px/);
  const detail = dock(1024, { scope: "detail" });
  assert.match(detail, /left:518px/); // 198 rail + 320 list pane
});

test("scope=auto follows the pane the dock is rendered in", () => {
  assert.match(dock(1024, { scope: "auto" }), /data-responsive-action-dock="content"/);
  const inList = dock(1024, { scope: "auto" }, { kind: "list", width: 320 });
  assert.match(inList, /data-responsive-action-dock="list"/);
  assert.match(inList, /width:320px/);
  const inDetail = dock(1024, { scope: "auto" }, { kind: "detail", width: 505 });
  assert.match(inDetail, /data-responsive-action-dock="detail"/);
  assert.match(inDetail, /left:518px/);
});

test("scope=auto equals the explicit scope screens compute today", () => {
  // Delivery / Procurement: `canSplitDetail ? "detail" : "content"` for a detail
  // and `inPane ? "list" : "content"` for a list. Same result from the pane.
  for (const shell of [390, 820, 1024, 1180]) {
    const split = resolveResponsiveLayout(shell).canSplitDetail;
    const explicitDetail = dock(shell, { scope: split ? "detail" : "content" });
    const autoDetail = dock(shell, { scope: "auto" }, split ? { kind: "detail", width: 500 } : undefined);
    assert.equal(autoDetail, explicitDetail, `detail @${shell}`);
  }
});

test("a phone ignores the pane scope: always the full-width bottom strip", () => {
  const a = dock(390, { scope: "auto", phoneBottom: 72 }, { kind: "list", width: 340 });
  const b = dock(390, { scope: "content", phoneBottom: 72 });
  assert.equal(a.replace('data-responsive-action-dock="list"', 'data-responsive-action-dock="content"'), b);
});

// ---- migrated toasts ----------------------------------------------------------

test("DocumentDetail toast: same phone offsets (120 above the bar, 72 without), now on the dock", () => {
  const code = src("screens/DocumentDetailScreen.tsx");
  const toast = code.slice(code.indexOf("function Toast("), code.indexOf("// Status-flow indicator"));
  assert.match(toast, /<ResponsiveActionDock scope="auto" phoneBottom=\{raised \? 120 : 72\} tabletBottom=\{raised \? 84 : 24\} zIndex=\{50\}>/);
  assert.doesNotMatch(toast, /position: "fixed"/);
  assert.doesNotMatch(toast, /100vw|calc\(120px|calc\(72px/);
  // The strip stays tappable to dismiss, and the visual is untouched.
  assert.match(toast, /onClick=\{onClose\}/);
  assert.match(toast, /maxWidth: 382/);
  assert.match(toast, /ok \? "#4F7C3A" : "#9A3A2D"/);
});

test("Delivery toast: same phone (104) and tablet (84) offsets, now on the dock", () => {
  const code = src("screens/delivery/ui.tsx");
  const toast = code.slice(code.indexOf("export function ToastView"), code.indexOf("export type ConfirmSpec"));
  assert.match(toast, /<ResponsiveActionDock scope="auto" phoneBottom=\{104\} tabletBottom=\{84\} zIndex=\{80\}>/);
  assert.doesNotMatch(toast, /position: "fixed"/);
  assert.doesNotMatch(toast, /100vw/);
  assert.match(toast, /maxWidth: "min\(340px, calc\(100% - 32px\)\)"/);
  assert.match(toast, /pointerEvents: "auto"/, "the dock is click-through, the toast must take clicks");
});

// ---- ratchet: no new hard-coded floating layers in screens ---------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("screens keep no more fixed-position layers than the known full-screen ones", () => {
  const root = new URL("../src/pages/m/screens", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const found = walk(decodeURIComponent(root))
    .filter((f) => /position:\s*"fixed"/.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(/\\/g, "/").replace(/^.*\/screens\//, ""))
    .sort();
  // Intentional full-screen layer (a dialog). Production Orders v3 moved its
  // desk-handoff sheet onto the shared Sheet. A new toast, bar or banner must use
  // ResponsiveActionDock, not a fixed offset.
  assert.deepEqual(found, ["procurement/parts.tsx"]);
});

test("screens do not size floating content from the viewport", () => {
  const root = new URL("../src/pages/m/screens", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const offenders = walk(decodeURIComponent(root)).filter((f) => /100vw/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
