// Phone Home: one page, Operations | Performance switch (owner 2026-10-13).
// Phone only (below 720px). Tablets keep every section in one column in the
// original order, so every phone-only piece must sit behind `isPhone`, and
// no fetch may depend on the selected view (switching must not refetch).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const home = read("screens/Home.tsx");
const sw = read("components/SegmentedSwitch.tsx");

test("Operations is the default and show() is always true off the phone", () => {
  assert.match(home, /const isPhone = mode === "phone";/);
  assert.match(home, /useState<HomeView>\("operations"\)/);
  assert.match(home, /const show = \(v: HomeView\) => !isPhone \|\| view === v;/);
});

test("the switch renders on phones only, once, right after the Install App card", () => {
  assert.equal((home.match(/<SegmentedSwitch/g) ?? []).length, 1);
  assert.match(
    home,
    /<InstallAppCard dismissible \/>\s*\{\/\*[^*]*\*\/\}\s*\{isPhone && \(\s*<SegmentedSwitch options=\{HOME_VIEWS\} value=\{view\} onChange=\{setView\}/,
  );
  // The Install card itself is shared: never behind a view guard.
  assert.doesNotMatch(home, /show\("[a-z]+"\) && \(?\s*<InstallAppCard/);
});

test("no fetch depends on the view", () => {
  const calls = home.match(/useCachedJson<[^>]*>\([\s\S]*?\);/g) ?? [];
  assert.ok(calls.length >= 9, `found ${calls.length} useCachedJson calls`);
  for (const c of calls) assert.doesNotMatch(c, /\bview\b/, c);
});

test("each in-place section carries its view guard", () => {
  const guards = {
    revenue: "performance",
    plant: "operations",
    workerEff: "performance",
    salesByCustomer: "performance",
    topSellers: "performance",
    fabricUsage: "performance",
    deptBacklog: "operations",
    purchasing: "operations",
  };
  for (const [v, view] of Object.entries(guards)) {
    assert.match(home, new RegExp(`\\{show\\("${view}"\\) && ${v} \\? \\(`), v);
  }
  assert.equal((home.match(/\{show\("operations"\) && \(/g) ?? []).length, 2, "Quick Actions + Daily Report");
});

test("moved blocks: original slot on tablets, the agreed slot on phones", () => {
  for (const b of ["ordersDueBlock", "pipelineBlock", "stockAlertsBlock"]) {
    assert.match(home, new RegExp(`\\{!isPhone && ${b}\\}`), b);
  }
  assert.match(
    home,
    /\{isPhone && view === "operations" && \(\s*<>\s*\{ordersDueBlock\}\s*\{pipelineBlock\}\s*<\/>\s*\)\}/,
  );
  assert.match(home, /\{isPhone && view === "operations" && stockAlertsBlock\}\s*\{\/\* ===== Purchasing/);
});

test("KPI grid: tablets keep all four in order, phones split them by view", () => {
  assert.match(home, /\) : \(\s*<>\s*\{salesKpi\}\s*\{invoicesKpi\}\s*\{pendingKpi\}\s*\{outstandingKpi\}\s*<\/>\s*\)\}/);
  assert.match(
    home,
    /\{isPhone \? \(\s*view === "operations" \? \(\s*<>\s*\{pendingKpi\}\s*\{outstandingKpi\}\s*<\/>\s*\) : \(\s*<>\s*\{salesKpi\}\s*\{invoicesKpi\}/,
  );
  // The landscape 4-column rule is untouched.
  assert.match(home, /gridTemplateColumns: expanded \? "repeat\(4, minmax\(0, 1fr\)\)" : "1fr 1fr"/);
});

test("Order Pipeline: 'Live' wording on phones only; tablets keep the month wording", () => {
  assert.match(home, /\{isPhone \? "Order Pipeline · Live" : <>Order Pipeline · \{periodLabel\(period\)\}<\/>\}/);
  assert.match(home, /\{isPhone \? "shipped vs still to ship · all months" : "shipped vs still to ship"\}/);
  assert.match(home, /const pipelineNote = isPhone \? pipeline\.liveNote : pipeline\.note;/);
  assert.match(home, /note: liveNote \? `\$\{liveNote\} · \$\{period\}` : null,/);
});

test("SegmentedSwitch: 44px, text-only toggle buttons, theme tokens", () => {
  assert.match(sw, /height: 44,/);
  assert.match(sw, /role="group"/);
  assert.match(sw, /aria-pressed=\{on\}/);
  assert.match(sw, /backgroundColor: M\.divider/);
  assert.match(sw, /backgroundColor: on \? M\.card : "transparent"/);
  assert.doesNotMatch(sw, /lucide-react/);
  assert.doesNotMatch(sw, /#[0-9A-Fa-f]{3,6}\b/);
});
