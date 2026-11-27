// AI Connector screen map (owner 2026-11-27): every router page explained,
// explain_screen (from a URL or screenshot labels), where_is, and the
// ?highlight= matcher. Honesty first: every path is in the router and every
// label is in src/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCREENS, screenForPath, screensForLabels, explainScreen, whereIs } from "../src/api/lib/mcp-screens.ts";
import { pickHighlightTarget, normaliseLabel } from "../src/lib/highlight-match.ts";
import { checkScreens } from "./_howto-check.mjs";

const ORIGIN = "https://erp.example";
const yes = async () => true;
const no = async () => false;

/** Router paths that render a page (redirects and the "*" fallback excluded). */
function pagePaths() {
  const out = new Set();
  for (const f of ["src/dashboard-routes.tsx", "src/router.tsx"]) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const m of t.matchAll(/path:\s*'([^']+)'(.{0,80})/g)) if (!/Navigate/.test(m[2])) out.add(m[1]);
  }
  const ml = readFileSync(new URL("../src/pages/m/MobileLayout.tsx", import.meta.url), "utf8");
  for (const m of ml.matchAll(/path="([^"]+)"/g)) if (m[1] !== "*") out.add(m[1] === "/" ? "/m" : `/m/${m[1].replace(/^\//, "")}`);
  out.delete("*");
  return [...out];
}

test("screen map: every path is in the router and every label is in src/", () => {
  const bad = checkScreens(SCREENS);
  assert.deepEqual(bad, [], bad.map((b) => `${b.id}: ${b.problem}`).join("\n"));
});

test("screen map: every router page has exactly one entry", () => {
  const have = SCREENS.map((s) => s.path);
  assert.equal(new Set(have).size, have.length, "duplicate screen path");
  const missing = pagePaths().filter((p) => !have.includes(p));
  assert.deepEqual(missing, [], `pages without a screen entry: ${missing.join(", ")}`);
});

test("screen map: high-traffic pages are documented in full", () => {
  for (const p of ["/sales", "/sales/create", "/sales/:id", "/procurement", "/procurement/create", "/procurement/grn", "/procurement/pi", "/delivery", "/invoices", "/invoices/payments", "/production", "/production/fab-cut", "/worker/scan", "/worker/qc", "/service-cases", "/service-cases/:id", "/products", "/bom", "/inventory", "/planning/mrp", "/mail-center", "/maintenance", "/settings"]) {
    const s = SCREENS.find((x) => x.path === p);
    assert.ok(s, p);
    assert.equal(s.detail, "full", `${p} is not full detail`);
    assert.ok(s.actions.length >= 3, `${p} has only ${s.actions.length} actions`);
  }
});

test("screenForPath: most specific pattern, URL / query / id handled", () => {
  assert.equal(screenForPath("/procurement/grn").screen.path, "/procurement/grn");
  assert.equal(screenForPath("https://erp.example/procurement/grn/abc123").screen.path, "/procurement/grn/:id");
  assert.equal(screenForPath("https://erp.example/sales/so_1?x=1#top").screen.path, "/sales/:id");
  const acc = screenForPath("/accounting?tab=receipts");
  assert.equal(acc.screen.path, "/accounting");
  assert.equal(acc.tab, "receipts");
  assert.equal(screenForPath("/nope/nothing/here"), null);
});

test("explain_screen from screenshot labels finds the page", async () => {
  const target = SCREENS.find((s) => s.path === "/procurement/grn/create");
  const labels = [target.title, ...target.actions.slice(0, 6).map((a) => a.label)];
  assert.equal(screensForLabels(labels)[0].screen.path, "/procurement/grn/create");
  const r = await explainScreen({ visible_text: labels }, ORIGIN, yes);
  assert.equal(r.matched, true);
  assert.equal(r.value.identifiedBy, "visible labels");
  assert.equal(r.value.screen.path, "/procurement/grn/create");
  assert.equal((await explainScreen({ visible_text: ["zzqq", "xyzzy"] }, ORIGIN, yes)).matched, false);
});

test("explain_screen canDo follows permissions; links carry ?highlight=", async () => {
  const ok = await explainScreen({ path: "/sales" }, ORIGIN, yes);
  assert.equal(ok.value.screen.canOpen, true);
  const withPerm = ok.value.screen.actions.find((a) => a.permission);
  assert.ok(withPerm, "no permissioned action on /sales");
  assert.equal(withPerm.canDo, true);
  assert.ok(withPerm.link.startsWith(`${ORIGIN}/sales?highlight=`));
  const denied = await explainScreen({ path: "/sales" }, ORIGIN, no);
  assert.equal(denied.value.screen.canOpen, false);
  assert.ok(denied.value.screen.actions.every((a) => a.canDo === false));
  // Only the action's own permission decides once the page opens.
  const only = new Set(["sales-orders:read"]);
  const part = await explainScreen({ path: "/sales" }, ORIGIN, async (r, a) => only.has(`${r}:${a}`));
  const a = part.value.screen.actions.find((x) => x.permission && x.permission !== "sales-orders:read");
  if (a) assert.equal(a.canDo, false);
});

test("where_is: maintenance log, sales order, credit note", async () => {
  const top = async (q) => (await whereIs({ thing: q }, ORIGIN, yes)).value.places?.[0];
  assert.match((await top("maintenance log")).link, /\/maintenance(\?|$)/);
  assert.equal((await top("open an SO")).link, `${ORIGIN}/sales?highlight=New%20Sales%20Order`);
  assert.match((await top("maintenance log")).link, /highlight=Log/);
  assert.match((await top("credit note")).link, /\/invoices\/credit-notes/);
  assert.equal((await whereIs({ thing: "zzqq xyzzy" }, ORIGIN, yes)).matched, false);
});

test("highlight matcher: exact beats partial, interactive beats text, invisible never", () => {
  const c = (text, o = {}) => ({ text, interactive: true, visible: true, ...o });
  assert.equal(normaliseLabel("  New   Sales Order "), "new sales order");
  assert.equal(pickHighlightTarget([c("New Sales Order and more text around it"), c("New Sales Order")], "new sales order"), 1);
  assert.equal(pickHighlightTarget([c("New Sales Order", { interactive: false }), c("new sales order")], "New Sales Order"), 1);
  assert.equal(pickHighlightTarget([c("New Sales Order", { visible: false })], "New Sales Order"), -1);
  assert.equal(pickHighlightTarget([c("", { ariaLabel: "Print" })], "Print"), 0);
  assert.equal(pickHighlightTarget([c("Create DO (3)")], "Create DO"), 0);
  assert.equal(pickHighlightTarget([c("Save")], ""), -1);
  assert.equal(pickHighlightTarget([c("Cancel")], "Save"), -1);
});

test("highlight hook is read-only and mounted in every layout", () => {
  const hook = readFileSync(new URL("../src/hooks/use-highlight-param.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /\.click\(|\.focus\(|dispatchEvent|setTimeout|setInterval/);
  assert.match(hook, /replaceState/);
  for (const f of ["src/layouts/DashboardLayout.tsx", "src/layouts/WorkerLayout.tsx", "src/pages/m/MobileLayout.tsx"]) {
    assert.match(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /<HighlightFromUrl \/>/, f);
  }
});
