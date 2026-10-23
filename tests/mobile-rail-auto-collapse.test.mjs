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
  railToggleOutcome,
  resolveRailExpanded,
  resolveResponsiveLayout,
  shouldAutoCompactRail,
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

test("the toggle is temporary while auto-compacted, a saved choice otherwise", () => {
  const code = read("MobileLayout.tsx");
  const toggle = code.slice(code.indexOf("const toggleRail"), code.indexOf("// Phone left drawer"));
  assert.match(toggle, /railToggleOutcome\(\{ autoCompact: railAutoCompact, shown: railExpanded \}\)/);
  assert.match(toggle, /if \(outcome\.temporary\) \{\s*setRailTempExpanded\(\(current\) => !current\);\s*return;/);
  // The temporary branch returns BEFORE anything is saved.
  assert.ok(toggle.indexOf("return;") < toggle.indexOf("writeRailExpandedPreference"));
  assert.match(toggle, /writeRailExpandedPreference\(mode, outcome\.expanded\)/);
  assert.match(toggle, /setRailExplicit\(\(current\) => \(\{ \.\.\.current, \[mode\]: true \}\)\)/);
});

test("the temporary expand is dropped as soon as auto-compact stops applying", () => {
  const code = read("MobileLayout.tsx");
  assert.match(code, /if \(!railAutoCompact && railTempExpanded\) setRailTempExpanded\(false\);/);
  assert.match(code, /resolveRailExpanded\(\{ \.\.\.railRule, tempExpanded: railTempExpanded \}\)/);
});

test("the rail eases its width with the reduced-motion-aware token", () => {
  const rail = read("components/LeftRail.tsx");
  assert.match(rail, /transition: "width var\(--m-motion-standard, 180ms\) ease"/);
  const css = read("theme-vars.css");
  assert.match(css, /--m-motion-standard: 180ms;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*body\[data-theme\] \{[^}]*--m-motion-standard: 0\.01ms;/);
});

// ---- temporary expand (owner decision 2026-10-23) ---------------------------------

test("tempExpanded only matters while auto-compacted", () => {
  const input = (shell, over = {}) => ({ shellWidth: shell, preferred: true, explicit: false, splitDetailOpen: true, ...over });
  // 1024 + detail: compact, or expanded when the user expands it temporarily.
  assert.equal(resolveRailExpanded(input(1024)), false);
  assert.equal(resolveRailExpanded({ ...input(1024), tempExpanded: true }), true);
  // Everywhere else the flag is ignored: the preference decides.
  assert.equal(resolveRailExpanded({ ...input(1024, { splitDetailOpen: false }), tempExpanded: false }), true);
  assert.equal(resolveRailExpanded({ ...input(1180), tempExpanded: false }), true);
  assert.equal(resolveRailExpanded({ ...input(1024, { explicit: true, preferred: false }), tempExpanded: true }), false);
  assert.equal(resolveRailExpanded({ ...input(768, { preferred: false }), tempExpanded: true }), false);
});

test("railToggleOutcome: temporary during auto-compact, otherwise the opposite of what is shown", () => {
  assert.deepEqual(railToggleOutcome({ autoCompact: true, shown: false }), { temporary: true });
  assert.deepEqual(railToggleOutcome({ autoCompact: true, shown: true }), { temporary: true });
  assert.deepEqual(railToggleOutcome({ autoCompact: false, shown: true }), { temporary: false, expanded: false });
  assert.deepEqual(railToggleOutcome({ autoCompact: false, shown: false }), { temporary: false, expanded: true });
});

/** The shell's state machine, built only from the shared pure functions. */
function shell(width) {
  const state = { preferred: width >= 1024, explicit: false, temp: false, open: false, saved: [] };
  const view = () => {
    const rule = { shellWidth: width, preferred: state.preferred, explicit: state.explicit, splitDetailOpen: state.open };
    const auto = shouldAutoCompactRail(rule);
    if (!auto && state.temp) state.temp = false; // the same reset MobileLayout does during render
    return { auto, shown: resolveRailExpanded({ ...rule, tempExpanded: state.temp }) };
  };
  return {
    state,
    view,
    open() { state.open = true; return view(); },
    close() { state.open = false; return view(); },
    toggle() {
      const { auto, shown } = view();
      const outcome = railToggleOutcome({ autoCompact: auto, shown });
      if (outcome.temporary) state.temp = !state.temp;
      else { state.preferred = outcome.expanded; state.explicit = true; state.saved.push(outcome.expanded); }
      return view();
    },
  };
}

test("repeated open / close: auto-compact returns every time", () => {
  const app = shell(1024);
  assert.equal(app.view().shown, true);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(app.open().shown, false, `open #${i}`);
    assert.equal(app.close().shown, true, `close #${i}`);
  }
});

test("expanding during auto-compact is temporary: it ends when the detail closes", () => {
  const app = shell(1024);
  app.open();
  assert.equal(app.toggle().shown, true, "expanded for now");
  assert.deepEqual(app.state.saved, [], "nothing saved");
  assert.equal(app.state.explicit, false, "auto-compact is not disabled");
  assert.equal(app.close().shown, true, "list view: the normal expanded rail");
  assert.equal(app.open().shown, false, "the NEXT detail auto-compacts again");
});

test("repeated: expand temporarily, close, open, expand, close ... never sticks", () => {
  const app = shell(1024);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(app.open().shown, false);
    assert.equal(app.toggle().shown, true);
    assert.equal(app.close().shown, true);
  }
  assert.deepEqual(app.state.saved, []);
  assert.equal(app.state.explicit, false);
});

test("switching between details keeps the temporary expand; toggling again undoes it", () => {
  const app = shell(1024);
  app.open();
  app.toggle(); // expand
  assert.equal(app.open().shown, true, "another detail opens: still expanded");
  assert.equal(app.toggle().shown, false, "tap again: back to auto-compact");
  assert.deepEqual(app.state.saved, []);
});

test("a choice made outside auto-compact is saved and respected from then on", () => {
  const app = shell(1024);
  // List view: the rail is expanded; the user collapses it -> saved.
  assert.equal(app.toggle().shown, false);
  assert.deepEqual(app.state.saved, [false]);
  assert.equal(app.open().shown, false);
  assert.equal(app.close().shown, false);
  // And expanding it again outside auto-compact is saved too, and then wins over auto-compact.
  assert.equal(app.toggle().shown, true);
  assert.deepEqual(app.state.saved, [false, true]);
  assert.equal(app.open().shown, true, "explicit expanded: no auto-compact");
});

test("resizing out of the narrow range drops a temporary expand", () => {
  const rule = (shellWidth, temp) => resolveRailExpanded({ shellWidth, preferred: true, explicit: false, splitDetailOpen: true, tempExpanded: temp });
  assert.equal(rule(1024, true), true);
  // At 1180 auto-compact does not apply, and the flag is irrelevant.
  assert.equal(shouldAutoCompactRail({ shellWidth: 1180, preferred: true, explicit: false, splitDetailOpen: true }), false);
  assert.equal(rule(1180, true), true);
  assert.equal(rule(1180, false), true);
});

test("phone: the rail logic never applies", () => {
  for (const width of [390, 600, 719]) {
    assert.equal(shouldAutoCompactRail({ shellWidth: width, preferred: true, explicit: false, splitDetailOpen: true }), false);
  }
});
