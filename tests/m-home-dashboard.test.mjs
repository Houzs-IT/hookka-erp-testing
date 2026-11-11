// m-home-dashboard.test.mjs — the /m Home dashboard (Home v10): view access, old-link
// redirects, period rules, and the Sales maths ported from the desktop components.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_VIEWS, allowedViews, resolveView, legacyDashboardTarget, effectivePeriod, viewAllowsDay, periodMode, switchMode, stepSales,
  stateTile, revenuePoints, niceAxis, pipelineOf, perDayOf, perDayNote, buildForecast, forecastUnit, fcTone,
  customerRows, catRev, topPlusOthers, periodResolved, fitLabel, wrapLabel, attribute, productsSold, stateSlices, donutArcs, problemDest, titleCase, todayLabel,
} from "../src/pages/m/screens/dashboard/home-lib.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

// ---- views ----------------------------------------------------------------
test("six views, in the desktop order; Sales, Operations and Employees are built, the rest are Soon", () => {
  assert.deepEqual(DASHBOARD_VIEWS.map((v) => v.key), ["sales", "operations", "people", "service", "finance", "ocr"]);
  assert.deepEqual(DASHBOARD_VIEWS.filter((v) => v.built).map((v) => v.key), ["sales", "operations", "people"]);
});

test("a tab-restricted role sees only its tabs; everyone else sees all six", () => {
  assert.equal(allowedViews(null).length, 6);
  assert.equal(allowedViews(undefined).length, 6);
  assert.deepEqual(allowedViews(["sales", "operations", "people", "service"]), ["sales", "operations", "people", "service"]);
  assert.deepEqual(allowedViews([]), []);
});

test("resolveView: valid, blocked, missing and empty are four different answers", () => {
  const prod = allowedViews(["sales", "operations", "people", "service"]);
  assert.deepEqual(resolveView("people", prod), { kind: "view", view: "people" });
  assert.deepEqual(resolveView("finance", prod), { kind: "blocked", view: "finance" }, "never silently swapped");
  assert.deepEqual(resolveView(null, prod), { kind: "view", view: "sales" });
  assert.deepEqual(resolveView("nonsense", allowedViews(["service"])), { kind: "view", view: "service" }, "first allowed, not blindly Sales");
  assert.deepEqual(resolveView("sales", []), { kind: "blocked", view: "sales" });
  assert.deepEqual(resolveView(null, []), { kind: "none" });
});

// ---- old links ------------------------------------------------------------
test("legacy /m/dashboard links keep the view and every period parameter", () => {
  assert.equal(legacyDashboardTarget(undefined, ""), "/m");
  assert.equal(legacyDashboardTarget(undefined, "?mode=ytd&month=2026-07"), "/m?mode=ytd&month=2026-07");
  assert.equal(legacyDashboardTarget("sales", ""), "/m?view=sales");
  assert.equal(legacyDashboardTarget("people", "?month=2026-07&day=2026-07-12"), "/m?month=2026-07&day=2026-07-12&view=people");
  assert.equal(legacyDashboardTarget("operations", "?sub=overdue&month=2026-07"), "/m?sub=overdue&month=2026-07&view=operations");
  assert.equal(legacyDashboardTarget("finance", "?mode=range&from=2026-10-01&to=2026-12-31&lbl=Q4%202026"), "/m?mode=range&from=2026-10-01&to=2026-12-31&lbl=Q4+2026&view=finance");
  assert.equal(legacyDashboardTarget("ocr", ""), "/m?view=ocr");
  assert.equal(legacyDashboardTarget("overview", "?month=2026-07"), "/m?month=2026-07&view=sales");
  assert.equal(legacyDashboardTarget("bogus", "?month=2026-07"), "/m?month=2026-07", "unknown tab carries no view");
  assert.equal(legacyDashboardTarget("sales", "?view=ocr&month=2026-07"), "/m?month=2026-07&view=sales", "the path wins over a stray ?view=");
});

test("routes: / is the dashboard, /dashboard[/:tab] redirect, the old Home is no longer routed", () => {
  const layout = read("MobileLayout.tsx");
  assert.match(layout, /<Route path="\/" element=\{<DashboardRoute \/>\} \/>/);
  assert.match(layout, /<Route path="dashboard" element=\{<DashboardRoute legacy \/>\} \/>/);
  assert.match(layout, /<Route path="dashboard\/:tab" element=\{<DashboardRoute legacy \/>\} \/>/);
  assert.doesNotMatch(layout, /screens\/Home"/);
});

test("Dashboard Prototype is gone from the drawer / More list and the tablet rail", () => {
  assert.doesNotMatch(read("nav.ts"), /Dashboard Prototype/);
  // The rail keeps main's menu (owner 2026-10-24: /m is Home, "Dashboard" opens /m/dashboard); the staging
  // rename of the Home item to "Dashboard" is NOT part of this change.
  assert.doesNotMatch(read("components/LeftRail.tsx"), /Dashboard Prototype/);
});

// ---- period ---------------------------------------------------------------
test("Day is allowed on Operations and Employees only (desktop dayTab rule)", () => {
  assert.deepEqual(DASHBOARD_VIEWS.filter((v) => viewAllowsDay(v.key)).map((v) => v.key), ["operations", "people"]);
});

test("off the Day views a picked day or a non-quarter range reads as its month; the URL value is not lost", () => {
  const withDay = { mode: "monthly", month: "2026-07", day: "2026-07-12" };
  assert.deepEqual(effectivePeriod("sales", withDay), { mode: "monthly", month: "2026-07", day: undefined });
  assert.deepEqual(effectivePeriod("people", withDay), withDay);
  assert.deepEqual(effectivePeriod("operations", withDay), withDay);
  const last7 = { mode: "range", month: "2026-07", from: "2026-07-06", to: "2026-07-12" };
  assert.deepEqual(effectivePeriod("sales", last7), { mode: "monthly", month: "2026-07" });
  const q = { mode: "range", month: "2026-07", from: "2026-07-01", to: "2026-09-30", label: "Q3 2026" };
  assert.deepEqual(effectivePeriod("sales", q), q, "a calendar quarter stays a quarter");
});

test("Month / Quarter / Year switching and stepping", () => {
  const today = "2026-11-02";
  const m = { mode: "monthly", month: "2026-10" };
  assert.equal(periodMode(m), "month");
  const q = switchMode(m, "quarter", today);
  assert.equal(periodMode(q), "quarter");
  assert.equal(q.label, "Q4 2026");
  assert.deepEqual(switchMode(m, "year", today), { mode: "ytd", month: "2026-10" });
  assert.deepEqual(switchMode(q, "month", today), { mode: "monthly", month: q.month });
  const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
  assert.deepEqual(stepSales(m, months, -1, today), { mode: "monthly", month: "2026-09" });
  assert.equal(stepSales({ mode: "monthly", month: "2026-11" }, months, 1, today), null, "no month after the newest");
  assert.equal(stepSales(q, months, 1, today), null, "no quarter after the current one");
  assert.equal(stepSales(q, months, -1, today).label, "Q3 2026");
});

// ---- KPI state tiles ------------------------------------------------------
test("Pending Delivery / Outstanding: live while the period reaches this month, saved otherwise", () => {
  const cur = "2026-11";
  assert.deepEqual(stateTile("2026-11", 5, "2026-11-30", 99, cur), { kind: "live", sen: 99 });
  assert.deepEqual(stateTile("2026-10", 5, "2026-10-31", 99, cur), { kind: "saved", sen: 5, asOf: "2026-10-31" });
  assert.deepEqual(stateTile("2026-10", null, null, 99, cur), { kind: "none" });
});

test("stateTile does not repeat the desktop's string-compare error on year and quarter keys", () => {
  const cur = "2026-11";
  // desktop stateKpiTile("2026", ..., "2026-11") reads as past ("2026" < "2026-11"): "no record" for the CURRENT year.
  assert.equal(stateTile("2026", null, null, 7, cur).kind, "live", "the current year reaches this month");
  assert.equal(stateTile("2026-Q4", null, null, 7, cur).kind, "live");
  // desktop stateKpiTile("2026-Q1", ...) reads as live ("Q" > "1"): today's figure under a finished quarter.
  assert.deepEqual(stateTile("2026-Q1", 3, "2026-03-31", 7, cur), { kind: "saved", sen: 3, asOf: "2026-03-31" });
  assert.equal(stateTile("2025", null, null, 7, cur).kind, "none");
});

// ---- revenue / pipeline ---------------------------------------------------
const weekly = [
  { week: "2026-10-01", salesOrderSen: 100, invoiceSen: 40, productionSen: 60 },
  { week: "2026-10-04", salesOrderSen: 0, invoiceSen: 0, productionSen: 0 }, // a Sunday, idle
  { week: "2026-10-05", salesOrderSen: 300, invoiceSen: 0, productionSen: 100 },
];
test("revenue points drop an idle Sunday and keep sen", () => {
  const p = revenuePoints(weekly, null, "all");
  assert.deepEqual(p.map((x) => x.label), ["10-01", "10-05"]);
  assert.deepEqual(p.map((x) => x.so), [100, 300]);
});

test("revenue by category reads the split endpoint, not the overview", () => {
  const split = { revenue: [{ bucket: "2026-10-05", salesOrder: { bedframe: 5, sofa: 7, accessory: 1, unclassified: 0, total: 13 }, invoice: { bedframe: 1, sofa: 2, accessory: 0, unclassified: 0, total: 3 }, production: { bedframe: 0, sofa: 4, accessory: 0, unclassified: 0, total: 4 } }] };
  assert.deepEqual(revenuePoints(weekly, split, "sofa").map((x) => [x.so, x.iv, x.pr]), [[7, 2, 4]]);
  assert.deepEqual(revenuePoints(weekly, null, "sofa"), []);
});

test("niceAxis gives 4 round steps", () => {
  assert.deepEqual(niceAxis(870_000), { step: 250_000, max: 1_000_000 });
  assert.equal(niceAxis(0).max > 0, true);
});

test("order pipeline is the same-cohort funnel", () => {
  const p = pipelineOf(1000, 400);
  assert.deepEqual([p.confirmed, p.delivered, p.outstanding, p.rate], [1000, 400, 600, 40]);
  assert.equal(pipelineOf(100, 250).outstanding, 0, "never negative");
  assert.equal(pipelineOf(0, 0).rate, 0);
});

test("per working day: a month counts days, a quarter or year counts 6 days a week", () => {
  const m = perDayOf("2026-10", weekly);
  assert.equal(m.days, 2);
  assert.equal(m.orders, 200);
  const q = perDayOf("2026-Q4", weekly);
  assert.equal(q.days, 12);
  assert.equal(perDayOf("2026-10", []), null);
  assert.match(perDayNote({ orders: 200, production: 80 }), /^Orders arrive 150% faster than we produce/);
  assert.match(perDayNote({ orders: 50, production: 100 }), /^We produce 50% more than comes in/);
  assert.equal(perDayNote({ orders: 5, production: 0 }), "No production recorded in this period yet.");
});

// ---- forecast -------------------------------------------------------------
test("forecast: actual = invoiced (cancelled out), target = keyed Forecast P&L months only", () => {
  const inv = [
    { invoiceDate: "2026-09-10", status: "PAID", totalSen: 600 },
    { invoiceDate: "2026-09-11", status: "CANCELLED", totalSen: 999 },
    { invoiceDate: "2026-10-02", status: "ISSUED", totalSen: 200 },
    { invoiceDate: "2026-11-01", status: "ISSUED", totalSen: 50 },
    { invoiceDate: null, status: "ISSUED", totalSen: 7 },
  ];
  const rows = buildForecast("month", inv, { "2026-09": { salesSen: 500 }, "2026-10": { salesSen: 0 }, "2026-11": { salesSen: 400 }, "2026-12": { salesSen: 800 }, bad: { salesSen: 1 } }, "2026-11-02");
  const by = Object.fromEntries(rows.map((r) => [r.iso, r]));
  assert.equal(by["2026-09"].actualSen, 600);
  assert.equal(by["2026-09"].hit, true);
  assert.equal(by["2026-10"].targetSen, null, "no stand-in target for an unkeyed month");
  assert.equal(by["2026-10"].hit, null);
  assert.equal(by["2026-11"].inProgress, true);
  assert.equal(by["2026-11"].hit, null, "the current month is never 'missed'");
  assert.equal(by["2026-12"].projected, true);
  assert.equal(fcTone(by["2026-09"]), "hit");
  assert.equal(fcTone(by["2026-10"]), "none");
  assert.equal(fcTone(by["2026-11"]), "so-far");
  assert.equal(fcTone(by["2026-12"]), "future");
});

test("forecast: a missed past quarter, a hit quarter and the year bucket", () => {
  const inv = [{ invoiceDate: "2026-02-01", status: "PAID", totalSen: 100 }, { invoiceDate: "2026-05-01", status: "PAID", totalSen: 300 }];
  const months = { "2026-02": { salesSen: 500 }, "2026-05": { salesSen: 200 } };
  const q = buildForecast("quarter", inv, months, "2026-11-02");
  const q1 = q.find((r) => r.iso === "2026-Q1");
  assert.equal(q1.hit, false);
  assert.equal(fcTone(q1), "missed");
  assert.equal(q.find((r) => r.iso === "2026-Q2").hit, true);
  const y = buildForecast("year", inv, months, "2026-11-02");
  assert.equal(y.find((r) => r.iso === "2026").actualSen, 400);
  assert.equal(forecastUnit({ mode: "ytd", month: "2026-10" }), "year");
  assert.equal(forecastUnit({ mode: "monthly", month: "2026-10" }), "month");
  assert.equal(forecastUnit({ mode: "range", month: "2026-10", from: "2026-10-01", to: "2026-12-31" }), "quarter");
});

test("forecast months window: the last 6 finished, now, up to 6 ahead", () => {
  const months = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, { salesSen: 100 }]));
  const rows = buildForecast("month", [], months, "2026-06-15");
  assert.equal(rows[0].iso, "2026-01");
  assert.equal(rows.find((r) => r.inProgress).iso, "2026-06");
  assert.equal(rows.at(-1).iso, "2026-12");
});

// ---- customers ------------------------------------------------------------
const aov = [
  { customerName: "A", bedframeAvgSen: 100, bedframeUnits: 5, sofaAvgSen: 0, sofaSets: 0, totalSen: 500 },
  { customerName: "B", bedframeAvgSen: 10, bedframeUnits: 1, sofaAvgSen: 400, sofaSets: 3, totalSen: 1300 },
  { customerName: "C", bedframeAvgSen: 0, bedframeUnits: 0, sofaAvgSen: 50, sofaSets: 2, totalSen: 100 },
];
test("customer rows: All keeps server order; a category re-sorts and drops empty rows", () => {
  assert.deepEqual(customerRows(aov, "all").map((r) => r.a.customerName), ["A", "B", "C"]);
  assert.deepEqual(customerRows(aov, "bedframe").map((r) => [r.a.customerName, r.rev]), [["A", 500], ["B", 10]]);
  assert.deepEqual(customerRows(aov, "sofa").map((r) => [r.a.customerName, r.rev]), [["B", 1200], ["C", 100]]);
  assert.equal(catRev(aov[1], "all"), 1300);
});

test("donut: top N plus Others measured against the SERVER total, never the rows held", () => {
  const colors = ["#1", "#2", "#3", "#4", "#5", "#6", "#grey"];
  const rows = aov.map((a) => ({ name: a.customerName, sen: a.totalSen }));
  const s = topPlusOthers(rows, 10_000, colors, 6, "Others");
  assert.equal(s.length, 4);
  assert.equal(s.at(-1).name, "Others");
  assert.equal(s.at(-1).sen, 10_000 - 1900);
  assert.equal(s.at(-1).tappable, false);
  assert.ok(Math.abs(s.reduce((t, x) => t + x.share, 0) - 1) < 1e-9);
  assert.equal(s.at(-1).color, "#grey");
  const none = topPlusOthers(rows, 1900, colors, 6, "Others");
  assert.equal(none.length, 3, "no Others slice when the rows are the whole total");
});

// ---- state / category -----------------------------------------------------
const sc = [
  { date: "2026-10-01", state: "Selangor", category: "BEDFRAME", sku: "B1", name: "Bed One", qty: 2, revenueSen: 600 },
  { date: "2026-10-02", state: "Selangor", category: "SOFA", sku: "S1", name: "Sofa One", qty: 1, revenueSen: 300 },
  { date: "2026-10-02", state: "Johor", category: "BEDFRAME", sku: "B1", name: "Bed One", qty: 1, revenueSen: 100 },
  { date: "2026-10-03", state: null, category: null, sku: null, name: null, qty: 1, revenueSen: 50 },
];
test("state / category attribution and products sold match the desktop saleDrill", () => {
  const a = attribute(sc);
  assert.equal(a.total, 1050);
  assert.deepEqual(a.states.map((s) => [s.name, s.revenueSen]), [["Selangor", 900], ["Johor", 100], ["—", 50]]);
  assert.deepEqual(a.categories.map((c) => c.name), ["BEDFRAME", "SOFA", "—"]);
  const inState = productsSold(sc, "state", "Selangor");
  assert.deepEqual(inState.map((p) => [p.sku, p.qty, p.revenueSen, p.other]), [["B1", 2, 600, "BEDFRAME"], ["S1", 1, 300, "SOFA"]]);
  const inCat = productsSold(sc, "category", "BEDFRAME");
  assert.deepEqual(inCat.map((p) => [p.sku, p.qty, p.revenueSen, p.other]), [["B1", 3, 700, "Selangor"]]);
  assert.deepEqual(productsSold(sc, "state", "—").map((p) => p.sku), ["—"], "rows without a state are reachable");
});

test("state slices: top 6, the rest as Others only when two or more states would be grouped", () => {
  const colors = ["#1", "#2", "#3", "#4", "#5", "#6", "#7"];
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, revenueSen: 100 - i }));
  const total = (a) => a.reduce((t, x) => t + x.revenueSen, 0);
  assert.equal(stateSlices(mk(6), total(mk(6)), colors).length, 6);
  const seven = stateSlices(mk(7), total(mk(7)), colors);
  assert.equal(seven.length, 7, "a lone 7th state is listed, not hidden in Others");
  assert.ok(seven.every((s) => s.tappable));
  const nine = stateSlices(mk(9), total(mk(9)), colors);
  assert.equal(nine.length, 7);
  assert.equal(nine.at(-1).name, "Others");
  assert.equal(nine.at(-1).sen, total(mk(9)) - total(mk(6)));
});

test("donut geometry: only slices of 5% or more get a label, a 90% slice takes the large arc", () => {
  const slices = [{ name: "a", sen: 90, color: "#1", share: 0.9, tappable: true }, { name: "b", sen: 8, color: "#2", share: 0.08, tappable: true }, { name: "c", sen: 2, color: "#3", share: 0.02, tappable: false }];
  const arcs = donutArcs(slices);
  assert.equal(arcs.length, 3);
  assert.ok(arcs[0].label && arcs[1].label && !arcs[2].label);
  assert.match(arcs[0].d, / A82,82 0 1 1 /);
});

// ---- problems -------------------------------------------------------------
test("problem tiles lead to a real list or say they cannot", () => {
  assert.deepEqual(problemDest("overdue"), { kind: "route", to: "/m/production", navGate: "/production", where: "Production" });
  assert.deepEqual(problemDest("svc"), { kind: "route", to: "/m/servicecases", navGate: "/service-cases", where: "Service Cases" });
  assert.equal(problemDest("absent").kind, "info");
  assert.equal(problemDest("eff").kind, "info");
  const nav = read("nav.ts");
  assert.match(nav, /path: "\/m\/production"/);
  assert.match(nav, /path: "\/m\/servicecases"/);
});

// ---- misc -----------------------------------------------------------------
test("text helpers", () => {
  assert.equal(titleCase("IN_PRODUCTION"), "In Production");
  assert.equal(titleCase("(no category)"), "(no category)");
  assert.equal(todayLabel(new Date(2026, 9, 30)), "Fri, 30 Oct 2026");
});

test("no desktop dashboard view is embedded and no prototype sample value is shipped", () => {
  const files = ["HomeDashboard.tsx", "SalesView.tsx", "HomeSalesA.tsx", "HomeSalesB.tsx", "home-sheets.tsx", "home-lib.ts", "home-data.ts"];
  for (const f of files) {
    const src = read(`screens/dashboard/${f}`);
    assert.doesNotMatch(src, /from\s+["'][^"']*(SalesOrdersView|OperationsView|EmployeesDashboard|ServiceView|FinanceView|OcrView)["']/, `${f} imports a desktop view`);
    assert.doesNotMatch(src, /Desa Interior|Mewah Home|984000|Illustrative sample data|78\.42/, `${f} carries prototype sample data`);
  }
});

test("Coming Soon and Not available are different states with their own copy", () => {
  const src = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(src, /data-testid="dash-coming-soon"/);
  assert.match(src, /data-testid="dash-not-available"/);
  assert.match(src, /Not available for your role/);
  assert.doesNotMatch(src, /Under maintenance/);
});

test("Sales endpoints are the desktop's and each is skipped without the matching permission", () => {
  const src = read("screens/dashboard/home-data.ts");
  for (const url of ["/api/dashboard/prototype", "/api/dashboard/overview?period=", "/api/dashboard/overview/revenue-split?period=", "/api/sales-orders/stats", "/api/delivery-orders/pending-value", "/api/delivery-orders/stats", "/api/invoices", "/api/accounting/forecast"]) {
    assert.ok(src.includes(url), url);
  }
  assert.match(src, /access\.view && access\.invoices \? "\/api\/invoices" : null/);
  assert.match(src, /access\.view && access\.accounting \? "\/api\/accounting\/forecast" : null/);
  assert.match(src, /access\.view && access\.delivery \? "\/api\/delivery-orders\/pending-value" : null/);
});

test("the landing warm-up only fetches the dashboard feeds, and only for a user the cached permissions allow", () => {
  const src = read("lib/preload.ts");
  assert.match(src, /"\/api\/dashboard\/prototype",\s*\n\s*`\/api\/dashboard\/overview\?period=\$\{ym\}`,/);
  assert.doesNotMatch(src.slice(src.indexOf("function buildEndpoints")), /ORDERS_DUE_URL,\s*\n\s*STOCK_ALERTS_URL, \/\/ Stock/, "the old Home cards are not warmed any more");
  assert.match(src, /function mayWarmDashboard\(\)/);
  assert.match(src, /peekCache<[^>]*>\("\/api\/auth\/me\/permissions"\)/);
  assert.match(src, /if \(!isHomeLanding\(\) \|\| !mayWarmDashboard\(\)\) return;/);
  assert.match(src, /if \(!p\) return false;/, "nothing cached = nothing warmed");
});

test("Home shows Scan to Create (Sales Order, Purchase Invoice and Goods Receipt live, one Coming soon) instead of the old quick-action chips; search and bell stay", () => {
  const src = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(src, /<ScanToCreate \/>/);
  assert.doesNotMatch(src, /Quick actions|New SO|newSalesOrderSpec|newDeliveryOrderSpec|newPurchaseOrderSpec/);
  assert.match(src, /<GlobalSearchSheet/);
  assert.match(src, /navigate\("\/m\/updates"\)/);
});

test("a user without dashboard access gets the permission-filtered module list and no dashboard fetch hook", () => {
  const src = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(src, /if \(!isNavAllowed\(DASHBOARD_NAV_HREF\)\) return <FallbackHome \/>;/);
  assert.match(src, /visibleModuleGroups\(isNavAllowed\)/);
  const fallback = src.slice(src.indexOf("function FallbackHome"), src.indexOf("// Today's problems"));
  assert.doesNotMatch(fallback, /useSalesData|useProblemTiles|useCachedJson/);
});

test("locked sections: invoices, forecast target and delivery are gated on their own permission", () => {
  const a = read("screens/dashboard/HomeSalesA.tsx");
  assert.match(a, /Needs Invoices access/);
  assert.match(a, /The forecast actuals need Invoices access/);
  assert.match(a, /the target needs Accounting access/);
  assert.match(a, /Needs Delivery access/);
  const dash = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(dash, /invoices: hasPermission\("invoices", "read"\)/);
  assert.match(dash, /accounting: hasPermission\("accounting", "read"\)/);
  assert.match(dash, /dashboardTabs \? tabHas\("sales"\) : hasPermission\("sales-orders", "read"\)/);
});

test("an unresolved period (month list not loaded yet) is never labelled, fetched or sent to the server", () => {
  assert.equal(periodResolved({ mode: "monthly", month: "" }), false);
  assert.equal(periodResolved({ mode: "ytd", month: "" }), false);
  assert.equal(periodResolved({ mode: "monthly", month: "2026-11" }), true);
  assert.equal(periodResolved({ mode: "range", month: "2026-12", from: "2026-10-01", to: "2026-12-31" }), true);
  const src = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(src, /const ready = periodResolved\(period\);/);
  assert.match(src, /const periodKey = ready \? widgetPeriod\(period\) : "";/);
  assert.match(src, /const periodText = ready \? widgetPeriodLabel\(period\) : "";/);
  assert.match(src, /useSalesData\(periodKey, \{ \.\.\.access, view: access\.view && ready \}\)/);
  // The bar shows for Sales and (since the Operations view) for Operations, and only once the period is resolved.
  assert.match(src, /period=\{\(\(onSales && base\.view\) \|\| \(onOps && opsView\) \|\| \(onPeople && peopleView\)\) && ready \? period : null\}/);
});

test("KPI tiles carry no sparkline bars (the approved HTML renders none)", () => {
  const src = read("screens/dashboard/HomeSalesA.tsx");
  assert.doesNotMatch(src, /bars|barColor|barLast|sbars/);
});

test("Revenue: one valid bucket shows its point and values; all-zero or none keeps the empty state", () => {
  const src = read("screens/dashboard/HomeSalesA.tsx");
  assert.match(src, /const single = n === 1;/);
  assert.match(src, /const idx = single \? 0 :/);
  assert.match(src, /r=\{single \? 4\.5 : 3\}/);
  assert.match(src, /n === 0 \|\| !points\.some\(\(p\) => p\.so \|\| p\.iv \|\| p\.pr\)/);
  // one real bucket is what the lib hands the chart; nothing is interpolated
  const one = revenuePoints([{ week: "2026-11-03", salesOrderSen: 500, invoiceSen: 0, productionSen: 200 }], null, "all");
  assert.deepEqual(one, [{ key: "2026-11-03", label: "11-03", so: 500, iv: 0, pr: 200 }]);
  const sundayOnly = revenuePoints([{ week: "2026-11-01", salesOrderSen: 0, invoiceSen: 0, productionSen: 0 }, { week: "2026-11-03", salesOrderSen: 500, invoiceSen: 1, productionSen: 0 }], null, "all");
  assert.deepEqual(sundayOnly.map((p) => p.label), ["11-03"], "an idle Sunday is dropped, no date is invented");
});

test("Top Sellers label the bedframe by its product code and the sofa by its model, exactly as the desktop does", () => {
  const src = read("screens/dashboard/HomeSalesB.tsx");
  assert.match(src, /name: p\.productCode, q: p\.qtySold/);
  assert.match(src, /name: p\.model, q: p\.setsSold/);
  assert.doesNotMatch(src, /description/i, "no description field is read anywhere in the Top Sellers card");
});

test("Phase 3 fixes: state highlight toggles, belongs to its period, and never dims a donut with no match", () => {
  const view = read("screens/dashboard/SalesView.tsx");
  assert.match(view, /const stateSel = stateSelRaw && stateSelRaw\.p === periodKey \? stateSelRaw\.n : null;/);
  assert.match(view, /setStateSel\(stateSel === name \? null : name\)/, "a second tap on the same state clears it (desktop + HTML)");
  const card = read("screens/dashboard/HomeSalesB.tsx");
  assert.match(card, /const sel = selected && slices\.some\(\(x\) => x\.tappable && x\.name === selected\) \? selected : null;/);
  assert.match(card, /selected=\{sel\} onSlice=\{\(n\) => onSelect\(sel === n \? null : n\)\}/);
});

test("Phase 3 fixes: a failed overview no longer hides the live Pending / Outstanding tiles, and the tag never says LIVE for an unavailable value", () => {
  const a = read("screens/dashboard/HomeSalesA.tsx");
  assert.doesNotMatch(a, /if \(data\.overview\.failure && !ov\) \{/);
  assert.match(a, /const liveNow = stateTile\(periodKey, null, null, 0, curYm\)\.kind === "live";/);
  assert.match(a, /tag: failed \? "UNAVAILABLE" : liveNow \? "LIVE" : "MONTH-END"/);
  assert.match(a, /Could not load the Sales and Invoices totals\./);
});

test("Phase 3 fixes: no series shown has no axis ticks, and a lone point's readout is centred, not left over the axis", () => {
  const a = read("screens/dashboard/HomeSalesA.tsx");
  assert.match(a, /vis\.length === 0 \? null : \[0, 1, 2, 3, 4\]\.map/);
  assert.match(a, /All series are hidden\. Tap a legend to show one\./);
  assert.match(a, /left: "50%", transform: "translateX\(-50%\)"/);
  assert.match(a, /pick && vis\.length > 0/);
});

test("Phase 4 fixes: label fitting keeps the start of the name and never cuts what it shows", () => {
  const w = (t) => t.length * 6; // 6px per character stands in for the canvas measure
  assert.equal(fitLabel("Lim Bros", 100, w), "Lim Bros", "fits: untouched");
  assert.equal(fitLabel("Mewah Home Living", 60, w), "Mewah Hom…");
  assert.equal(fitLabel("Mewah Home Living", 60, w).startsWith("Mewah Hom"), true);
  assert.equal(fitLabel("Desa Interior Sdn Bhd", 1, w), "Des…", "never below 3 characters");
  assert.notEqual(fitLabel("Kian Furniture Gallery", 80, w), fitLabel("Kian Furniture Group", 80, w) + "x");
  const d = read("screens/dashboard/HomeDonut.tsx");
  assert.match(d, /wrapLabel\(slice\.name, pct, room, measure, !crowded\)/);
  assert.match(d, /<title>\{`\$\{slice\.name\} \$\{pct\}`\}<\/title>/, "the full name stays available on the label");
  assert.match(d, /label\.right \? DONUT\.w - 2 - \(label\.tx \+ 4\) : label\.tx - 4 - 2/);
});

test("Phase 4 fixes: line-height is scoped to the dashboard content, sheet header is pinned, chip colour and views sheet match Home v10", () => {
  const dash = read("screens/dashboard/HomeDashboard.tsx");
  assert.match(dash, /<div style=\{\{ lineHeight: "normal" \}\}>/);
  assert.doesNotMatch(dash.slice(dash.indexOf("function HomeTop"), dash.indexOf("function FallbackHome")), /lineHeight: "normal"/, "the shared header / create form / search stay as they were");
  assert.doesNotMatch(dash, /v\.blurb/, "no description line in the views sheet");
  const ui = read("screens/dashboard/home-ui.tsx");
  assert.match(ui, /position: "sticky", top: 0, zIndex: 2, backgroundColor: M\.paper/);
  assert.match(ui, /color: on \? M\.paper : CHIP_TEXT/);
  const style = read("screens/dashboard/home-style.ts");
  assert.match(style, /export const pctCell: CSSProperties = \{ flex: "none", width: 48,/);
  assert.match(style, /CHIP_TEXT = `color-mix\(in srgb, \$\{M\.raisin\} 40%, \$\{M\.ink\}\)`/);
});

test("Phase 4 fixes: forecast months are short like Home v10, and the top-seller customer sheet uses the HTML wording", () => {
  const a = read("screens/dashboard/HomeSalesA.tsx");
  assert.match(a, /unit === "month" \? f\.label\.slice\(0, 3\) : f\.label/);
  const sheets = read("screens/dashboard/home-sheets.tsx");
  assert.match(sheets, /title: `\$\{s\.code\} · \$\{a\.periodText\}`,/);
  assert.match(sheets, /sub: "Customers who bought it",/);
  assert.doesNotMatch(sheets, /by customer/);
});

test("Phase 4 fixes: a label wraps to two lines when the name does not fit beside its percentage, and never loses the percentage", () => {
  const w = (t) => t.length * 6;
  assert.deepEqual(wrapLabel("Lim Bros", "7%", 100, w, true).lines, ["Lim Bros"]);
  const two = wrapLabel("Mewah Home Living", "15%", 70, w, true).lines;
  assert.equal(two.length, 2);
  assert.equal(two[0], "Mewah Home", "whole leading words on line 1");
  assert.ok(two[1].startsWith("Living") || two[1].startsWith("Liv"), "the rest continues on line 2");
  const one = wrapLabel("Mewah Home Living", "15%", 70, w, false).lines;
  assert.equal(one.length, 1, "no room for two lines: one shortened line");
  assert.ok(one[0].endsWith("…"));
  assert.equal(wrapLabel("Desa", "19%", 20, w, true).lines.length, 1, "a single word cannot wrap");
  const src = read("screens/dashboard/HomeDonut.tsx");
  assert.match(src, /\{` \$\{pct\}`\}/, "the percentage is always appended to the last line");
});
