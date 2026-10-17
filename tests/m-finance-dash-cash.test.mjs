// ---------------------------------------------------------------------------
// m-finance-dash-cash.test.mjs — the Finance Dashboard and Daily Cash Position
// on the phone (plan 2026-10-17-finance-v2-mobile Task 3). Each reads its
// desktop endpoint; the cash bottom line uses the desktop's default scopes;
// the share image is the desktop's own drawing; the dashboard's lines are the
// desktop card's tabs. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { cashAfterRepayReceive } from "../src/lib/cash-position-image.ts";
import { FIN_DASH_LINES, dashGap } from "../src/pages/m/screens/finance/m-finance-lib.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dir = "src/pages/m/screens/finance/";

test("cash after repay & receive: only months before this one, as the desktop's default", () => {
  const t = cashAfterRepayReceive(
    {
      totalAvailableSen: 100000,
      repay: [{ month: "2026-09", outstandingSen: 30000 }, { month: "2026-10", outstandingSen: 99999 }],
      receive: [{ month: "2026-08", totalSen: 20000 }, { month: "2026-10", totalSen: 88888 }, { month: "2026-09" }],
    },
    "2026-10",
  );
  assert.deepEqual(t, { repayShownSen: 30000, recvShownSen: 20000, tfShownSen: 0, netAfterSen: 90000 });
  // The desktop computes the same thing inline.
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /const repayRows = \(cur\?\.repay \?\? \[\]\)\.filter\(\(r\) => repayAll \|\| r\.month < curMonth\);/);
  assert.match(ui, /const netAfterSen = \(cur\?\.totalAvailableSen \?\? 0\) - repayShownSen - tfShownSen \+ recvShownSen;/);
});

test("the dashboard's gap: income under plan or a cost over it is bad", () => {
  assert.deepEqual(dashGap("sales", 800, 1000), { sen: -200, bad: true });
  assert.deepEqual(dashGap("net", 1200, 1000), { sen: 200, bad: false });
  assert.deepEqual(dashGap("materials", 1200, 1000), { sen: 200, bad: true });
  assert.deepEqual(dashGap("overhead", 900, 1000), { sen: -100, bad: false });
  assert.equal(dashGap("sales", null, 1000), null);
});

test("the dashboard's lines are the desktop card's tabs, in order", () => {
  const dash = read("src/pages/finance-dashboard.tsx");
  const block = dash.slice(dash.indexOf("const PL_TABS"), dash.indexOf("];", dash.indexOf("const PL_TABS")));
  const desktop = [...block.matchAll(/\{ key: "(\w+)", label: "([^"]+)" \}/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(FIN_DASH_LINES.map((l) => [l.key, l.label]), desktop);
});

test("Daily Cash: the desktop read, the shared image through the share sheet, read-only", () => {
  const cash = read(dir + "CashScreen.tsx");
  assert.match(cash, /`\/api\/accounting\/cash-position\?date=\$\{date\}`/);
  assert.match(cash, /const totals = cur \? cashAfterRepayReceive\(cur, date\.slice\(0, 7\)\) : null;/);
  assert.match(cash, /const blob = await drawCashPositionImage\(cur, totals\);/);
  assert.match(cash, /if \(nav\.share && nav\.canShare\?\.\(\{ files: \[file\] \}\)\)/);
  assert.match(cash, /a\.download = file\.name;/, "saved where file sharing is not offered");
  assert.doesNotMatch(cash, /method: "(POST|PUT|DELETE)"/, "ticks and planned payments stay on the desktop");
  assert.match(cash, /pendingReceiptsFirst\(a\.pending\.filter\(\(p\) => !p\.ticked\)\)/, "the desktop's order");
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /drawCashPositionImage\(cur, \{ netAfterSen, repayShownSen, recvShownSen, tfShownSen \}\)/, "the desktop draws through the same module");
});

test("Finance Dashboard: the desktop read; both screens in the menu; the rail's Finance entry", () => {
  const dash = read(dir + "DashScreen.tsx");
  assert.match(dash, /"\/api\/accounting\/dashboard\?granularity=month&periods=12"/);
  assert.match(dash, /const gap = dashGap\(line, actual, forecast\);/);
  const route = read(dir + "FinanceRoute.tsx");
  assert.match(route, /\n  dashboard: \(\) => <DashScreen \/>,/);
  assert.match(route, /\n  cash: \(\) => <CashScreen \/>,/);
  const rail = read("src/pages/m/components/LeftRail.tsx");
  assert.match(rail, /\{ kind: "item", key: "finance", label: "Finance", icon: Landmark, path: "\/m\/finance", navGateAny: FINANCE_NAV_GATES \}/);
  assert.match(rail, /if \(e\.kind === "item" && e\.navGateAny && !e\.navGateAny\.some\(isNavAllowed\)\) return null;/);
});
