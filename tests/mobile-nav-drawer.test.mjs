// Phone navigation shell (owner 2026-10-12; Products tab 2026-10-13): 5 flat bottom tabs, a flat
// hamburger, and a left drawer (318px since the 2026-10-16 reskin) with the More menu content.
// Tablet (rail) behaviour must stay untouched.
// 2026-10-13: one phone header geometry for every /m screen (see the last test).
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
  // BOTH gate shapes. This filter used to read `i.navGate` alone, so the one
  // row gated purely by navGateAny (Finance) was never checked here — and it
  // was ungated in visibleModuleGroups for exactly as long.
  const gated = MORE_GROUPS.flatMap((g) => g.items).filter((i) => i.navGate || i.navGateAny);
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
  assert.deepEqual(group[0].items.map((i) => i.label), ["Employees", "Finance", "Receivables"]);
  assert.deepEqual(visibleModuleGroups(() => true, "zzz-nothing"), []);
  // Search never reveals a gated row.
  const gated = MORE_GROUPS.flatMap((g) => g.items).find((i) => i.navGate);
  assert.deepEqual(visibleModuleGroups(() => false, gated.label).flatMap((g) => g.items).filter((i) => i.label === gated.label), []);
});

// 2026-10-16: reskinned to the Claude Design Home.dc.html drawer (318px, rounded
// right edge, pinned Sign out footer). Install card dropped (Home shows it); the
// desktop-app link stays (only phone route back to desktop, BUG-2026-10-02-250).
test("drawer: 318px, slides from left, pinned profile + search + footer, accessible", () => {
  assert.match(drawer, /NAV_DRAWER_WIDTH = 318/);
  assert.match(drawer, /translateX\(-100%\)/);
  assert.match(drawer, /borderTopRightRadius: 28/);
  assert.match(drawer, /<DrawerProfile \/>/);
  assert.match(drawer, /placeholder="Search modules"/);
  assert.match(drawer, /<DrawerThemeToggle \/>/);
  assert.match(drawer, /<DrawerModuleList groups=\{groups\}/);
  assert.doesNotMatch(drawer, /InstallAppCard/, "install card lives on Home, not in the drawer");
  assert.match(drawer, /onClick=\{handleSignOut\}/, "footer sign-out reuses the shared flow");
  assert.match(drawer, /href="\/dashboard"\s*onClick=\{\(\) => setPreferDesktop\(true\)\}/);
  assert.match(drawer, /aria-current=\{current \? "page" : undefined\}/);
  // /m/more keeps its own (unchanged) building blocks.
  for (const c of ["<ProfileCard", "<ThemeToggleCard", "<InstallAppCard", "<DesktopAppLink"]) {
    assert.ok(more.includes(c), `/m/more still renders ${c}`);
  }
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
  // Phones: Home uses the shared header, so its hamburger sits in the same slot as every module.
  assert.match(home, /mode === "phone" \? \(\s*<>[\s\S]*?<MobileHeader title="Home" menu trailing=\{headerActions\} \/>/);
});

test("shell mounts the drawer for phones only and leaves the tablet rail alone", () => {
  assert.match(layout, /\{phone \? <NavDrawer open=\{drawerOpen\} onClose=\{closeDrawer\} \/> : null\}/);
  assert.match(layout, /<LeftRail compact=\{compactRail\} onToggle=\{toggleRail\} \/>/);
  assert.match(layout, /<Route path="\/more" element=\{<MobileMore \/>\} \/>/, "/m/more kept");
  assert.match(more, /visibleModuleGroups\(isNavAllowed\)/, "More shares the same list");
});

test("phone header geometry is shared: one 44px leading slot, fixed 52px row, offsets include the inset", () => {
  const geometry = read("lib/header-geometry.ts");
  const subTabs = read("components/SubTabs.tsx");
  const dashboard = read("screens/dashboard/DashboardScreen.tsx");
  // Back arrow and hamburger use the same 44x44 slot with the same -10 pull.
  assert.match(header, /width: 44,\s*height: 44,\s*marginLeft: -10,/);
  assert.match(menuButton, /export function MenuButton\(\{ edge = -10 \}/);
  assert.match(menuButton, /width: 44,\s*height: 44,/);
  // 20px glyphs on phones (24 read too large next to the title); tablets keep a 24px back arrow.
  assert.match(menuButton, /<Menu size=\{20\}/);
  assert.match(header, /<ChevronLeft size=\{phone \? 20 : 24\}/);
  assert.match(header, /phone \? \{ height: MOBILE_HEADER_ROW \}/, "fixed row on phones, no growth");
  assert.match(header, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(header, /textOverflow: "ellipsis"/);
  assert.match(geometry, /MOBILE_HEADER_ROW = 52/);
  assert.match(geometry, /calc\(\$\{MOBILE_HEADER_ROW\}px \+ env\(safe-area-inset-top, 0px\)\)/);
  // Sticky rows pin under the header through the shared hook, not a literal 52.
  assert.match(subTabs, /useStickyBelowHeader\(\)/);
  assert.doesNotMatch(subTabs, /top: 52/);
  assert.match(dashboard, /top: stickyTop/);
  // Home on phones: no second safe-area pad on top of the header's.
  assert.match(home, /paddingTop: mode === "phone" \? 0 : "env\(safe-area-inset-top\)"/);
  // Custom detail screens use the shared header (back arrow) on phones.
  for (const f of ["SalesDetailScreen", "MailCenterScreen"]) {
    const src = read(`screens/${f}.tsx`);
    assert.match(src, /phone \? \(?\s*<MobileHeader[\s\S]*?onBack=\{\(\) => navigate\(-1\)\}/, f);
  }
  // Production Orders v3 renders the shared header (PO number + back) at every width.
  assert.match(read("screens/ProductionDetailScreen.tsx"), /<MobileHeader title=\{poNo\} onBack=\{\(\) => navigate\(-1\)\} \/>/);
});
