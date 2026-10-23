// Tablet rail auto-compact: while a split-view detail is open the rail compacts
// if the detail pane would otherwise be phone-sized, unless the user has chosen a
// rail state themselves. These tests pin the geometry and, above all, that the
// rule cannot oscillate. They prove the arithmetic and the wiring, not how it looks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTAINER_REGULAR_MIN_WIDTH,
  estimatePaneWidths,
  resolveRailExpanded,
  resolveResponsiveLayout,
} from "../src/pages/m/lib/responsive-layout.tsx";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

const defaults = (shell) => resolveResponsiveLayout(shell).mode === "tablet-landscape";
const rail = (shell, { open, explicit = false, preferred = defaults(shell) }) =>
  resolveRailExpanded({ shellWidth: shell, preferred, explicit, splitDetailOpen: open });

// ---- the widths you asked for -------------------------------------------------

test("768: portrait defaults to a compact rail and nothing changes", () => {
  assert.equal(rail(768, { open: false }), false);
  assert.equal(rail(768, { open: true }), false);
});

test("1023: still portrait (compact by default); nothing changes", () => {
  assert.equal(rail(1023, { open: false }), false);
  assert.equal(rail(1023, { open: true }), false);
});

test("1024: the full rail compacts only while a detail is open", () => {
  assert.equal(rail(1024, { open: false }), true); // list: rail as designed
  assert.equal(rail(1024, { open: true }), false); // detail would be 505px
});

test("1180: the detail already has room, so the rail stays expanded", () => {
  assert.equal(estimatePaneWidths(resolveResponsiveLayout(1180, undefined, true)).detail, 641);
  assert.equal(rail(1180, { open: true }), true);
  assert.equal(rail(1180, { open: false }), true);
});

test("a phone never changes", () => {
  assert.equal(rail(390, { open: true, preferred: false }), false);
  assert.equal(rail(719, { open: true, preferred: false }), false);
});

// ---- the user's own choice ----------------------------------------------------

test("an explicit expanded choice is respected even where it would compact", () => {
  assert.equal(rail(1024, { open: true, explicit: true, preferred: true }), true);
});

test("an explicit collapsed choice is respected everywhere", () => {
  for (const shell of [1024, 1180, 1366]) {
    for (const open of [true, false]) {
      assert.equal(rail(shell, { open, explicit: true, preferred: false }), false, `${shell} open=${open}`);
    }
  }
});

test("an explicit expanded choice in portrait is left alone", () => {
  assert.equal(rail(768, { open: true, explicit: true, preferred: true }), true);
  assert.equal(rail(1023, { open: true, explicit: true, preferred: true }), true);
});

// ---- Option A: closing the detail restores the previous state ------------------

test("open then close returns to the preference", () => {
  for (const shell of [1024, 1030, 1180]) {
    const before = rail(shell, { open: false });
    const during = rail(shell, { open: true });
    const after = rail(shell, { open: false });
    assert.equal(after, before, `${shell} restores`);
    assert.equal(during === before, shell !== 1024 && shell !== 1030, `${shell} during`);
  }
});

// ---- the 520px threshold --------------------------------------------------------

test("the threshold is the shared 'regular' container class", () => {
  assert.equal(CONTAINER_REGULAR_MIN_WIDTH, 520);
});

test("sweep 720-1600: which shell widths compact, and what they gain", () => {
  const compacting = [];
  for (let shell = 720; shell <= 1600; shell += 1) {
    const out = rail(shell, { open: true });
    const mode = resolveResponsiveLayout(shell).mode;
    if (mode === "tablet-landscape" && out === false) compacting.push(shell);
  }
  // Exactly the iPad-class 1024 widths: 1024..1038.
  assert.equal(compacting[0], 1024);
  assert.equal(compacting.at(-1), 1038);
  assert.equal(compacting.length, 15);
  for (const shell of compacting) {
    const full = resolveResponsiveLayout(shell, undefined, true);
    const compact = resolveResponsiveLayout(shell, undefined, false);
    const fullDetail = estimatePaneWidths(full).detail;
    assert.ok(fullDetail < CONTAINER_REGULAR_MIN_WIDTH, `${shell}: needed (${fullDetail}px)`);
    assert.ok(compact.canSplitDetail, `${shell}: the split view stays open`);
    const compactDetail = estimatePaneWidths(compact).detail;
    assert.ok(compactDetail >= CONTAINER_REGULAR_MIN_WIDTH, `${shell}: compacting is enough (${compactDetail}px)`);
    assert.ok(compactDetail > fullDetail, `${shell}: it widens the detail`);
  }
  // Nothing else changes: portrait, 1039+ landscape.
  for (let shell = 720; shell <= 1600; shell += 1) {
    if (shell >= 1024 && shell <= 1038) continue;
    assert.equal(rail(shell, { open: true }), defaults(shell), `${shell} untouched`);
  }
});

test("how sensitive the trigger is to the threshold (documented, not changed)", () => {
  // The detail-pane width with the full rail, at the widths that matter.
  const detail = (shell) => estimatePaneWidths(resolveResponsiveLayout(shell, undefined, true)).detail;
  assert.equal(detail(1024), 505);
  assert.equal(detail(1038) < 520, true);
  assert.equal(detail(1039) >= 520, true); // the trigger flips between two widths 1px apart
  assert.equal(detail(1080), 546);
  assert.equal(detail(1180), 641);
});

// ---- no oscillation -----------------------------------------------------------

test("the decision ignores the current rail, so opening/closing cannot feed back", () => {
  for (let shell = 720; shell <= 1600; shell += 7) {
    for (const open of [true, false]) {
      const decided = rail(shell, { open });
      // Apply it, then decide again from the resulting layout's own shell width:
      // the shell width does not depend on the rail, so the answer is the same.
      const layout = resolveResponsiveLayout(shell, undefined, decided);
      assert.equal(layout.shellWidth, shell);
      assert.equal(rail(layout.shellWidth, { open }), decided, `${shell} open=${open} is a fixed point`);
    }
  }
});

test("a rule that measured the CURRENT detail pane would oscillate (why we do not)", () => {
  // At 1024 with the rail expanded the detail is 505 (<520) -> compact; compact
  // gives 611 (>=520) -> expand; 505 again ... forever.
  const naive = (shell, railExpanded) => {
    const layout = resolveResponsiveLayout(shell, undefined, railExpanded);
    return estimatePaneWidths(layout).detail >= CONTAINER_REGULAR_MIN_WIDTH;
  };
  let state = true;
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    state = naive(1024, state);
    seen.push(state);
  }
  assert.deepEqual(seen, [false, true, false, true, false, true]);
  // Ours is constant for the same input.
  const ours = Array.from({ length: 6 }, () => rail(1024, { open: true }));
  assert.deepEqual(ours, [false, false, false, false, false, false]);
});

// ---- wiring ---------------------------------------------------------------------

test("the shell feeds the rule the route and the explicit-choice flags", () => {
  const code = read("MobileLayout.tsx");
  assert.match(code, /function isSplitDetailPath\(pathname: string\)/);
  assert.match(code, /MODULE_CONFIGS\.find\(\(c\) => c\.slug === slug\)/);
  assert.match(code, /CUSTOM_L2\[slug\] \|\| cfg\.detail/);
  assert.match(code, /splitDetailOpen: isSplitDetailPath\(pathname\)/);
  assert.match(code, /explicit: railExplicit\[shellLayout\.mode\]/);
  assert.match(code, /hasRailExpandedPreference\("tablet-landscape"\)/);
});

test("the toggle acts on what is shown and saves it as the user's own choice", () => {
  const code = read("MobileLayout.tsx");
  const toggle = code.slice(code.indexOf("const toggleRail"), code.indexOf("// Phone left drawer"));
  assert.match(toggle, /const expanded = !railExpanded/);
  assert.match(toggle, /writeRailExpandedPreference\(mode, expanded\)/);
  assert.match(toggle, /setRailExplicit\(\(current\) => \(\{ \.\.\.current, \[mode\]: true \}\)\)/);
});

test("the rail eases its width with the reduced-motion-aware token", () => {
  const rail = read("components/LeftRail.tsx");
  assert.match(rail, /transition: "width var\(--m-motion-standard, 180ms\) ease"/);
  const css = read("theme-vars.css");
  assert.match(css, /--m-motion-standard: 180ms;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*body\[data-theme\] \{[^}]*--m-motion-standard: 0\.01ms;/);
});
