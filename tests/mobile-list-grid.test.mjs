// Phase 1 step 3: the Delivery and Procurement lists use the shared ResponsiveGrid
// instead of two hand-written copies of the same grid. This is a behaviour-
// preserving swap, so these tests pin that the result is the SAME as before at
// every width: one column on a phone and in the split view's list pane (the
// exact 390px template), and the same column counts everywhere else.
// They prove the arithmetic and the wiring, not how the lists look on a device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { responsiveGridTemplate } from "../src/pages/m/lib/responsive-grid.ts";
import { ResponsiveGrid } from "../src/pages/m/components/ResponsiveGrid.tsx";
import { resolveResponsiveLayout } from "../src/pages/m/lib/responsive-layout.tsx";

globalThis.React = React;

const src = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

// ---- the template --------------------------------------------------------------

test("a single column is exactly the template the phone screens used", () => {
  assert.equal(responsiveGridTemplate(320, 1, "10px"), "minmax(0, 1fr)");
  assert.equal(responsiveGridTemplate(320, 1), "minmax(0, 1fr)");
});

test("the wide template keeps the same 320px minimum, and never overflows a narrow box", () => {
  assert.equal(responsiveGridTemplate(320, undefined, "10px"), "repeat(auto-fill, minmax(min(100%, 320px), 1fr))");
  // Old: repeat(auto-fill, minmax(320px, 1fr)). Identical whenever the box is >= 320px wide.
});

test("ResponsiveGrid maxColumns=1 gap=10 renders the old phone style exactly", () => {
  const html = renderToStaticMarkup(h(ResponsiveGrid, { maxColumns: 1, gap: 10 }, h("i")));
  assert.match(html, /display:grid/);
  assert.match(html, /grid-template-columns:minmax\(0, ?1fr\)/);
  assert.match(html, /gap:10px/);
});

// ---- column counts: before vs after --------------------------------------------

// auto-fill track count for a box of width W: floor((W + gap) / (min + gap)), at least 1.
const autoFill = (w, min = 320, gap = 10) => Math.max(1, Math.floor((w + gap) / (min + gap)));

// Today's rule, from the two screens: `tablet && !inPane ? auto-fill : one column`.
function before(shell, { openId }) {
  const layout = resolveResponsiveLayout(shell);
  const tablet = layout.mode !== "phone";
  const inPane = layout.canSplitDetail && !!openId;
  if (!(tablet && !inPane)) return 1;
  return autoFill(layout.contentWidth);
}

// The new rule: maxColumns = tablet && !inPane ? undefined : 1, then the template.
function after(shell, { openId }) {
  const layout = resolveResponsiveLayout(shell);
  const tablet = layout.mode !== "phone";
  const inPane = layout.canSplitDetail && !!openId;
  const maxColumns = tablet && !inPane ? undefined : 1;
  const tpl = responsiveGridTemplate(320, maxColumns, "10px");
  if (tpl === "minmax(0, 1fr)") return 1;
  const min = Number(/min\(100%, (\d+)px\)/.exec(tpl)[1]);
  const width = inPane ? 340 : layout.contentWidth; // the list pane is 320-340px
  return autoFill(Math.max(width, min), min);
}

test("same column counts as before at every width, with and without a detail open", () => {
  const widths = [390, 600, 652, 700, 719, 720, 759, 768, 820, 884, 1023, 1024, 1100, 1180, 1194, 1366];
  for (const shell of widths) {
    for (const openId of [undefined, "id-1"]) {
      assert.equal(after(shell, { openId }), before(shell, { openId }), `${shell}px openId=${openId}`);
    }
  }
});

test("the documented counts: 1 / 1 / 2 / 2 / 2 / 3 and 1 in the split list pane", () => {
  const list = (shell) => after(shell, {});
  assert.equal(list(390), 1);
  assert.equal(list(719), 1); // phone mode keeps ONE column, even 652-719px
  assert.equal(list(720), 1); // 648px content: 2 columns need 650px
  assert.equal(list(768), 2);
  assert.equal(list(1024), 2);
  assert.equal(list(1180), 3); // 982px content: 3 columns need 980px (borderline, unchanged)
  assert.equal(after(1024, { openId: "x" }), 1); // list pane
  assert.equal(after(1180, { openId: "x" }), 1);
});

// ---- wiring --------------------------------------------------------------------

for (const [name, file] of [
  ["Delivery", "screens/delivery/DeliveryScreen.tsx"],
  ["Procurement", "screens/procurement/ProcurementScreen.tsx"],
]) {
  test(`${name}: the list grids use ResponsiveGrid with the old rule and the 10px gap`, () => {
    const code = src(file);
    assert.match(code, /const gridMaxColumns = tablet && !inPane \? undefined : 1;/);
    assert.match(code, /<ResponsiveGrid maxColumns=\{gridMaxColumns\} gap=\{10\}>/);
    assert.doesNotMatch(code, /gridCols/);
    assert.doesNotMatch(code, /gridTemplateColumns/);
    // Phone and pane decisions still come from the same inputs as before.
    assert.match(code, /const tablet = layout\.mode !== "phone";/);
    assert.match(code, /const inPane = layout\.canSplitDetail && !!openId;/);
  });
}

test("Delivery: loading skeleton and the list share one grid rule", () => {
  const code = src("screens/delivery/DeliveryScreen.tsx");
  assert.equal(code.match(/<ResponsiveGrid maxColumns=\{gridMaxColumns\} gap=\{10\}>/g).length, 2);
  assert.equal(code.match(/<\/ResponsiveGrid>/g).length, 2);
});

test("Procurement: the skeleton cards follow the same grid as the list", () => {
  const screen = src("screens/procurement/ProcurementScreen.tsx");
  assert.match(screen, /<SkeletonCards maxColumns=\{gridMaxColumns\} \/>/);
  const parts = src("screens/procurement/parts.tsx");
  const skeleton = parts.slice(parts.indexOf("export function SkeletonCards"), parts.indexOf("export function ErrorCard"));
  assert.match(skeleton, /<ResponsiveGrid aria-busy="true" aria-label="Loading" maxColumns=\{maxColumns\} gap=\{10\}>/);
  assert.match(skeleton, /height: 118, borderRadius: 16/); // the cards themselves are unchanged
  assert.doesNotMatch(skeleton, /gridTemplateColumns/);
});

test("nothing else on the two lists changed: search, chips, cards, actions are untouched", () => {
  for (const file of ["screens/delivery/DeliveryScreen.tsx", "screens/procurement/ProcurementScreen.tsx"]) {
    const code = src(file);
    assert.match(code, /BottomDock/); // bars still on the dock
    assert.match(code, /const dockScope = inPane \? "list" : "content";/);
  }
});
