// Phone navigation shell (owner 2026-10-12; Products tab 2026-10-13): 5 flat bottom tabs, a flat
// hamburger, and a 324px left drawer that reuses the More menu content.
// Tablet (rail) behaviour must stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TABS,
  MORE_GROUPS,
  activeTabFor,
  visibleModuleGroups,
} from "../src/pages/m/nav.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const tabBar = read("components/BottomTabBar.tsx");
const drawer = read("components/NavDrawer.tsx");
const menuButton = read("components/MenuButton.tsx");
const header = read("components/MobileHeader.tsx");
const layout = read("MobileLayout.tsx");
const more = read("screens/More.tsx");
const home = read("screens/Home.tsx");

test("bottom nav is exactly 5 flat tabs: Home | Sales | Products | Delivery | Procurement", () => {
  assert.deepEqual(TABS.map((t) => t.label), ["Home", "Sales", "Products", "Delivery", "Procurement"]);
  assert.deepEqual(TABS.map((t) => t.path), ["/m", "/m/sales", "/m/products", "/m/delivery", "/m/procurement"]);
  const products = TABS.find((t) => t.key === "products");
  const drawerProducts = MORE_GROUPS.flatMap((g) => g.items).find((i) => i.path === "/m/products");
  assert.ok(drawerProducts, "drawer still lists Products");
  assert.equal(products.icon, drawerProducts.icon, "Products tab uses the drawer's icon");
  assert.ok(!TABS.some((t) => "raised" in t), "no raised slot");
  assert.doesNotMatch(tabBar, /translateY\(-16px\)|t\.raised/, "raised More button removed");
});

test("active tab follows the route by path segment; non-tab routes light nothing", () => {
  assert.equal(activeTabFor("/m"), "home");
  assert.equal(activeTabFor("/m/"), "home");
  assert.equal(activeTabFor("/m/sales"), "sales");
  assert.equal(activeTabFor("/m/sales/so-1"), "sales");
  assert.equal(activeTabFor("/m/products"), "products");
  assert.equal(activeTabFor("/m/products/prod-1"), "products");
  assert.equal(activeTabFor("/m/productsxyz"), null, "Products matches by path segment");
  assert.equal(activeTabFor("/m/delivery/do-9/item/2"), "delivery");
  assert.equal(activeTabFor("/m/procurement"), "procure");
  assert.equal(activeTabFor("/m/suppliers/s-1"), "procure");
  assert.equal(activeTabFor("/m/salesxyz"), null);
  assert.equal(activeTabFor("/m/more"), null, "More no longer owns every other route");
  assert.equal(activeTabFor("/m/production"), null);
  assert.match(tabBar, /aria-current=\{isActive \? "page" : undefined\}/);
});

test("drawer module list keeps the 7 groups in order and respects navGate", () => {
  assert.deepEqual(MORE_GROUPS.map((g) => g.title), [
    "Overview",
    "Sales & Customers",
    "Service & Support",
    "Production",
    "Warehouse & Procurement",
    "People & Finance",
    "System",
  ]);
  const gated = MORE_GROUPS.flatMap((g) => g.items).filter((i) => i.navGate);
  assert.ok(gated.length > 0);
  const allowAll = visibleModuleGroups(() => true);
  const denyGated = visibleModuleGroups(() => false);
  const labels = (gs) => gs.flatMap((g) => g.items.map((i) => i.label));
  for (const i of gated) {
    assert.ok(labels(allowAll).includes(i.label));
    assert.ok(!labels(denyGated).includes(i.label), `${i.label} hidden when navHidden`);
  }
});

test("module search filters by label or group title and drops empty groups", () => {
  const hit = visibleModuleGroups(() => true, "  invoic ");
  assert.deepEqual(hit.map((g) => g.title), ["Sales & Customers"]);
  assert.deepEqual(hit[0].items.map((i) => i.label), ["Invoices"]);
  const group = visibleModuleGroups(() => true, "people");
  assert.deepEqual(group[0].items.map((i) => i.label), ["Employees", "Receivables"]);
  assert.deepEqual(visibleModuleGroups(() => true, "zzz-nothing"), []);
  // Search never reveals a gated row.
  const gated = MORE_GROUPS.flatMap((g) => g.items).find((i) => i.navGate);
  assert.deepEqual(visibleModuleGroups(() => false, gated.label).flatMap((g) => g.items).filter((i) => i.label === gated.label), []);
});

test("drawer: 324px, slides from left, pinned profile + search, accessible", () => {
  assert.match(drawer, /NAV_DRAWER_WIDTH = 324/);
  assert.match(drawer, /translateX\(-100%\)/);
  assert.match(drawer, /<ProfileCard/);
  assert.match(drawer, /placeholder="Search modules\.\.\."/);
  assert.match(drawer, /<ThemeToggleCard/);
  assert.match(drawer, /<InstallAppCard/);
  assert.match(drawer, /<DesktopAppLink/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /e\.key === "Escape"/);
  assert.match(drawer, /e\.key !== "Tab"/, "focus trap");
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/, "body scroll lock");
  assert.match(drawer, /aria-label="Close menu"/);
  assert.match(drawer, /inert=\{!open\}/);
  assert.match(drawer, /safe-area-inset-top/);
  assert.match(drawer, /safe-area-inset-bottom/);
  assert.match(drawer, /visibleModuleGroups\(isNavAllowed, query\)/);
});

test("hamburger is flat, labelled and phone-only", () => {
  assert.match(menuButton, /aria-label="Open menu"/);
  assert.match(menuButton, /background: "none"/);
  assert.match(menuButton, /border: "none"/);
  assert.match(menuButton, /mode !== "phone" \|\| !drawer\) return null/);
  assert.match(header, /menu && mode === "phone" && drawer !== null/);
  assert.match(home, /mode === "phone" \? \(\s*<MenuButton/);
});

test("shell mounts the drawer for phones only and leaves the tablet rail alone", () => {
  assert.match(layout, /\{phone \? <NavDrawer open=\{drawerOpen\} onClose=\{closeDrawer\} \/> : null\}/);
  assert.match(layout, /<LeftRail compact=\{compactRail\} onToggle=\{toggleRail\} \/>/);
  assert.match(layout, /<Route path="\/more" element=\{<MobileMore \/>\} \/>/, "/m/more kept");
  assert.match(more, /visibleModuleGroups\(isNavAllowed\)/, "More shares the same list");
});
