// ---------------------------------------------------------------------------
// mobile-notification-filters.test.mjs — pure search + filter rules for
// /m/updates → Notifications (src/pages/m/lib/notification-filters.ts).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const f = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/notification-filters.ts")).href
);

const n = (id, extra = {}) => ({
  id,
  type: "ORDER",
  title: `t-${id}`,
  message: "",
  severity: "INFO",
  isRead: false,
  createdAt: "2026-10-13T09:00:00Z",
  ...extra,
});

const ALL = f.DEFAULT_FILTERS;

test("option values are exactly the DB CHECK values", () => {
  const init = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  const block = init.slice(init.indexOf("CREATE TABLE notifications"));
  const values = (re) => block.match(re)[1].match(/'([A-Z]+)'/g).map((s) => s.slice(1, -1)).sort();
  const types = values(/type TEXT CHECK \(type IN \(([^)]*)\)\)/);
  const sevs = values(/severity TEXT CHECK \(severity IN \(([^)]*)\)\)/);
  assert.deepEqual(f.CATEGORY_OPTIONS.slice(1).map((o) => o.value).sort(), types);
  assert.deepEqual(f.SEVERITY_OPTIONS.slice(1).map((o) => o.value).sort(), sevs);
  assert.deepEqual(
    f.CATEGORY_OPTIONS.map((o) => o.label),
    ["All types", "Orders", "Production", "Inventory", "Delivery", "Quality", "Finance", "System"],
  );
  assert.deepEqual(f.READ_OPTIONS.map((o) => o.value), ["all", "unread", "read"]);
  assert.deepEqual(f.SEVERITY_OPTIONS.map((o) => o.label), ["All severities", "Critical", "Warning", "Info"]);
});

test("reference: ticket, else a last segment with a digit; bare module paths add nothing", () => {
  assert.equal(f.notificationReference("/it-support?ticket=HK-0001"), "HK-0001");
  assert.equal(f.notificationReference("/sales/SO-2604-045"), "SO-2604-045");
  assert.equal(f.notificationReference("/finance/invoices"), "");
  assert.equal(f.notificationReference("/inventory"), "");
  assert.equal(f.notificationReference(undefined), "");
  assert.equal(f.notificationReference("https://x.example/sales/SO-1"), "");
  assert.equal(f.notificationReference("/sales/%E0%A4%A1"), "");
});

test("search: title, message and link reference; every word must match; case-insensitive", () => {
  const rows = [
    n("a", { title: "New Sales Order Received", message: "From HOUZS KL", link: "/sales/SO-2604-045" }),
    n("b", { title: "IT replied", message: "Printer", link: "/it-support?ticket=HK-0007" }),
    n("c", { title: "Low Stock Alert", message: "Premium Black Fabric", link: "/inventory" }),
  ];
  const ids = (q) => f.filterNotifications(rows, q, ALL).map((r) => r.id);
  assert.deepEqual(ids(""), ["a", "b", "c"]);
  assert.deepEqual(ids("  "), ["a", "b", "c"]);
  assert.deepEqual(ids("houzs"), ["a"]);
  assert.deepEqual(ids("so-2604-045"), ["a"]); // only in the link
  assert.deepEqual(ids("hk-0007"), ["b"]); // only in the ticket param
  assert.deepEqual(ids("houzs 045"), ["a"]); // every word
  assert.deepEqual(ids("houzs printer"), []);
  assert.deepEqual(ids("inventory"), []); // a module path is not a reference
  assert.deepEqual(ids("BLACK fabric"), ["c"]);
});

test("filters AND together (Orders + Unread + Critical) and with search", () => {
  const rows = [
    n("hit", { type: "ORDER", isRead: false, severity: "CRITICAL", title: "Overdue SO" }),
    n("read", { type: "ORDER", isRead: true, severity: "CRITICAL", title: "Overdue SO" }),
    n("warn", { type: "ORDER", isRead: false, severity: "WARNING", title: "Overdue SO" }),
    n("prod", { type: "PRODUCTION", isRead: false, severity: "CRITICAL", title: "Overdue SO" }),
    n("other", { type: "ORDER", isRead: false, severity: "CRITICAL", title: "Something else" }),
  ];
  const sel = { category: "ORDER", read: "unread", severity: "CRITICAL" };
  assert.deepEqual(f.filterNotifications(rows, "", sel).map((r) => r.id), ["hit", "other"]);
  assert.deepEqual(f.filterNotifications(rows, "overdue", sel).map((r) => r.id), ["hit"]);
  assert.deepEqual(f.filterNotifications(rows, "", { ...ALL, read: "read" }).map((r) => r.id), ["read"]);
});

test("read status uses the shared isUnread (integer / string legacy values)", () => {
  const rows = [n("int", { isRead: 1 }), n("str", { isRead: "1" }), n("no", { isRead: 0 }), n("missing", { isRead: undefined })];
  assert.deepEqual(f.filterNotifications(rows, "", { ...ALL, read: "read" }).map((r) => r.id), ["int", "str"]);
  assert.deepEqual(f.filterNotifications(rows, "", { ...ALL, read: "unread" }).map((r) => r.id), ["no", "missing"]);
});

test("unknown / missing type or severity only shows under All", () => {
  const rows = [n("x", { type: null, severity: null }), n("y", { type: "ODD", severity: "LOUD" })];
  assert.equal(f.filterNotifications(rows, "", ALL).length, 2);
  for (const v of ["ORDER", "SYSTEM"]) assert.equal(f.filterNotifications(rows, "", { ...ALL, category: v }).length, 0);
  for (const v of ["CRITICAL", "INFO"]) assert.equal(f.filterNotifications(rows, "", { ...ALL, severity: v }).length, 0);
});

test("active filter count", () => {
  assert.equal(f.activeFilterCount(ALL), 0);
  assert.equal(f.activeFilterCount({ category: "ORDER", read: "all", severity: "all" }), 1);
  assert.equal(f.activeFilterCount({ category: "ORDER", read: "unread", severity: "CRITICAL" }), 3);
});

test("URL: read with junk → All; write drops defaults and keeps other params", () => {
  const r = f.readNotificationParams(new URLSearchParams("q=houzs&cat=ORDER&read=unread&sev=CRITICAL&view=x"));
  assert.deepEqual(r, { q: "houzs", filters: { category: "ORDER", read: "unread", severity: "CRITICAL" } });
  const junk = f.readNotificationParams(new URLSearchParams("cat=order&read=maybe&sev=<script>"));
  assert.deepEqual(junk, { q: "", filters: ALL });
  const w = f.writeNotificationParams(new URLSearchParams("view=announcements&q=old&cat=ORDER"), "  ", ALL);
  assert.equal(w.toString(), "view=announcements");
  const w2 = f.writeNotificationParams(new URLSearchParams(""), "so 045", { category: "FINANCE", read: "all", severity: "WARNING" });
  assert.deepEqual(Object.fromEntries(w2), { q: "so 045", cat: "FINANCE", sev: "WARNING" });
});
