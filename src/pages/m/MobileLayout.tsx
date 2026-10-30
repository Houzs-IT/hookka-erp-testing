// ===========================================================================
// MobileLayout — the phone (mobile) app shell, mounted at /m.
//
// ADDITIVE: this is an entirely new route subtree. It reuses the SAME
// cookie-based auth/session as the desktop dashboard (gated by <RequireAuth>
// in router.tsx — the user is already logged in), the SAME global fetch
// interceptor (CSRF + credentials), and the SAME design tokens. It does NOT
// touch any desktop layout; the one desktop page it imports is IT Support.
//
// The shell:
//   • centers content to ~414px (phone width) on any viewport,
//   • paints the paper background + system font,
//   • renders its own nested <Routes> for the /m/* screens,
//   • on phones pins the 5-tab BottomTabBar (Home · Sales · Products ·
//     Delivery · Procurement) and owns the left NavDrawer opened by the header
//     hamburger; on tablets renders the LeftRail instead (unchanged).
//
// Phase 1: Home + More + placeholders. Phase 2 (this): every module's L1 list
// is wired to <ModuleListScreen> driven by its ModuleConfig (config-driven —
// see src/pages/m/config/modules.ts). L2 detail routes (/m/<slug>/:id) land on
// a ComingSoon detail until Phase 3 supplies the real detail screen.
// ===========================================================================
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@/components/ui/toast";
import { BottomTabBar, LeftRail, MobileHeader, NavDrawer } from "./components";
import { NavDrawerProvider } from "./lib/nav-drawer";
import { M, M_FONT, M_MAX_WIDTH } from "./theme";
import MobileHome from "./screens/Home";
import MobileMore from "./screens/More";
import { ComingSoon } from "./screens/ComingSoon";
import { ModuleListScreen } from "./screens/ModuleListScreen";
import { DocumentDetailScreen } from "./screens/DocumentDetailScreen";
import { LineItemDetailScreen } from "./screens/LineItemDetailScreen";
import { WarehouseScreen } from "./screens/WarehouseScreen";
import { ProductionScreen } from "./screens/ProductionScreen";
import { SalesScreen } from "./screens/SalesScreen";
import { ProductsScreen } from "./screens/ProductsScreen";
import { ProductDetailScreen } from "./screens/ProductDetailScreen";
import { SalesDetailScreen } from "./screens/SalesDetailScreen";
import { ProductionDetailScreen } from "./screens/ProductionDetailScreen";
import { ServiceCasesScreen } from "./screens/ServiceCasesScreen";
import { AnnouncementsScreen } from "./screens/AnnouncementsScreen";
import { UpdatesScreen } from "./screens/UpdatesScreen";
import { MailCenterScreen, MailThreadScreen } from "./screens/MailCenterScreen";
import { MODULE_CONFIGS } from "./config/modules";
import { preloadMobileCritical } from "./lib/preload";
import { useAutoUpdateOnNavigate } from "@/lib/use-version-check";
import { bootstrapMobileTheme } from "./lib/theme-mode";
import {
  PaneProvider,
  ResponsiveLayoutProvider,
  estimatePaneWidths,
  hasRailExpandedPreference,
  railToggleOutcome,
  readRailExpandedPreference,
  resolveContainerLayout,
  resolveRailExpanded,
  resolveResponsiveLayout,
  shouldAutoCompactRail,
  useObservedWidth,
  useResponsiveLayout,
  writeRailExpandedPreference,
} from "./lib/responsive-layout";
import "./theme-vars.css";

// The dashboard screen is code-split: it is the only /m screen that needs
// recharts, and most phone sessions never open it.
const DashboardScreen = lazy(() =>
  import("./screens/dashboard/DashboardScreen").then((m) => ({ default: m.DashboardScreen })),
);
// The Finance app (finance v2 mobile) is code-split too: its report screens
// pull in recharts and most phone sessions never open them.
const FinanceRoute = lazy(() => import("./screens/finance/FinanceRoute"));
// IT Support reuses the desktop page (lazy: it pulls in DataGrid). /m has no
// ToastProvider, so it brings its own; the light panel keeps the page readable in /m dark mode.
const ItSupportPage = lazy(() => import("@/pages/it-support"));
function ItSupportRoute() {
  return (
    <ToastProvider>
      <MobileHeader title="IT Support" menu />
      <div className="bg-[#FAF8F4] p-4">
        <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
          <ItSupportPage />
        </Suspense>
      </div>
    </ToastProvider>
  );
}

function FinanceRouteShell() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <FinanceRoute />
    </Suspense>
  );
}

// The Delivery screens are code-split too (2026-10-20): the phone redesign
// (lists, create sheets, DO detail) is ~85 kB that only Delivery needs, so the
// shell chunk stays the size it was.
const DeliveryScreenLazy = lazy(() =>
  import("./screens/delivery/DeliveryScreen").then((m) => ({ default: m.DeliveryScreen })),
);
const DeliveryDetailLazy = lazy(() =>
  import("./screens/delivery/DeliveryDetailScreen").then((m) => ({ default: m.DeliveryDetailScreen })),
);
function DeliveryRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <DeliveryScreenLazy />
    </Suspense>
  );
}
function DeliveryDetailRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <DeliveryDetailLazy />
    </Suspense>
  );
}

// Planning v2 (Claude Design `Planning v2.dc.html`, 2026-10-30), code-split like
// Delivery: Schedule · Capacity · Tracker plus the view-only Lead Times and
// Proposals screens.
const PlanningScreenLazy = lazy(() =>
  import("./screens/planning/PlanningScreen").then((m) => ({ default: m.PlanningScreen })),
);
function PlanningRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <PlanningScreenLazy />
    </Suspense>
  );
}

// Procurement core (Orders · Receipts · Invoices) from Claude Design
// `Procurement.dc.html` (2026-10-21), code-split like Delivery. The detail keeps
// the old id-prefix dispatch (po- / grn- / pi-), so every /m/procurement/:id
// link still lands on the right document.
const ProcurementScreenLazy = lazy(() =>
  import("./screens/procurement/ProcurementScreen").then((m) => ({ default: m.ProcurementScreen })),
);
const ProcurementDetailLazy = lazy(() =>
  import("./screens/procurement/ProcurementDetailScreen").then((m) => ({ default: m.ProcurementDetailScreen })),
);
function ProcurementRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <ProcurementScreenLazy />
    </Suspense>
  );
}
function ProcurementDetailRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <ProcurementDetailLazy />
    </Suspense>
  );
}

// Invoices v2 list + detail (Claude Design `Invoices v2.dc.html`, owner
// 2026-10-21), code-split like Delivery. The six tabs keep their sources.
const InvoicesScreenLazy = lazy(() =>
  import("./screens/invoices/InvoicesScreen").then((m) => ({ default: m.InvoicesScreen })),
);
function InvoicesRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <InvoicesScreenLazy />
    </Suspense>
  );
}
const InvoiceDetailLazy = lazy(() =>
  import("./screens/invoices/InvoiceDetailScreen").then((m) => ({ default: m.InvoiceDetailScreen })),
);
function InvoiceDetailRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <InvoiceDetailLazy />
    </Suspense>
  );
}

// Customers v3 list + detail (Claude Design `Customers v3.dc.html`), code-split.
const CustomersScreenLazy = lazy(() =>
  import("./screens/customers/CustomersScreen").then((m) => ({ default: m.CustomersScreen })),
);
const CustomerDetailLazy = lazy(() =>
  import("./screens/customers/CustomerDetailScreen").then((m) => ({ default: m.CustomerDetailScreen })),
);
function CustomersRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <CustomersScreenLazy />
    </Suspense>
  );
}
function CustomerDetailRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <CustomerDetailLazy />
    </Suspense>
  );
}

function DashboardRoute() {
  return (
    <Suspense fallback={<div style={{ padding: "64px 0", textAlign: "center", color: M.muted, fontSize: 13 }}>Loading…</div>}>
      <DashboardScreen />
    </Suspense>
  );
}

// Apply persisted dark/light mode BEFORE first paint to avoid a flash. This
// runs once at module load time (the import side-effect).
bootstrapMobileTheme();

// Modules whose L1 list is a bespoke screen (not the generic ModuleListScreen).
// Their L2 detail route still uses the config-driven DocumentDetailScreen.
const CUSTOM_L1: Record<string, ComponentType> = {
  sales: SalesScreen,
  servicecases: ServiceCasesScreen,
  announcements: AnnouncementsScreen,
  "mail-center": MailCenterScreen,
  warehouse: WarehouseScreen,
  // Production is a Kanban-style board grouped by current department (dc12
  // design v12) — the generic list flattens that signal. Detail route stays
  // generic via productionConfig.detail.
  production: ProductionScreen,
  // Claude Design `Planning v2.dc.html`: Schedule · Capacity · Tracker + view-only
  // Lead Times / Proposals, phone and tablet. No L2 (a card opens /m/production/:id).
  planning: PlanningRoute,
  // SKU Master | Catalog hub (Products Hub v2) on phone AND tablet; in the
  // tablet split pane it renders one column beside /m/products/:id.
  products: ProductsScreen,
  // Claude Design `Delivery.dc.html` on phone AND tablet (tabs, cards, Create
  // DO / Packing List, bulk moves); the screen adapts to tablet widths and to
  // the split view's list pane itself.
  delivery: DeliveryRoute,
  // Claude Design `Procurement.dc.html`: Orders · Receipts · Invoices, phone + tablet.
  procurement: ProcurementRoute,
  // Claude Design `Invoices v2.dc.html`: six tabs (each gated on its API read
  // permission), status chips, summary, v2 invoice + record cards. Phone + tablet.
  invoices: InvoicesRoute,
  // Claude Design `Customers v3.dc.html` (design-only handoff).
  customers: CustomersRoute,
};

// Modules whose L2 detail is a bespoke screen (v20 alignment) instead of the
// generic DocumentDetailScreen. Sales = the locked create-form + Total/Paid/
// Balance KPI strip + status action bar (v20 MobileSoDetail).
const CUSTOM_L2: Record<string, ComponentType> = {
  sales: SalesDetailScreen,
  production: ProductionDetailScreen,
  "mail-center": MailThreadScreen,
  // The DO detail with desktop's per-status actions, phone and tablet.
  delivery: DeliveryDetailRoute,
  // Products Hub v2 SKU detail, phone AND tablet (owner 2026-10-21).
  products: ProductDetailScreen,
  // PO / GRN / PI detail with desktop's per-status actions.
  procurement: ProcurementDetailRoute,
  // Invoices v2 detail (Claude Design `Invoices v2.dc.html`, owner 2026-10-21).
  // Also the left pane of the tablet /:id/item/:itemId line route (see below);
  // that route's right pane stays LineItemDetailScreen.
  invoices: InvoiceDetailRoute,
  customers: CustomerDetailRoute,
};

/** True on /m/<module>/<id>[/…] when that module has a detail screen, i.e. when the split view
 * (TwoPane) is what renders on a wide enough tablet. */
function isSplitDetailPath(pathname: string): boolean {
  const [, base, slug, id] = pathname.split("/");
  if (base !== "m" || !slug || !id) return false;
  const cfg = MODULE_CONFIGS.find((c) => c.slug === slug);
  return !!cfg && !!(CUSTOM_L2[slug] || cfg.detail);
}

export default function MobileLayout() {
  // Kick off background preload of high-traffic endpoints on mount — every
  // subsequent module list navigation paints from cache, not network. Runs
  // once per shell mount (the shell stays mounted for the whole /m session).
  useEffect(() => {
    preloadMobileCritical();
  }, []);

  // Phones never checked for a new deploy at all — pick it up on the next
  // screen change (BUG-2026-09-23-184).
  useAutoUpdateOnNavigate();

  const [railPreferences, setRailPreferences] = useState(() => ({
    "tablet-portrait": readRailExpandedPreference("tablet-portrait"),
    "tablet-landscape": readRailExpandedPreference("tablet-landscape"),
  }));
  // Which modes the user has set the rail for themselves; an explicit choice is never overridden.
  const [railExplicit, setRailExplicit] = useState(() => ({
    "tablet-portrait": hasRailExpandedPreference("tablet-portrait"),
    "tablet-landscape": hasRailExpandedPreference("tablet-landscape"),
  }));
  // Expanding the rail while it is auto-compacted is temporary: it is not saved
  // and is dropped when auto-compact stops applying (see below).
  const [railTempExpanded, setRailTempExpanded] = useState(false);
  const { pathname } = useLocation();
  const [shellRef, shellWidth] = useObservedWidth<HTMLDivElement>();
  const shellLayout = resolveResponsiveLayout(shellWidth);
  const railRule = shellLayout.mode === "phone"
    ? null
    : {
        shellWidth,
        preferred: railPreferences[shellLayout.mode],
        explicit: railExplicit[shellLayout.mode],
        splitDetailOpen: isSplitDetailPath(pathname),
      };
  const railAutoCompact = railRule != null && shouldAutoCompactRail(railRule);
  // Closing the detail (or resizing out of the narrow range) ends the temporary
  // expand, so the next detail auto-compacts again. Reset during render, as the
  // drawer below does, so no frame shows a stale override.
  if (!railAutoCompact && railTempExpanded) setRailTempExpanded(false);
  const railExpanded = railRule == null
    ? false
    : resolveRailExpanded({ ...railRule, tempExpanded: railTempExpanded });
  const preferredShellLayout = resolveResponsiveLayout(
    shellWidth,
    undefined,
    railExpanded,
  );
  const [contentRef, measuredContentWidth] = useObservedWidth<HTMLDivElement>(
    Math.max(0, shellWidth - preferredShellLayout.railWidth),
  );
  const expectedContentWidth = Math.max(
    0,
    shellWidth - preferredShellLayout.railWidth,
  );
  // ResizeObserver updates after the rail has painted. Use the immediately
  // derivable width during that one render so split eligibility never lags a
  // user toggle by one frame.
  const effectiveContentWidth = Math.abs(measuredContentWidth - expectedContentWidth) <= 1
    ? measuredContentWidth
    : expectedContentWidth;
  const layout = resolveResponsiveLayout(
    shellWidth,
    effectiveContentWidth,
    railExpanded,
  );
  const tablet = layout.mode !== "phone";
  const compactRail = tablet && !railExpanded;
  const toggleRail = () => {
    if (layout.mode === "phone") return;
    const outcome = railToggleOutcome({ autoCompact: railAutoCompact, shown: railExpanded });
    // While auto-compacted the toggle only flips a temporary expand: nothing is saved.
    if (outcome.temporary) {
      setRailTempExpanded((current) => !current);
      return;
    }
    // Otherwise it is the user's own choice: save it.
    const mode = layout.mode;
    writeRailExpandedPreference(mode, outcome.expanded);
    setRailPreferences((current) => ({ ...current, [mode]: outcome.expanded }));
    setRailExplicit((current) => ({ ...current, [mode]: true }));
  };
  // Phone left drawer (hamburger → NavDrawer). Closes on any route change
  // (incl. browser back) and whenever the shell leaves phone mode, so a
  // rotated/resized device never keeps a stale overlay over the tablet rail.
  const phone = layout.mode === "phone";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  // Reset during render when the route or phone mode changes (React's
  // "adjusting state when a prop changes" pattern) instead of in an effect,
  // so there is no extra render with a stale open drawer.
  const drawerKey = `${pathname}|${phone}`;
  const [prevDrawerKey, setPrevDrawerKey] = useState(drawerKey);
  if (drawerKey !== prevDrawerKey) {
    setPrevDrawerKey(drawerKey);
    setDrawerOpen(false);
  }
  const drawer = useMemo(
    () => (phone ? { isOpen: drawerOpen, open: openDrawer, close: closeDrawer } : null),
    [phone, drawerOpen, openDrawer, closeDrawer],
  );

  return (
    <ResponsiveLayoutProvider value={layout}>
      <NavDrawerProvider value={drawer}>
      {/* Safe-area left/right (landscape notch / home indicator). The padding sits
          on this outer box so the measured shell below sees only the usable width,
          which keeps the layout mode and canSplitDetail honest. Zero on iPad/SE. */}
      <div
        style={{
          minHeight: "100dvh",
          backgroundColor: M.paper,
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
      <div
        ref={shellRef}
        style={{
          minHeight: "100dvh",
          backgroundColor: M.paper,
          fontFamily: M_FONT,
          color: M.raisin,
          display: "flex",
          justifyContent: tablet ? "flex-start" : "center",
        }}
      >
        {tablet ? (
          <LeftRail compact={compactRail} onToggle={toggleRail} />
        ) : null}
        <div
          ref={contentRef}
          data-mobile-content
          style={{
            width: "100%",
            maxWidth: tablet ? "none" : M_MAX_WIDTH,
            flex: tablet ? 1 : "none",
            minWidth: 0,
            minHeight: "100dvh",
            paddingBottom: layout.hasBottomNavigation
              ? "calc(72px + env(safe-area-inset-bottom))"
              : "calc(24px + env(safe-area-inset-bottom))",
            position: "relative",
            overflowX: "hidden",
          }}
        >
          <Routes>
          <Route path="/" element={<MobileHome />} />
          <Route path="/more" element={<MobileMore />} />

          {/* Dashboard (lazy: pulls in recharts). Tab in the path, period in
              the query string — see screens/dashboard/DashboardScreen.tsx. */}
          <Route path="dashboard" element={<DashboardRoute />} />
          <Route path="dashboard/:tab" element={<DashboardRoute />} />
          <Route path="it-support" element={<ItSupportRoute />} />
          {/* Updates: Notifications | Announcements (?view=). Not a module
              config, so it sits beside the module routes, not inside them. */}
          <Route path="updates" element={<UpdatesScreen />} />
          {/* Finance (finance v2 mobile): the menu and its read-only screens,
              each gated like its desktop page. */}
          <Route path="finance" element={<FinanceRouteShell />} />
          <Route path="finance/:screen" element={<FinanceRouteShell />} />

          {/* Config-driven L1 lists + L2 document detail.
              When `detail` is supplied + we're on fold, the L2 route renders
              a two-pane shell: parent list on left, detail on right. On
              phone (or list-only routes) it's the standard single-pane.
              Each module with `detail` also gets /:id/item/:itemId for the
              L3 line-item screen. */}
          {MODULE_CONFIGS.map((cfg) => {
            const CustomL1 = CUSTOM_L1[cfg.slug];
            const L1 = CustomL1 ? <CustomL1 /> : <ModuleListScreen config={cfg} />;
            const CustomL2 = CUSTOM_L2[cfg.slug];
            // The L2 detail: a bespoke screen (CUSTOM_L2) wins; else the generic
            // config-driven detail; else a ComingSoon placeholder.
            const L2 = CustomL2 ? (
              <CustomL2 />
            ) : cfg.detail ? (
              <DocumentDetailScreen config={cfg} />
            ) : null;
            return (
            <Route key={cfg.slug}>
              <Route path={cfg.slug} element={L1} />
              <Route
                path={`${cfg.slug}/:id`}
                element={
                  L2 ? (
                    layout.canSplitDetail ? (
                      <TwoPane left={L1} right={L2} />
                    ) : (
                      L2
                    )
                  ) : (
                    <ComingSoon title={`${cfg.title} detail`} />
                  )
                }
              />
              {cfg.detail ? (
                <Route
                  path={`${cfg.slug}/:id/item/:itemId`}
                  element={
                    layout.canSplitDetail ? (
                      <TwoPane
                        // Invoices only: the left pane is the dedicated Invoices v2
                        // detail (owner 2026-10-22); every other module keeps the
                        // generic detail. The right pane is unchanged.
                        left={cfg.slug === "invoices" && CustomL2 ? <CustomL2 /> : <DocumentDetailScreen config={cfg} />}
                        right={<LineItemDetailScreen config={cfg} />}
                      />
                    ) : (
                      <LineItemDetailScreen config={cfg} />
                    )
                  }
                />
              ) : null}
            </Route>
            );
          })}

          {/* Unknown /m/* → Home. */}
          <Route path="*" element={<MobileHome />} />
          </Routes>
        </div>
        {layout.hasBottomNavigation ? <BottomTabBar /> : null}
        {phone ? <NavDrawer open={drawerOpen} onClose={closeDrawer} /> : null}
      </div>
      </div>
      </NavDrawerProvider>
    </ResponsiveLayoutProvider>
  );
}

/** Fold-only 2-pane shell — list (~320px) left, detail right, independent
 * scrollbars. dc13 v13 Fold layout. Each pane reports its own measured width
 * (PaneProvider), so a screen inside it arranges itself for the pane, not for
 * the whole shell. */
function TwoPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const estimate = estimatePaneWidths(useResponsiveLayout());
  const [leftRef, leftWidth] = useObservedWidth<HTMLDivElement>(estimate.list);
  const [rightRef, rightWidth] = useObservedWidth<HTMLDivElement>(estimate.detail);
  const leftPane = useMemo(() => resolveContainerLayout(leftWidth, "list"), [leftWidth]);
  const rightPane = useMemo(() => resolveContainerLayout(rightWidth, "detail"), [rightWidth]);
  return (
    <div
      data-mobile-split-view
      style={{ display: "flex", height: "100dvh", overflow: "hidden" }}
    >
      <div
        ref={leftRef}
        style={{
          width: "clamp(320px, 38%, 340px)",
          flex: "none",
          borderRight: `1px solid ${M.border}`,
          overflowY: "auto",
          overflowX: "hidden",
          background: M.paper,
        }}
      >
        <PaneProvider value={leftPane}>{left}</PaneProvider>
      </div>
      <div
        ref={rightRef}
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <PaneProvider value={rightPane}>{right}</PaneProvider>
      </div>
    </div>
  );
}
