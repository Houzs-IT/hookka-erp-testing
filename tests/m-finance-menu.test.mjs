// ---------------------------------------------------------------------------
// m-finance-menu.test.mjs — the phone's Finance menu and its gates (plan
// 2026-10-17-finance-v2-mobile Task 1). Owner 2026-10-14: mobile Finance
// follows the desktop gate — no permission, no row; a deep link without it
// says "No access" (the API still denies).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { FINANCE_MENU, FINANCE_NAV_GATES, allowedFinanceMenu, anyFinanceAllowed, financeRowFor } from "../src/pages/m/finance-menu.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
// The app's gate drops the query string and hides by path (use-permission.ts).
const gate = (hidden) => (href) => !hidden.includes(href.split("?")[0]);

test("the menu: three sections, eight screens, each with the desktop page's gate", () => {
  assert.deepEqual(FINANCE_MENU.map((s) => s.title), ["Finance", "Reports", "Debtors & Creditors"]);
  const rows = FINANCE_MENU.flatMap((s) => s.rows);
  assert.deepEqual(rows.map((r) => r.screen), ["dashboard", "cash", "overview", "pl", "cashflow", "bs", "debtors", "creditors"]);
  assert.equal(rows.find((r) => r.screen === "dashboard").navGate, "/finance-dashboard");
  assert.equal(rows.find((r) => r.screen === "debtors").navGate, "/accounting?tab=ar");
  assert.equal(FINANCE_NAV_GATES.length, 8);
});

test("no permission, no row: a role without accounting sees only the dashboard row", () => {
  const isAllowed = gate(["/accounting"]);
  const menu = allowedFinanceMenu(isAllowed);
  assert.deepEqual(menu.map((s) => s.title), ["Finance"], "empty sections are dropped");
  assert.deepEqual(menu[0].rows.map((r) => r.screen), ["dashboard"]);
  assert.equal(financeRowFor("debtors", isAllowed), null, "a deep link is refused");
  assert.equal(financeRowFor("dashboard", isAllowed).label, "Finance Dashboard");
  assert.equal(financeRowFor("nonsense", () => true), null);
});

test("a role with no finance page at all gets no Finance row in More", () => {
  assert.equal(anyFinanceAllowed(gate(["/accounting", "/finance-dashboard"])), false);
  assert.equal(anyFinanceAllowed(gate(["/finance-dashboard"])), true);
});

test("More: the Finance row (any gate) and Receivables gated like Debtor Aging", () => {
  const nav = read("src/pages/m/nav.ts");
  assert.match(nav, /\{ label: "Finance", icon: Landmark, path: "\/m\/finance", navGateAny: FINANCE_NAV_GATES \}/);
  assert.match(nav, /\{ label: "Receivables", icon: Wallet, path: "\/m\/receivables", navGate: "\/accounting\?tab=ar" \}/);
  const more = read("src/pages/m/screens/More.tsx");
  assert.match(more, /\(!i\.navGate \|\| isNavAllowed\(i\.navGate\)\) && \(!i\.navGateAny \|\| i\.navGateAny\.some\(isNavAllowed\)\)/);
});

test("routes: /m/finance and /m/finance/:screen, code-split; a refused screen says No access", () => {
  const layout = read("src/pages/m/MobileLayout.tsx");
  assert.match(layout, /const FinanceRoute = lazy\(\(\) => import\("\.\/screens\/finance\/FinanceRoute"\)\);/);
  assert.match(layout, /<Route path="finance" element=\{<FinanceRouteShell \/>\} \/>/);
  assert.match(layout, /<Route path="finance\/:screen" element=\{<FinanceRouteShell \/>\} \/>/);
  const route = read("src/pages/m/screens/finance/FinanceRoute.tsx");
  assert.match(route, /const row = financeRowFor\(screen, isNavAllowed\);\n\s*if \(!row\) return <FinanceNoAccess title="Finance" \/>;/);
  assert.match(route, /allowedFinanceMenu\(isNavAllowed\)/);
  assert.match(route, /<MobileHeader title="Finance" onBack=\{\(\) => navigate\("\/m\/more"\)\} \/>/);
  const shell = read("src/pages/m/screens/finance/finance-shell.tsx");
  assert.match(shell, /onBack=\{\(\) => navigate\("\/m\/finance"\)\}/, "every screen backs out to the Finance menu");
});
