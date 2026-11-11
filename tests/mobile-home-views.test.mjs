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
const phone = read("screens/HomePhone.tsx");

test("Operations is the default and show() is always true off the phone", () => {
  assert.match(home, /const isPhone = mode === "phone";/);
  assert.match(home, /useState<HomeView>\("operations"\)/);
  assert.match(home, /const show = \(v: HomeView\) => !isPhone \|\| view === v;/);
});

test("the switch renders on phones only, once, right after the Install App card", () => {
  assert.equal((home.match(/<SegmentedSwitch/g) ?? []).length, 1);
  assert.match(
    home,
    // The 6px top-padding wrapper is the handoff switch spacing (owner 2026-10-21).
    /<InstallAppCard dismissible \/>\s*\{\/\*[^*]*\*\/\}\s*\{isPhone && \(\s*(?:<div style=\{\{ paddingTop: 6 \}\}>\s*)?<SegmentedSwitch options=\{HOME_VIEWS\} value=\{view\} onChange=\{setView\}/,
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

test("KPI grid: tablets keep all four in order; phones show the view's hero instead", () => {
  assert.match(
    home,
    /\{!isPhone && \(\s*<div[\s\S]*?>\s*\{salesKpi\}\s*\{invoicesKpi\}\s*\{pendingKpi\}\s*\{outstandingKpi\}\s*<\/div>\s*\)\}/,
  );
  // The landscape 4-column rule is untouched.
  assert.match(home, /gridTemplateColumns: expanded \? "repeat\(4, minmax\(0, 1fr\)\)" : "1fr 1fr"/);
});

// Claude Design phone Home (owner 2026-10-15).
test("phone: the KPI hero sits between the switch and Quick Actions", () => {
  assert.match(
    home,
    /<SegmentedSwitch[^>]*\/>\s*(?:<\/div>\s*)?\)\}\s*\{\/\*[^*]*\*\/\}\s*\{isPhone && \(\s*<PhoneHero[\s\S]*?cells=\{view === "operations" \? opsHeroCells : perfHeroCells\}[\s\S]*?\{show\("operations"\) && \(\s*isPhone \? \(\s*<PhoneQuickActions/,
  );
});

test("phone hero keeps the tablet cards' values, notes and loading states", () => {
  assert.match(home, /value: tileValue\(pdTile, pendingDeliveryLoading\),\s*note: pdTile\.past \? pdTile\.tag : undefined,/);
  assert.match(home, /note: outTile\.past \? outTile\.tag : undefined,/);
  // "This Month" only for the current month; deltas only for the month they describe.
  assert.match(home, /label: isCurrentPeriod \? "This Month Sales" : "Sales",/);
  assert.match(home, /label: isCurrentPeriod \? "This Month Invoices" : "Invoices",/);
  assert.match(home, /pct == null \|\| deltaMonth !== period/);
});

test("phone copy matches the data", () => {
  assert.match(home, /label: "New PO", hex: M_ACCENT\.moss\.fg, onClick: \(\) => setFormSpec\(newPurchaseOrderSpec\(\)\)/);
  assert.doesNotMatch(phone, /"Receive"/);
  assert.match(home, /title="Orders due soonest"/);
  assert.match(home, /total=\{lowStock\.length\}/);
  assert.doesNotMatch(phone, /\bLIVE\b/);
  assert.match(phone, /ALL MONTHS/);
  assert.match(phone, /The Daily Report counts workers under 60% yesterday\./);
});

test("phone Orders due: horizontal snap carousel with a visible position", () => {
  assert.match(phone, /scrollSnapType: "x mandatory"/);
  assert.match(phone, /\{shown \+ 1\} of \{n\}/);
  // The position is clamped to the list, never past the last card.
  assert.match(phone, /const shown = n === 0 \? 0 : Math\.min\(index, n - 1\);/);
  // Overdue is an icon change too, not colour alone.
  assert.match(phone, /const DdIcon = o\.overdue \? CircleAlert : Calendar;/);
});

test("phone sections are presentation only and leave shared components alone", () => {
  assert.doesNotMatch(phone, /useCachedJson|fetch\(/);
  for (const c of ["MobileHeader", "BottomTabBar", "SegmentedSwitch", "InstallAppCard", "GlobalSearchSheet"]) {
    // Not imported (the header comment may name them), so never re-rendered or restyled here.
    assert.doesNotMatch(phone, new RegExp(String.raw`import[^;]*\b${c}\b[^;]*;`), c);
  }
  // Every phone section is behind isPhone in Home.tsx.
  for (const c of ["PhonePlantLoad", "PhoneRevenue", "PhoneWorkerEfficiency", "PhoneSalesByCustomer", "PhoneTopSellers", "PhoneFabricUsage", "PhoneDeptBacklog", "PhonePurchasing"]) {
    assert.match(home, new RegExp(String.raw`isPhone \? \(\s*<${c}\b`), c);
  }
});

test("Order Pipeline: 'all months' on phones; tablets keep the month wording", () => {
  assert.match(home, /const pipelineBlock = isPhone \? \(\s*<PhonePipeline[\s\S]*?note=\{pipeline\.liveNote\}/);
  assert.match(home, /Order Pipeline · \{periodLabel\(period\)\}/);
  assert.match(home, /const pipelineNote = pipeline\.note;/);
  assert.match(home, /note: liveNote \? `\$\{liveNote\} · \$\{period\}` : null,/);
});

test("Daily Report: neutral at zero, loading or failed", () => {
  assert.match(phone, /const alert = state === "ready" && total > 0;/);
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
