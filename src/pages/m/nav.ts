// Navigation model for the mobile (phone) UI.
//
// - TABS: the 5 bottom-tab destinations (Home, Sales, Products, Delivery, Procurement).
// - MORE_GROUPS: the grouped module list shown in the phone NavDrawer and on
//   the /m/more screen. Each row routes to a module screen under /m/*.
//   NO QR-scan tab anywhere.
import {
  Home,
  ShoppingCart,
  Factory,
  ShoppingBag,
  Truck,
  Megaphone,
  Mail,
  Users,
  CalendarRange,
  Warehouse,
  Package,
  Receipt,
  UserSquare,
  Wrench,
  LifeBuoy,
  UserPlus,
  Shapes,
  HardHat,
  Wallet,
  FlaskConical,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { DASHBOARD_NAV_HREF } from "./screens/dashboard/dashboard-m-lib";
import { FINANCE_NAV_GATES } from "./finance-menu";

export type TabKey = "home" | "sales" | "products" | "delivery" | "procure";

export type TabDef = {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  /** Route this tab navigates to. */
  path: string;
  /** Other route prefixes that also light this tab up. */
  alsoActiveOn?: string[];
};

// Bottom-nav: 5 equal flat tabs (owner 2026-10-12 phone nav shell; Products
// added in the middle 2026-10-13): Home · Sales · Products · Delivery · Procurement.
// Products stays in the drawer too (redundant by design).
// The raised centre "More" button is gone — every other module now lives in
// the left drawer (NavDrawer), opened from the hamburger in the header.
// /m/more stays routable and renders the same menu content.
export const TABS: TabDef[] = [
  { key: "home", label: "Home", icon: Home, path: "/m" },
  { key: "sales", label: "Sales", icon: ShoppingCart, path: "/m/sales" },
  { key: "products", label: "Products", icon: Shapes, path: "/m/products" },
  { key: "delivery", label: "Delivery", icon: Truck, path: "/m/delivery" },
  { key: "procure", label: "Procurement", icon: ShoppingBag, path: "/m/procurement", alsoActiveOn: ["/m/suppliers"] },
];

/** True when `pathname` is `base` itself or a route below it (segment match,
 * so /m/sales does not claim /m/salesxyz). */
function underPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** The bottom tab the current route belongs to, or null when the route is not
 * a tab destination (a drawer module, /m/more, …) — then no tab is lit. */
export function activeTabFor(pathname: string): TabKey | null {
  if (pathname === "/m" || pathname === "/m/") return "home";
  for (const t of TABS) {
    if (t.key === "home") continue;
    if ([t.path, ...(t.alsoActiveOn ?? [])].some((p) => underPath(pathname, p))) {
      return t.key;
    }
  }
  return null;
}


export type ModuleLink = {
  label: string;
  icon: LucideIcon;
  /** Route under /m/*. Phase 2 replaces placeholders with real screens. */
  path: string;
  /**
   * Optional red count badge (design source: e.g. an unread count on Mail /
   * Announcements). Left unset until a real count source is wired — we never
   * fabricate a number. // TODO: populate from unread mail / new announcements.
   */
  badge?: string | number;
  /**
   * Desktop href whose server-side nav gate (navHidden) also gates this row:
   * More hides the row when usePermissions().isNavAllowed(navGate) is false.
   */
  navGate?: string;
  /** Several desktop hrefs: the row shows when ANY of them is allowed (the
   *  Finance menu row — it opens a menu of screens, each gated on its own). */
  navGateAny?: string[];
};

export type ModuleGroup = {
  title: string;
  items: ModuleLink[];
};

// Group order + items per dc12 design v12 More menu:
//   Overview → Sales & Customers → Service & Support → Production →
//   Warehouse & Procurement → People & Finance → System.
// Order is owner-exacting (the design source's grouping); icons match the
// dc12 lucide names (megaphone / mail / shopping-cart / users / truck /
// receipt / wrench / factory / calendar-days / shapes / warehouse / package
// / shopping-bag / building-2 / hard-hat / wallet / user-plus).
export const MORE_GROUPS: ModuleGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard Prototype", icon: FlaskConical, path: "/m/dashboard", navGate: DASHBOARD_NAV_HREF },
      { label: "Announcements", icon: Megaphone, path: "/m/announcements" },
      { label: "Mail Center", icon: Mail, path: "/m/mail-center" },
    ],
  },
  {
    title: "Sales & Customers",
    items: [
      { label: "Sales Orders", icon: ShoppingCart, path: "/m/sales" },
      { label: "Delivery Orders", icon: Truck, path: "/m/delivery" },
      { label: "Invoices", icon: Receipt, path: "/m/invoices" },
      { label: "Customers", icon: Users, path: "/m/customers" },
    ],
  },
  {
    title: "Service & Support",
    items: [
      { label: "Service Cases", icon: Wrench, path: "/m/servicecases" },
      { label: "Service Orders", icon: Wrench, path: "/m/serviceorders" },
    ],
  },
  {
    title: "Production",
    items: [
      { label: "Production Orders", icon: Factory, path: "/m/production" },
      { label: "Planning", icon: CalendarRange, path: "/m/planning", navGate: "/planning" },
      { label: "Products", icon: Shapes, path: "/m/products" },
      { label: "Warehouse", icon: Warehouse, path: "/m/warehouse" },
      { label: "R&D Projects", icon: FlaskConical, path: "/m/rd" },
    ],
  },
  {
    title: "Warehouse & Procurement",
    items: [
      { label: "Inventory", icon: Package, path: "/m/inventory" },
      { label: "Purchase Orders", icon: ShoppingBag, path: "/m/procurement" },
      { label: "Suppliers", icon: UserSquare, path: "/m/suppliers" },
      { label: "3PL Providers", icon: Truck, path: "/m/logistics" },
    ],
  },
  {
    title: "People & Finance",
    items: [
      { label: "Employees", icon: HardHat, path: "/m/employees" },
      // Finance v2 mobile: the Finance menu, shown when any of its screens is allowed.
      { label: "Finance", icon: Landmark, path: "/m/finance", navGateAny: FINANCE_NAV_GATES },
      // Gated like the desktop Debtor Aging it reads (owner 2026-10-14).
      { label: "Receivables", icon: Wallet, path: "/m/receivables", navGate: "/accounting?tab=ar" },
    ],
  },
  // System — owner 2026-06-28 design v12: User Management is a SUPER_ADMIN
  // tool but the link belongs here for parity with the desktop /settings/users.
  // The mobile list is read-only (mutations live on the desktop page); see
  // usermgmtConfig in src/pages/m/config/modules.ts.
  {
    title: "System",
    items: [
      { label: "User Management", icon: UserPlus, path: "/m/usermgmt" },
      { label: "IT Support", icon: LifeBuoy, path: "/m/it-support" },
    ],
  },
];

/**
 * The module groups a user may see, optionally narrowed by a search query
 * (case-insensitive match on the row label or its group title). Rows with a
 * navGate follow the server's nav gate (navHidden); groups left empty drop out.
 * Shared by the More screen and the phone NavDrawer so both show the same list.
 */
export function visibleModuleGroups(
  isNavAllowed: (href: string) => boolean,
  query = "",
  groups: ModuleGroup[] = MORE_GROUPS,
): ModuleGroup[] {
  const q = query.trim().toLowerCase();
  return groups
    .map((g) => {
      // BOTH gates, or the ones that carry only `navGateAny` are never
      // filtered at all: `!i.navGate` is true for them, so the row shows to
      // everyone. Finance is exactly such a row (FINANCE_NAV_GATES), and
      // LeftRail has always checked both — this surface silently stopped
      // when the filter moved here out of screens/More.tsx.
      const allowed = g.items.filter(
        (i) =>
          (!i.navGate || isNavAllowed(i.navGate)) &&
          (!i.navGateAny || i.navGateAny.some(isNavAllowed)),
      );
      const groupHit = q !== "" && g.title.toLowerCase().includes(q);
      return {
        ...g,
        items: q === "" || groupHit
          ? allowed
          : allowed.filter((i) => i.label.toLowerCase().includes(q)),
      };
    })
    .filter((g) => g.items.length > 0);
}

