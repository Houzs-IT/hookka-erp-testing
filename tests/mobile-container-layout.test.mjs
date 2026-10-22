// Container-aware layout foundation (Phase 1, batch 1): the pane width classes,
// the pane context, ResponsiveGrid and PageContainer. Pure logic + a server
// render of the context; no browser. Visual parity at 390/768/820/1024/1180 is
// NOT proven here, only the arithmetic and the wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CONTAINER_REGULAR_MIN_WIDTH,
  CONTAINER_WIDE_MIN_WIDTH,
  PaneProvider,
  ResponsiveLayoutProvider,
  estimatePaneWidths,
  resolveContainerLayout,
  resolveContainerSize,
  resolveResponsiveLayout,
  useContainerLayout,
} from "../src/pages/m/lib/responsive-layout.tsx";
import { GRID_MIN_COLUMN_WIDTH, responsiveGridTemplate } from "../src/pages/m/lib/responsive-grid.ts";
import { ResponsiveGrid } from "../src/pages/m/components/ResponsiveGrid.tsx";
import { PAGE_MAX_WIDTH, PageContainer } from "../src/pages/m/components/PageContainer.tsx";

// The app builds with Vite's automatic JSX runtime; tsx under node:test compiles
// JSX with the classic transform, which needs React in scope.
globalThis.React = React;

const src = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

// ---- size classes ----------------------------------------------------------

test("size class boundaries", () => {
  assert.equal(CONTAINER_REGULAR_MIN_WIDTH, 520);
  assert.equal(CONTAINER_WIDE_MIN_WIDTH, 880);
  assert.equal(resolveContainerSize(0), "compact");
  assert.equal(resolveContainerSize(-5), "compact");
  assert.equal(resolveContainerSize(519), "compact");
  assert.equal(resolveContainerSize(520), "regular");
  assert.equal(resolveContainerSize(879), "regular");
  assert.equal(resolveContainerSize(880), "wide");
});

test("the five test widths land in the intended container classes", () => {
  // Single-pane content width = shell width minus the rail (compact 72 / full 198).
  const content = (shell) => resolveResponsiveLayout(shell).contentWidth;
  assert.equal(resolveContainerLayout(content(390)).size, "compact"); // phone baseline
  assert.equal(resolveContainerLayout(content(768)).size, "regular"); // 696
  assert.equal(resolveContainerLayout(content(820)).size, "regular"); // 748
  assert.equal(resolveContainerLayout(content(1024)).size, "regular"); // 826
  assert.equal(resolveContainerLayout(content(1180)).size, "wide"); // 982
});

test("the 719/720 and 1023/1024 shell boundaries", () => {
  const content = (shell) => resolveResponsiveLayout(shell).contentWidth;
  assert.equal(resolveContainerLayout(content(719)).size, "regular"); // phone mode, 719 wide, no rail
  assert.equal(resolveContainerLayout(content(720)).size, "regular"); // 648 (compact rail)
  // Crossing 1024 swaps the 72px rail for the 198px one, so the content box
  // SHRINKS from 951 to 826: wide -> regular. Known and intended: the container
  // class follows the box the content really has, not the device width.
  assert.equal(content(1023), 951);
  assert.equal(resolveContainerLayout(content(1023)).size, "wide");
  assert.equal(content(1024), 826);
  assert.equal(resolveContainerLayout(content(1024)).size, "regular");
});

// ---- panes -----------------------------------------------------------------

test("pane width estimates agree with the split geometry", () => {
  for (const shell of [884, 1024, 1180, 1366]) {
    const layout = resolveResponsiveLayout(shell);
    assert.equal(layout.canSplitDetail, true, `${shell} splits`);
    const { list, detail } = estimatePaneWidths(layout);
    assert.ok(list >= 320 && list <= 340, `${shell} list pane ${list}`);
    assert.equal(list + 1 + detail, layout.contentWidth, `${shell} panes fill the content`);
    assert.equal(resolveContainerLayout(list, "list").size, "compact");
  }
});

test("a split list pane is phone-sized; the detail pane is sized by its own width", () => {
  const l1024 = estimatePaneWidths(resolveResponsiveLayout(1024));
  assert.equal(resolveContainerSize(l1024.list), "compact");
  assert.equal(resolveContainerSize(l1024.detail), "compact"); // ~485px: stays single-column
  const l1366 = estimatePaneWidths(resolveResponsiveLayout(1366));
  assert.equal(resolveContainerSize(l1366.detail), "regular");
});

function probe() {
  let seen;
  function P() {
    seen = useContainerLayout();
    return null;
  }
  return { P, get: () => seen };
}

test("useContainerLayout falls back to the shell content width outside a pane", () => {
  const shell = resolveResponsiveLayout(1024, 826);
  const { P, get } = probe();
  renderToStaticMarkup(h(ResponsiveLayoutProvider, { value: shell }, h(P)));
  assert.deepEqual(get(), { width: 826, size: "regular", pane: "full" });
});

test("useContainerLayout prefers the nearest pane", () => {
  const shell = resolveResponsiveLayout(1024, 826);
  const { P, get } = probe();
  renderToStaticMarkup(
    h(
      ResponsiveLayoutProvider,
      { value: shell },
      h(PaneProvider, { value: resolveContainerLayout(340, "list") }, h(P)),
    ),
  );
  assert.deepEqual(get(), { width: 340, size: "compact", pane: "list" });
});

test("with no provider at all the 390px default is compact", () => {
  const { P, get } = probe();
  renderToStaticMarkup(h(P));
  assert.equal(get().size, "compact");
  assert.equal(get().width, 390);
});

// ---- ResponsiveGrid --------------------------------------------------------

test("grid template: as many columns as fit, never overflowing a narrow box", () => {
  assert.equal(GRID_MIN_COLUMN_WIDTH, 320);
  assert.equal(responsiveGridTemplate(), "repeat(auto-fill, minmax(min(100%, 320px), 1fr))");
  assert.equal(responsiveGridTemplate(200), "repeat(auto-fill, minmax(min(100%, 200px), 1fr))");
});

test("grid template: maxColumns caps the count with an equal-share floor", () => {
  assert.equal(
    responsiveGridTemplate(240, 3, "12px"),
    "repeat(auto-fill, minmax(max(min(100%, 240px), calc((100% - 12px * 2) / 3)), 1fr))",
  );
  assert.equal(responsiveGridTemplate(240, 0), responsiveGridTemplate(240));
});

test("ResponsiveGrid renders a grid with the gap token and merges style", () => {
  const html = renderToStaticMarkup(
    h(ResponsiveGrid, { style: { marginTop: 4 }, "aria-label": "cards" }, h("i", null, "a")),
  );
  assert.match(html, /display:grid/);
  assert.match(html, /grid-template-columns:repeat\(auto-fill, ?minmax\(min\(100%, ?320px\), ?1fr\)\)/);
  assert.match(html, /gap:var\(--m-card-gap, ?12px\)/);
  assert.match(html, /margin-top:4px/);
  assert.match(html, /aria-label="cards"/);
  const numeric = renderToStaticMarkup(h(ResponsiveGrid, { gap: 8 }, h("i")));
  assert.match(numeric, /gap:8px/);
});

// ---- PageContainer ---------------------------------------------------------

test("PageContainer centres and caps; it adds no padding of its own", () => {
  assert.equal(PAGE_MAX_WIDTH, 760); // the width Delivery / Procurement already cap at
  const html = renderToStaticMarkup(h(PageContainer, null, h("i")));
  assert.match(html, /max-width:760px/);
  assert.match(html, /margin-left:auto/);
  assert.match(html, /margin-right:auto/);
  assert.doesNotMatch(html, /padding/, "screens own their approved 390px padding");
  const wide = renderToStaticMarkup(h(PageContainer, { maxWidth: "60rem" }, h("i")));
  assert.match(wide, /max-width:60rem/);
  // "none" keeps a screen uncapped, like a split-view pane today.
  const uncapped = renderToStaticMarkup(h(PageContainer, { maxWidth: "none" }, h("i")));
  assert.match(uncapped, /max-width:none/);
});

// ---- wiring and guard rails ------------------------------------------------

test("TwoPane measures each pane and provides its width", () => {
  const layout = src("MobileLayout.tsx");
  assert.match(layout, /<PaneProvider value=\{leftPane\}>/);
  assert.match(layout, /<PaneProvider value=\{rightPane\}>/);
  assert.match(layout, /resolveContainerLayout\(leftWidth, "list"\)/);
  assert.match(layout, /resolveContainerLayout\(rightWidth, "detail"\)/);
  // TwoPane is still only mounted when the split view is allowed, so a phone never reaches it.
  assert.match(layout, /layout\.canSplitDetail \? \(\s*<TwoPane/);
  // The shell chrome keeps deciding from the SHELL layout.
  assert.match(layout, /layout\.hasBottomNavigation/);
});

test("the new primitives are CSS-only and token-only", () => {
  for (const f of ["components/ResponsiveGrid.tsx", "components/PageContainer.tsx"]) {
    const code = src(f);
    assert.doesNotMatch(code, /useResponsiveLayout|useContainerLayout|innerWidth|matchMedia/, `${f} reads no viewport`);
    assert.doesNotMatch(code, /#[0-9A-Fa-f]{6}\b/, `${f} hard-codes no colour`);
    assert.doesNotMatch(code, /position:\s*"fixed"/, `${f} has no fixed positioning`);
  }
});

test("the primitives are exported from the components barrel", () => {
  const barrel = src("components/index.ts");
  assert.match(barrel, /export \{ ResponsiveGrid \} from "\.\/ResponsiveGrid"/);
  assert.match(barrel, /export \{ PageContainer \} from "\.\/PageContainer"/);
});

test("no existing screen was migrated in this batch", () => {
  for (const f of [
    "screens/delivery/DeliveryScreen.tsx",
    "screens/procurement/ProcurementScreen.tsx",
    "screens/DocumentDetailScreen.tsx",
    "screens/ProductsScreen.tsx",
  ]) {
    const code = src(f);
    assert.doesNotMatch(code, /ResponsiveGrid|PageContainer|useContainerLayout/, `${f} untouched`);
  }
});
