// m-home-operations.test.mjs — the /m Home Operations view: shell + URL period state, the section
// maths (copied from the desktop Operations cards), the loading / error / denied states, and the
// guarantee that no prototype sample value or arbitrary timer ships. These are unit tests over the
// pure logic and over the source; they are NOT authenticated API runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_VIEWS, allowedViews, resolveView, effectivePeriod, periodMode, opsPeriod, switchOpsMode, stepOps, opsPeriodLabel, costingFocusMonth, periodResolved,
} from "../src/pages/m/screens/dashboard/home-lib.ts";
import { readPeriod, writePeriod } from "../src/pages/m/screens/dashboard/dashboard-m-lib.ts";
import { TAB_SUBS, parseDashboardUrl } from "../src/pages/dashboards/dashboard-url-state-lib.ts";
import { quarterPeriod, widgetPeriod } from "../src/pages/dashboards/dashboard-shared-lib.ts";
import {
  slotStatus, sectionStatus, drSummary, drRows, DR_CHECKS, stateTag, plantGauge, capacityWindowLabel, backlogRows, deptRevenueRows, deptBuckets, splitDayIndex,
  overdueSplit, deptChips, filterOrders, duePill, shortageSummary, pnlMaterials, costingByDay, costingCols, costOf, rollUpMonths, costingMonths, labourPerDay,
  planBars, planCumulative, planTotals, stageRows, fabricRows, fabricTrend, purchasingCalc, purchasingMonths, stockTake, perWorkerMin, completedHead,
  hm as hmFmt, hrs as hrsFmt,
} from "../src/pages/m/screens/dashboard/ops-lib.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/screens/dashboard/${p}`, import.meta.url), "utf8");
const OPS_FILES = ["OpsView.tsx", "HomeOpsA.tsx", "HomeOpsP.tsx", "HomeOpsB.tsx", "HomeOpsC.tsx", "ops-lib.ts", "ops-data.ts", "ops-ui.tsx"];
const PROD_TABS = ["sales", "operations", "people", "service"];

// ---- Sales <-> Operations --------------------------------------------------
test("Operations is built (with Sales and Employees); the other three views still say Soon", () => {
  assert.deepEqual(DASHBOARD_VIEWS.filter((v) => v.built).map((v) => v.key), ["sales", "operations", "people"]);
});

test("Sales <-> Operations: each view keeps its own period rule and Sales never reads a day", () => {
  const day = { mode: "monthly", month: "2026-10", day: "2026-10-23" };
  assert.deepEqual(effectivePeriod("sales", day), { mode: "monthly", month: "2026-10", day: undefined }, "Sales falls back to the month");
  assert.equal(effectivePeriod("operations", day).day, "2026-10-23", "Operations keeps the picked day");
  assert.deepEqual(effectivePeriod("sales", { mode: "ytd", month: "2026-10" }), { mode: "ytd", month: "2026-10" });
  assert.equal(resolveView("operations", allowedViews(PROD_TABS)).kind, "view");
  assert.deepEqual(resolveView("operations", allowedViews(["sales"])), { kind: "blocked", view: "operations" });
});

test("HomeDashboard mounts Operations beside Sales and the Sales path is unchanged", () => {
  const src = read("HomeDashboard.tsx");
  assert.match(src, /<OpsView\b/);
  assert.match(src, /<SalesView\b/);
  assert.match(src, /useSalesData\(periodKey, \{ \.\.\.access, view: access\.view && ready \}\)/, "Sales fetch gate untouched");
  assert.match(src, /const access: SalesAccess = \{ \.\.\.base, view: base\.view && onSales \}/);
  assert.match(src, /\(onSales && base\.view\) \|\| \(onOps && opsView\)/, "the month list is fetched for either view");
});

// ---- Overview <-> Output & Cost -------------------------------------------
test("Operations sub-tabs are the desktop's two, in the URL's ?sub=", () => {
  // The desktop now also has "Floor Live" (owner 2026-11-10); the phone Home carries the first two and a
  // ?sub=floor link falls back to Overview (Home.tsx / HomeDashboard.tsx opsSub).
  assert.deepEqual(TAB_SUBS.operations.slice(0, 2).map((s) => s.key), ["overview", "production"]);
  assert.deepEqual(TAB_SUBS.operations.slice(0, 2).map((s) => s.label), ["Overview", "Output & Cost"]);
  const src = read("HomeDashboard.tsx");
  assert.match(src, /useDashboardSub\("operations"\)/);
  const p = parseDashboardUrl(new URLSearchParams("sub=production"), ["operations"], "operations");
  assert.equal(p.sub, "operations" === p.tab ? "production" : p.sub);
  assert.equal(writePeriod(new URLSearchParams("sub=production"), { mode: "monthly", month: "2026-10" }).get("sub"), "production", "a period change keeps the sub-tab");
});

// ---- Day / Month / Quarter / Year in the URL ------------------------------
test("Day, Month, Quarter and Year round-trip through the URL period scheme", () => {
  const today = "2026-11-05";
  const base = { mode: "monthly", month: "2026-10" };
  const day = switchOpsMode(base, "day", today);
  assert.deepEqual(day, { mode: "monthly", month: "2026-10", day: "2026-10-31" }, "a past month opens on its last day");
  assert.equal(periodMode(day), "day");
  assert.equal(switchOpsMode({ mode: "monthly", month: "2026-11" }, "day", today).day, today, "the current month opens on today");
  const ser = (p) => readPeriod(writePeriod(new URLSearchParams(), p));
  assert.deepEqual(ser(day), day);
  const q = switchOpsMode(day, "quarter", today);
  assert.equal(periodMode(q), "quarter");
  assert.equal(q.day, undefined, "leaving Day clears the day");
  assert.deepEqual(ser(q).from, q.from);
  const y = switchOpsMode(day, "year", today);
  assert.equal(periodMode(y), "year");
  assert.deepEqual(switchOpsMode(day, "month", today), { mode: "monthly", month: "2026-10" });
  assert.equal(widgetPeriod(q), "2026-Q4");
  assert.equal(widgetPeriod(y), "2026");
  assert.equal(widgetPeriod(day), "2026-10", "a picked day never changes the endpoint key");
});

test("Day mode steps one calendar day and never past today; other modes step as Sales does", () => {
  const today = "2026-11-05";
  assert.deepEqual(stepOps({ mode: "monthly", month: "2026-11", day: "2026-11-01" }, [], -1, today), { mode: "monthly", month: "2026-10", day: "2026-10-31" });
  assert.equal(stepOps({ mode: "monthly", month: "2026-11", day: today }, [], 1, today), null);
  assert.deepEqual(stepOps({ mode: "monthly", month: "2026-10" }, ["2026-09", "2026-10"], -1, today), { mode: "monthly", month: "2026-09" });
  assert.equal(opsPeriodLabel({ mode: "monthly", month: "2026-10", day: "2026-10-23" }), "23 Oct 2026");
});

test("a range that is not a calendar quarter reads as its month; a year or quarter carries no day", () => {
  assert.deepEqual(opsPeriod({ mode: "range", month: "2026-10", from: "2026-10-03", to: "2026-10-20" }), { mode: "monthly", month: "2026-10" });
  assert.equal(opsPeriod({ mode: "ytd", month: "2026-10", day: "2026-10-02" }).day, undefined);
  assert.equal(periodResolved(opsPeriod({ mode: "monthly", month: "" })), false);
});

test("Costing focus month (D2): the quarter in progress uses the current month, a finished quarter its last", () => {
  const today = "2026-11-05";
  assert.equal(costingFocusMonth(quarterPeriod("2026-Q4", today), today), "2026-11", "never the future December");
  assert.equal(costingFocusMonth(quarterPeriod("2026-Q3", today), today), "2026-09");
  assert.equal(costingFocusMonth({ mode: "monthly", month: "2026-10" }, today), "2026-10");
  assert.equal(costingFocusMonth({ mode: "ytd", month: "2026-11" }, today), "2026-11");
  // a quarter link whose month param is missing still clamps from its own end date
  assert.equal(costingFocusMonth({ ...quarterPeriod("2026-Q4", today), month: "" }, today), "2026-11");
});

// ---- Plant Load / Backlog -------------------------------------------------
test("Plant Load labels live, saved and reconstructed figures as the desktop does", () => {
  assert.equal(stateTag({ source: "live", isHistorical: false, asOf: null }), null, "the current month carries no tag");
  assert.deepEqual(stateTag({ source: "snapshot", isHistorical: true, asOf: "2026-09-30" }), { kind: "asof", text: "as of 2026-09-30" });
  assert.equal(stateTag({ source: "reconstructed", isHistorical: true, asOf: "2026-08-31" }).kind, "reconstructed");
  assert.deepEqual(stateTag({ source: "live", isHistorical: true, asOf: null }), { kind: "live-no-history", text: "live (no history before today)" });
  assert.equal(stateTag(undefined), null);
});

test("the gauge uses the desktop's cut-offs: gold over 7 days, red over 12, bar full at 14", () => {
  assert.equal(plantGauge(7).color, "#15803D");
  assert.equal(plantGauge(7.1).color, "#C9A24B");
  assert.equal(plantGauge(12.1).color, "#DC2626");
  assert.deepEqual([plantGauge(7).pct, plantGauge(30).pct, plantGauge(30).util], [50, 100, 1]);
  assert.equal(capacityWindowLabel("2026-11", "2026-11"), "7-day avg");
  assert.equal(capacityWindowLabel("2026-Q3", "2026-11"), "2026-Q3 avg");
});

test("backlog rows keep the server order and a stalled department stays stalled when a category is hidden", () => {
  const rows = [
    { dept: "Webbing", sofaMin: 600, bedframeMin: 0, totalMin: 600, dailyCapMin: 0, backlogDays: null },
    { dept: "Upholstery", sofaMin: 1200, bedframeMin: 600, totalMin: 1800, dailyCapMin: 600, backlogDays: 3 },
  ];
  const all = backlogRows(rows, true, true);
  assert.deepEqual(all.map((r) => r.dept), ["Webbing", "Upholstery"]);
  assert.deepEqual([all[0].shown, all[1].shown], [null, 3]);
  assert.equal(backlogRows(rows, true, false)[1].shown, 2, "sofa only: 1200 / 600 per day");
  assert.equal(backlogRows(rows, false, true)[0].shown, null);
  assert.equal(perWorkerMin([{ minutes: 100, workers: 0 }], 100), null, "no credited worker: no per-worker figure");
  assert.deepEqual(completedHead({ completedRange: { bedframeUnits: 4, sofaSets: 2 }, completedLast7: [{ date: "d", bedframeUnits: 9, sofaSets: 9 }] }), { bedframe: 4, sofa: 2 }, "the server's deduped range total wins");
});

// ---- Department Revenue ---------------------------------------------------
const cat = (b, s, a = 0) => ({ bedframe: b, sofa: s, accessory: a, unclassified: 0, total: b + s + a });
const monthSplit = {
  granularity: "day",
  revenue: [{ bucket: "2026-10-01", production: cat(1, 1) }, { bucket: "2026-10-02", production: cat(2, 2) }],
  departments: [
    { code: "FAB_CUT", label: "Fabric Cutting", period: cat(300, 100), byBucket: [cat(100, 40), cat(200, 60)] },
    { code: "UPHOLSTERY", label: "Upholstery", period: cat(500, 500, 50), byBucket: [cat(200, 100, 10), cat(300, 400, 40)] },
  ],
};
test("Department Revenue keeps the API's department order and offers All / Bedframe / Sofa only", () => {
  const all = deptRevenueRows(monthSplit, "all", undefined);
  assert.deepEqual(all.map((r) => r.code), ["FAB_CUT", "UPHOLSTERY"], "not re-sorted");
  assert.equal(all[1].value, 1050);
  assert.equal(deptRevenueRows(monthSplit, "bedframe", undefined)[1].value, 500);
  assert.equal(deptRevenueRows(monthSplit, "sofa", undefined)[0].value, 100);
  assert.equal(all[1].frac, 1);
  const src = read("HomeOpsA.tsx");
  assert.match(src, /\["all", "All"\], \["bedframe", "Bedframe"\], \["sofa", "Sofa"\]/);
  assert.doesNotMatch(src, /"accessory", "Accessory"/);
  assert.doesNotMatch(src, /Avg RM|\/day`/, "no invented average per day");
});

test("a picked day reads that day's bucket only in a daily (month) split", () => {
  assert.equal(splitDayIndex(monthSplit, "2026-10-02"), 1);
  assert.equal(deptRevenueRows(monthSplit, "all", "2026-10-02")[1].value, 740);
  assert.equal(splitDayIndex({ ...monthSplit, granularity: "week" }, "2026-10-02"), -1);
  assert.equal(splitDayIndex(monthSplit, "2026-11-30"), -1, "a day with no bucket falls back to the period");
});

test("a quarter is shown by the API's weekly buckets, a year by month, never re-bucketed", () => {
  const weeks = { granularity: "week", revenue: [{ bucket: "2026-10-05", production: cat(1, 1) }, { bucket: "2026-10-12", production: cat(1, 1) }], departments: [{ code: "FAB_CUT", label: "Fabric Cutting", period: cat(3, 3), byBucket: [cat(1, 1), cat(2, 2)] }] };
  const b = deptBuckets(weeks, "FAB_CUT", "all");
  assert.equal(b.length, 2, "exactly the buckets the API returned");
  assert.deepEqual(b.map((x) => x.pickable), [false, false], "a single day cannot be picked in a weekly split");
  assert.equal(b[0].label, "5 Oct");
  const months = { granularity: "month", revenue: [{ bucket: "2026-01", production: cat(1, 1) }], departments: [{ code: "FAB_CUT", label: "x", period: cat(1, 1), byBucket: [cat(1, 1)] }] };
  assert.equal(deptBuckets(months, "FAB_CUT", "all")[0].label, "Jan");
  assert.equal(deptBuckets(monthSplit, "FAB_CUT", "all")[0].pickable, true);
});

// ---- Daily Report ---------------------------------------------------------
test("Daily Report: the total includes every check, tiles are the top four non-zero chips, pendingTimeAdjustments is never a chip", () => {
  const counts = { total: 31, checksRun: 15, checksTotal: 15, overdueOrders: 7, soNoInvoice: 9, pricingIssues: 4, doPendingDispatch: 3, doNotDelivered: 3, cogsIssues: 0, pendingTimeAdjustments: 5 };
  const s = drSummary({ counts, unavailable: [] });
  assert.equal(s.total, 31);
  assert.deepEqual(s.top.map((t) => [t.key, t.n]), [["soNoInvoice", 9], ["overdueOrders", 7], ["pricingIssues", 4], ["doPendingDispatch", 3]], "ties keep declaration order");
  assert.equal(s.other, 31 - 23, "the rest is stated, not hidden");
  assert.equal(DR_CHECKS.length, 14);
  assert.ok(!DR_CHECKS.some((c) => c[0] === "pendingTimeAdjustments"));
  assert.equal(s.clear, false);
  assert.equal(drSummary({ counts: { total: 0 }, unavailable: [] }).clear, true);
});

test("Daily Report: a sweep that could not run a check is partial, never clear", () => {
  const s = drSummary({ counts: { total: 0, checksRun: 12, checksTotal: 15 }, unavailable: [{ check: "soNoDo", message: "x" }, { check: "rdStalled", message: "x" }, { check: "incompleteBoms", message: "x" }] });
  assert.equal(s.partial, true);
  assert.equal(s.failed, 3);
  assert.equal(s.clear, false, "0 with failed checks is a floor, not a clean day");
});

test("Daily Report item rows use only fields the report returns and never invent a status", () => {
  const groups = {
    overdueOrders: [{ salesOrderId: "so1", companySOId: "SO-1", customerName: "ACME", productSummary: "Sofa x2", daysOverdue: 4, status: "CONFIRMED" }],
    doPendingDispatch: [{ id: "d1", doNo: "DO-1", customerName: "ACME", daysWaiting: 2 }],
    poNotReceived: [{ id: "p1", poNo: "PO-1", supplierName: "Foam Co", daysOpen: 9, status: "SENT" }],
    pricingIssues: [{ kind: "ZERO_PRICE", ref: "SO-9", detail: "line 2", amountSen: 12345 }],
  };
  const o = drRows("overdueOrders", groups)[0];
  assert.deepEqual([o.ref, o.right, o.rightSub, o.link], ["SO-1", "4 d", "CONFIRMED", { kind: "so", id: "so1" }]);
  assert.deepEqual(drRows("doPendingDispatch", groups)[0].link, { kind: "do", id: "d1" });
  assert.equal(drRows("poNotReceived", groups)[0].link, null, "no mobile PO page is linked");
  assert.equal(drRows("pricingIssues", groups)[0].rightSub, "ZERO_PRICE");
  assert.deepEqual(drRows("soNoDo", {}), [], "a missing list is empty rows, which the card words as 'not returned'");
  assert.match(read("HomeOpsA.tsx"), /The list for this check was not returned\./);
});

test("the Daily Report has no '+N more' action and no link to the desktop page", () => {
  const src = read("HomeOpsA.tsx");
  assert.doesNotMatch(src, /\/daily-report/);
  assert.doesNotMatch(src, /\+\$\{?\w*\}? more|more issues on the desktop/i);
});

// ---- Overdue / Due soon ---------------------------------------------------
const po = (n, dept, daysToDD, done, total, risk = "critical") => ({ poNo: n, customer: "C", productName: "P", currentDept: dept, daysToDD, stagesDone: done, stagesTotal: total, risk });
test("Overdue: most late first, finished-not-closed counted apart, every department offered even at zero", () => {
  const orders = [po("A", "UPHOLSTERY", -2, 1, 5), po("B", "FRAMING", -70, 2, 5), po("C", "PACKING", -9, 5, 5), po("D", "FRAMING", 3, 0, 5, "ontrack")];
  const s = overdueSplit(orders);
  assert.deepEqual(s.live.map((o) => o.poNo), ["B", "A"]);
  assert.deepEqual(s.done.map((o) => o.poNo), ["C"]);
  const chips = deptChips(s.live);
  assert.equal(chips.length, 10, "all ten floor departments");
  assert.equal(chips.find((c) => c.key === "FRAMING").n, 1);
  assert.equal(chips.find((c) => c.key === "WEBBING").n, 0);
  assert.equal(filterOrders(s.live, "FRAMING", "").length, 1);
  assert.equal(filterOrders(s.live, "ALL", "upholstery").length, 0, "search matches PO, customer, product only");
  const src = read("HomeOpsA.tsx");
  assert.match(src, /over 60 days late/);
});

test("Overdue and Due soon rows open the production order: number looked up on the existing board, then /m/production/:id", () => {
  const src = read("HomeOpsA.tsx");
  assert.match(src, /\/api\/production-orders\/board/, "the id comes from the board the mobile Production screen already reads");
  assert.match(src, /navigate\(`\/m\/production\/\$\{encodeURIComponent\(hit\.id\)\}`\)/);
  assert.doesNotMatch(src, /\/m\/production-orders\//, "the wrong route is never used");
  assert.match(src, /hasPermission\("production-orders", "read"\)/, "rows are tappable only with production-orders:read");
  assert.match(src, /Couldn’t find \$\{poNo\} on the production board/, "a missing order is said, not ignored");
  // nothing is fetched until a tap
  const hook = src.slice(src.indexOf("function useOpenOrder"), src.indexOf("function OrderRow"));
  assert.doesNotMatch(hook, /useCachedJson|useEffect/);
});

test("Due soon uses the desktop's urgency split: red to tomorrow, amber for 2-3 days", () => {
  assert.deepEqual(duePill(0), { label: "Today", urgent: true });
  assert.deepEqual(duePill(1), { label: "1 Day", urgent: true });
  assert.deepEqual(duePill(3), { label: "3 Days", urgent: false });
  assert.deepEqual(duePill(null), { label: "—", urgent: null });
});

// ---- Empty data vs denied vs failed vs loading ----------------------------
test("genuine empty data, a permission block and a failed request are different states", () => {
  assert.equal(slotStatus({ data: { rows: [] }, loading: false, failure: null }), "ready", "an empty answer is still an answer");
  assert.equal(slotStatus({ data: null, loading: false, failure: { status: 403 } }), "denied");
  assert.equal(slotStatus({ data: null, loading: false, failure: { status: 401 } }), "denied");
  assert.equal(slotStatus({ data: null, loading: false, failure: { status: 500 } }), "error");
  assert.equal(slotStatus({ data: null, loading: false, failure: { status: 0 } }), "error");
  assert.equal(slotStatus({ data: null, loading: true, failure: null }), "loading");
  assert.equal(slotStatus({ data: null, loading: false, failure: null }), "loading", "nothing settled yet is not 'empty'");
  assert.equal(slotStatus({ data: { x: 1 }, loading: false, failure: null }, false), "denied", "no client permission: never fetched, never shown as zero");
  assert.equal(slotStatus({ data: { x: 1 }, loading: false, failure: { status: 500 } }), "ready", "a failed refresh keeps the last answer");
});

test("a feed section the server redacted is denied; a missing one for any other reason is an error", () => {
  const denied = { live: false, reason: "insufficient permission: production-orders:read" };
  assert.equal(sectionStatus("ready", null, denied).status, "denied");
  assert.equal(sectionStatus("ready", null, { live: false, reason: "query failed" }).status, "error");
  assert.equal(sectionStatus("ready", null, undefined).status, "error");
  assert.equal(sectionStatus("ready", { orders: [] }, { live: true }).status, "ready", "an empty list is ready");
  assert.equal(sectionStatus("loading", null, denied).status, "loading");
  assert.equal(sectionStatus("error", null, denied).status, "error");
  const shortage = shortageSummary([]);
  assert.deepEqual([shortage.negative, shortage.zero], [0, 0]);
});

test("PRODUCTION: Operations opens, Daily Report / P&L / invoices are denied rather than empty", () => {
  assert.ok(allowedViews(PROD_TABS).includes("operations"));
  // PRODUCTION holds none of these module permissions (tests/dashboard-tab-access.test.mjs).
  for (const gate of [false]) {
    assert.equal(slotStatus({ data: null, loading: false, failure: null }, gate), "denied");
  }
  const feedDenied = (k) => sectionStatus("ready", null, { live: false, reason: `insufficient permission: ${k}` }).status;
  assert.equal(feedDenied("inventory:read"), "denied");
  const data = read("ops-data.ts");
  assert.match(data, /access\.salesOrders/, "Daily Report is gated on sales-orders:read");
  assert.match(data, /access\.accounting/, "the P&L is gated on accounting:read");
  assert.match(data, /access\.invoices/, "D1: supplier invoices are gated on invoices:read");
  assert.match(data, /access\.payroll && access\.workers && access\.payslips/, "labour needs payroll AND the two reads its inputs need");
  assert.match(data, /canLabour \? "denied"|!canLabour \? "denied"/);
});

test("endpoints are the desktop's and none is new", () => {
  const data = read("ops-data.ts");
  for (const url of ["/api/dashboard/prototype", "/api/dashboard/overview?period=", "/api/dashboard/overview/revenue-split?period=", "/api/reports/compliance.json", "/api/accounting/cost-structure", "/api/purchase-invoices"]) {
    assert.ok(data.includes(url), url);
  }
  assert.ok(read("HomeOpsC.tsx").includes("/api/purchase-orders"));
  for (const f of OPS_FILES) {
    for (const m of read(f).matchAll(/["'`](\/api\/[^"'`$?]*)/g)) {
      assert.ok(["/api/dashboard/prototype", "/api/dashboard/overview", "/api/dashboard/overview/revenue-split", "/api/reports/compliance.json", "/api/accounting/cost-structure", "/api/purchase-invoices", "/api/purchase-orders", "/api/production-orders/board", "/api/workers", "/api/working-hour-entries"].includes(m[1]), `${f}: ${m[1]}`);
    }
  }
});

// ---- Costing --------------------------------------------------------------
test("Costing: materials at the month's P&L ratio, the running month at the last finished month's, labour per day", () => {
  const revByDay = new Map([["2026-10-01", { total: 100 }], ["2026-10-02", { total: 100 }], ["2026-11-02", { total: 200 }]]);
  const cs = { data: { cols: ["2026-10", "2026-11"], groups: [{ group: "A", months: [{ opening: 50, purchase: 100, closing: 50 }, { opening: 9, purchase: 9, closing: 9 }] }] } };
  const pnl = pnlMaterials([cs], "2026-11-05");
  assert.deepEqual([...pnl.entries()], [["2026-10", 100]], "the running month has no closing stock and is left out");
  const byDay = costingByDay({ revByDay, pnl, labourByDay: labourPerDay(new Map([["w1|2026-10-01", 30], ["w2|2026-10-01", 10]])), pis: [], from: "2026-10-01", to: "2026-11-05" });
  assert.equal(byDay.get("2026-10-01").material, 50);
  assert.equal(byDay.get("2026-11-02").material, 100, "estimated: 0.5 of revenue, from October");
  assert.equal(byDay.get("2026-10-01").labour, 40);
  const byMonth = rollUpMonths(byDay);
  const cols = costingCols({ byDay, byMonth, focusMonth: "2026-11", today: "2026-11-05", estimated: (ym) => !pnl.has(ym) });
  assert.deepEqual(cols.map((c) => c.label), ["Nov 2026", "Oct 2026", "3-month avg"]);
  assert.match(cols[0].sub, /to date · live · materials est\./);
  assert.equal(costOf(byMonth.get("2026-10"), false), 100);
  assert.equal(costOf(byMonth.get("2026-10"), true), 140, "labour adds only when the reader may see it");
  assert.equal(costingCols({ byDay, byMonth, focusMonth: "2026-11", day: "2026-11-02", today: "2026-11-05", estimated: () => true })[0].sub, "the selected day");
  assert.deepEqual(costingMonths("2026-11", false, "2026-11-05"), ["2026-08", "2026-09", "2026-10", "2026-11"]);
});

// ---- Plan vs actual -------------------------------------------------------
const lim = {
  orders: { withoutTarget: 2, byDay: [
    { date: "2026-10-01", planOrders: 2, planUnits: 4, actualOrders: 1, actualUnits: 3 },
    { date: "2026-10-02", planOrders: 1, planUnits: 1, actualOrders: 1, actualUnits: 1 },
    { date: "2026-11-02", planOrders: 3, planUnits: 3, actualOrders: 0, actualUnits: 0 },
  ] },
  stages: { byDay: [{ date: "2026-10-01", dept: "FRAMING", plan: 3, actual: 2 }, { date: "2026-12-01", dept: "FRAMING", plan: 9, actual: 0 }] },
};
test("Plan vs actual: a day per bar, a month per bar on a year, running totals null after today, no revenue rows", () => {
  const oct = { mode: "monthly", month: "2026-10" };
  assert.deepEqual(planBars(lim, oct, "units").map((b) => [b.label, b.plan, b.actual]), [["10-01", 4, 3], ["10-02", 1, 1]]);
  const year = planBars(lim, { mode: "ytd", month: "2026-11" }, "orders");
  assert.deepEqual(year.map((b) => [b.iso, b.plan, b.actual]), [["2026-10", 3, 2], ["2026-11", 3, 0]]);
  const cum = planCumulative(planBars(lim, { mode: "ytd", month: "2026-11" }, "orders"), "2026-10-15");
  assert.deepEqual(cum.map((r) => [r.duePlan, r.done]), [[3, 2], [6, null]]);
  assert.deepEqual(planTotals(lim, { ...oct, day: "2026-10-02" }), { po: 1, pu: 1, ao: 1, au: 1 }, "a picked day narrows the totals, not the bars");
  assert.deepEqual(stageRows(lim, oct, "2026-11-05"), [{ dept: "FRAMING", plan: 3, actual: 2 }]);
  const src = read("HomeOpsB.tsx");
  assert.doesNotMatch(src, /label="Production revenue"|Orders upholstered|Completed with no price|unpricedOrders|lim\.revenue/, "dead desktop branches are not exposed");
});

// ---- Purchasing, fabric, stock -------------------------------------------
test("Purchasing: spend by invoice month, share of production revenue, expected spend from the 3 months before", () => {
  const pm = purchasingMonths("2026-10", "2026-11-05");
  assert.deepEqual(pm.months, ["2026-10"]);
  assert.equal(pm.trendMonths.length, 6);
  const rev = new Map([["2026-09-10", { total: 1000 }], ["2026-10-10", { total: 2000 }]]);
  const pis = [
    { piNo: "A", invoiceDate: "2026-10-03", amountSen: 500, status: "POSTED", supplierName: "S1" },
    { piNo: "B", invoiceDate: "2026-10-04", amountSen: 300, status: "CANCELLED", supplierName: "S1" },
    { piNo: "C", invoiceDate: "2026-09-04", amountSen: 100, status: "POSTED", supplierName: "S2" },
  ];
  const c = purchasingCalc({ pis, revByDay: rev, months: pm.months, prevMonths: pm.prevMonths, trendMonths: pm.trendMonths });
  assert.equal(c.spend, 500, "a cancelled invoice is out");
  assert.equal(c.prevSpend, 100);
  assert.equal(c.share, 25);
  assert.equal(c.change, 400);
  assert.deepEqual(c.top.map((t) => [t.name, t.sen, t.n]), [["S1", 500, 1]]);
  assert.equal(c.trend.find((t) => t.ym === "2026-10").expected, 2000 * 0.1, "10% rate of the one prior month with revenue");
  const stock = stockTake({ data: { cols: ["2026-08", "2026-09", "2026-11"], groups: [{ group: "G", description: "Foam", months: [{ closing: 100 }, { closing: 120 }, { closing: 999 }] }] } }, "2026-11-05");
  assert.deepEqual([stock.ym, stock.sen, stock.prevSen], ["2026-09", 120, 100], "the running month is not a stock take");
  assert.equal(stockTake({ data: { cols: [], groups: [] } }, "2026-11-05"), null);
});

test("Fabric: previous = used metres, next = next-30 demand, trend newest first, quarterly rolls up", () => {
  const cat = {
    list: [{ fabCode: "A", meters: 5, past30Meters: 1, next30Meters: 0, buyAvgSen: 1, buyMinSen: 1, buyMaxSen: 2 }, { fabCode: "B", meters: 9, past30Meters: 1, next30Meters: 4, buyAvgSen: 1, buyMinSen: 1, buyMaxSen: 2 }, { fabCode: "C", meters: 0, past30Meters: 0, next30Meters: 7, buyAvgSen: 1, buyMinSen: 1, buyMaxSen: 2 }],
    monthly: [{ month: "2026-01", meters: 10, costSen: 100 }, { month: "2026-02", meters: 10, costSen: 300 }, { month: "2026-04", meters: 5 }],
  };
  assert.deepEqual(fabricRows(cat, "previous").map((r) => r.fabCode), ["B", "A"]);
  assert.deepEqual(fabricRows(cat, "next").map((r) => r.fabCode), ["C", "B"]);
  assert.deepEqual(fabricTrend(cat, "monthly").map((t) => t.key), ["2026-04", "2026-02", "2026-01"]);
  assert.equal(fabricTrend(cat, "monthly")[0].perM, null, "no cost recorded: a dash, not RM 0");
  assert.deepEqual(fabricTrend(cat, "quarterly").map((t) => [t.label, t.meters, t.perM]), [["Q2 2026", 5, null], ["Q1 2026", 20, 20]]);
  assert.equal(fabricRows(undefined, "previous").length, 0);
});

// ---- Source guards --------------------------------------------------------
test("no prototype sample value or hardcoded business number ships in the Operations view", () => {
  const banned = /Zulaikha|Aiman, Farid|Illustrative sample|1,284,600|186,420|RM 34\.20|31\.40|38\.90|36\.0%|34\.6%|wave\(|Mewah Home|Desa Interior|30 Oct 2026|Workforce["']?\s*[:,]\s*41|186\s*\/\s*74|132\s*\/\s*58|\b1180000\b|1,180,000/;
  for (const f of OPS_FILES) assert.doesNotMatch(read(f), banned, `${f} carries a prototype sample value`);
});

test("no invented thresholds or colours-by-severity: department days are not banded at 7 / 3", () => {
  for (const f of OPS_FILES) assert.doesNotMatch(read(f), />=\s*7\b[^;\n]*(red|amber)|>=\s*3\b[^;\n]*(red|amber)/i, f);
});

test("loading, partial and error states come from the request lifecycle, never from a timer", () => {
  for (const f of OPS_FILES) assert.doesNotMatch(read(f), /setTimeout|setInterval|Date\.now\(\)\s*-/, `${f} uses a timer`);
});

test("the Operations view imports no desktop view and writes nothing", () => {
  for (const f of OPS_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /from\s+["'][^"']*(OperationsView|CostingPanel|PurchasingPanel|ProductionDailyPanels|OverdueOrdersList|OverdueCards|dashboard-b["'/]index)["']/, f);
    assert.doesNotMatch(src, /method:\s*["'](POST|PUT|PATCH|DELETE)|apiFetch\(|fetch\(/, `${f} writes or fetches by hand`);
  }
});

// ---- Visual fidelity to the approved Home Operations HTML (structure guards) -------------------------------
test("Overview sections are in the approved HTML's order, Output & Cost likewise", () => {
  const src = read("OpsView.tsx");
  const order = (names) => names.map((n) => src.indexOf(`<${n} `)).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1]));
  assert.ok(order(["DailyReportCard", "PlantLoadCard", "DeptBacklogCard", "DeptRevenueCard", "OverdueCard", "DueSoonCard"]), "Overview order");
  assert.ok(order(["CostingCard", "PlanCard", "PurchasingCard", "FabricCard", "ShortageCard"]), "Output & Cost order");
  assert.doesNotMatch(src, /Refresh/, "no control that is not in the HTML");
});

test("the Overview / Output & Cost control is the HTML's pair of pills, not a segmented switch", () => {
  const src = read("HomeDashboard.tsx");
  const block = src.slice(src.indexOf('aria-label="Operations section"'), src.indexOf("<PeriodCalendar", src.indexOf('aria-label="Operations section"')));
  assert.match(block, /flex: "none", height: 34, padding: "0 14px"/);
  assert.match(block, /borderRadius: 999/);
  assert.doesNotMatch(block, /gridTemplateColumns/);
});

test("the HTML's card anatomy is present: icon tile, state tag, bottleneck alert, plan headline and chart axes", () => {
  const a = read("HomeOpsA.tsx");
  assert.match(a, /IconTile icon=\{ClipboardCheck\}/, "Daily Report icon tile");
  const p = read("HomeOpsP.tsx");
  assert.match(p, /LIVE — NO SNAPSHOT/);
  assert.match(p, /Bottleneck <b/);
  assert.match(p, /tap to show \/ hide/);
  assert.match(p, /tap for detail/);
  const b = read("HomeOpsB.tsx");
  assert.match(b, /planned<\/span>/, "plan headline");
  assert.match(b, /textAnchor="end"/, "chart y-axis labels");
  assert.match(b, /strokeDasharray="5 4"/, "dashed plan line");
  assert.doesNotMatch(b, /Sparkline/, "owner removed the extra sparkline");
  const c = read("HomeOpsC.tsx");
  assert.match(c, /OWN PERIOD/);
  assert.match(c, /Overall \(all issued\)/);
  assert.match(c, /Excl\. Bedframe & Sofa/);
  assert.doesNotMatch(c, /\["Bedframe", rm\(fc\.bedframe\)\]|\["Sofa", rm\(fc\.sofa\)\]/, "two desktop cost tiles, not three");
});

test("Daily Report rows keep neutral rails and pills built only from real fields", () => {
  const a = read("HomeOpsA.tsx");
  assert.match(a, /neutralRail/);
  assert.doesNotMatch(a, /tier|urgency/i);
});

test("number formats follow the approved design: '55 h', '7h 05m', 'N days'", () => {
  assert.equal(hrsFmt(3300), "55 h");
  assert.equal(hmFmt(425), "7h 05m");
  assert.equal(hmFmt(0), "0h 00m");
});
