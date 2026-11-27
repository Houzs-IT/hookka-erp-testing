// AI Connector round 4d (owner 2026-11-26 「加 全部一起做」): morning brief
// email (D1), urgent alerts (D2), data_gaps (D4). Pure logic in
// src/api/lib/mcp-proactive.ts: the opt-in rules, when a brief is due, the
// alert rules + debounce, the HTML builder and the data-gaps summary — plus
// source checks that the route runs everything AS THE PERSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROACTIVE_CONFIG,
  DEFAULT_SUBSCRIPTION,
  mytNow,
  plusDays,
  parseSubscriptionInput,
  subscriptionFromRow,
  isBriefDue,
  inAlertHours,
  isMonday,
  pickTickWork,
  computeAlerts,
  alertsToSend,
  debounceSince,
  summariseDataGaps,
  buildBriefEmail,
  buildAlertEmail,
  escapeHtml,
  thresholdsForDisplay,
} from "../src/api/lib/mcp-proactive.ts";
import { classifyPath, makeRedactor } from "../src/api/lib/mcp-access.ts";
import { TOOL_NEEDS, STRUCTURED_TOOLS, TOOL_PAGES } from "../src/api/lib/mcp-visibility.ts";
import { CACHEABLE_TOOLS, PROACTIVE_CLIENT_ID } from "../src/api/lib/mcp-limits.ts";
import { LEAK_CHECK_TOOLS } from "../src/api/lib/mcp-leak-check.ts";

const O = "https://erp.example";
const TODAY = "2026-11-27"; // a Friday
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── time ────────────────────────────────────────────────────────────────────

test("mytNow: Malaysia wall clock (UTC+8), weekday, minutes", () => {
  const n = mytNow(new Date("2026-11-30T00:15:00Z")); // Mon 08:15 MYT
  assert.deepEqual(n, { day: "2026-11-30", hhmm: "08:15", minutes: 8 * 60 + 15, weekday: 1 });
  assert.equal(mytNow(new Date("2026-11-29T16:30:00Z")).day, "2026-11-30"); // 00:30 MYT next day
  assert.equal(plusDays("2026-11-30", 7), "2026-12-07");
  assert.equal(plusDays("2026-03-01", -1), "2026-02-28");
});

// ── opt-in ──────────────────────────────────────────────────────────────────

test("opt-in: defaults are OFF at 08:00 weekdays; good input accepted", () => {
  assert.deepEqual(DEFAULT_SUBSCRIPTION, { briefEnabled: false, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: false });
  const r = parseSubscriptionInput({ briefEnabled: true, briefTime: "07:30", briefDays: "daily", alertsEnabled: true, extra: "ignored" }, "u1");
  assert.deepEqual(r, { ok: true, value: { userId: "u1", briefEnabled: true, briefTime: "07:30", briefDays: "daily", alertsEnabled: true } });
  const d = parseSubscriptionInput({ briefEnabled: true }, "u1");
  assert.ok(d.ok && d.value.briefTime === "08:00" && d.value.briefDays === "weekdays" && d.value.alertsEnabled === false);
});

test("opt-in: refuses bad times (not on the half hour), days and non-boolean switches", () => {
  for (const briefTime of ["8:00", "08:15", "24:00", "08:00:00", "", "abc"]) {
    assert.equal(parseSubscriptionInput({ briefTime }, "u").ok, false, briefTime);
  }
  assert.equal(parseSubscriptionInput({ briefDays: "weekends" }, "u").ok, false);
  assert.equal(parseSubscriptionInput({ briefEnabled: "yes" }, "u").ok, false);
  assert.equal(parseSubscriptionInput({ alertsEnabled: 1 }, "u").ok, false);
  assert.equal(parseSubscriptionInput(null, "u").ok, false);
  assert.equal(parseSubscriptionInput([], "u").ok, false);
});

test("opt-in: rows read dual-keyed, integers or booleans; junk falls back to defaults", () => {
  assert.deepEqual(subscriptionFromRow({ user_id: "u", brief_enabled: 1, brief_time: "06:30", brief_days: "daily", alerts_enabled: 0 }), { userId: "u", briefEnabled: true, briefTime: "06:30", briefDays: "daily", alertsEnabled: false });
  assert.deepEqual(subscriptionFromRow({ userId: "u", briefEnabled: true, briefTime: "bad", briefDays: "x", alertsEnabled: true }), { userId: "u", briefEnabled: true, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: true });
});

// ── when the brief is due ───────────────────────────────────────────────────

const sub = (over = {}) => ({ userId: "u1", briefEnabled: true, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: false, lastAlertCheckAt: "", ...over });
const at = (iso) => mytNow(new Date(iso));

test("isBriefDue: on, at/after its time, within the cutoff, weekdays only unless daily", () => {
  const mon0800 = at("2026-11-30T00:00:00Z");
  const mon0730 = at("2026-11-29T23:30:00Z");
  const mon1200 = at("2026-11-30T04:00:00Z"); // 4 h after → past the cutoff
  const mon1130 = at("2026-11-30T03:30:00Z");
  const sat0900 = at("2026-11-28T01:00:00Z");
  assert.equal(isBriefDue(sub(), mon0800), true);
  assert.equal(isBriefDue(sub(), mon0730), false);
  assert.equal(isBriefDue(sub(), mon1130), true);
  assert.equal(isBriefDue(sub(), mon1200), false);
  assert.equal(isBriefDue(sub(), sat0900), false);
  assert.equal(isBriefDue(sub({ briefDays: "daily" }), sat0900), true);
  assert.equal(isBriefDue(sub({ briefEnabled: false }), mon0800), false);
  assert.equal(isMonday(mon0800), true);
  assert.equal(isMonday(sat0900), false);
});

test("pickTickWork: skips people already briefed today, caps per tick; alerts only in hours, least recently checked first", () => {
  const mon0830 = at("2026-11-30T00:30:00Z");
  const nowMs = Date.parse("2026-11-30T00:30:00Z");
  const many = Array.from({ length: PROACTIVE_CONFIG.maxBriefsPerTick + 5 }, (_, i) => sub({ userId: `u${i}` }));
  const w = pickTickWork(many, mon0830, new Set(["u0"]), nowMs);
  assert.equal(w.briefs.length, PROACTIVE_CONFIG.maxBriefsPerTick);
  assert.ok(!w.briefs.some((s) => s.userId === "u0"));

  const a = [
    sub({ userId: "recent", briefEnabled: false, alertsEnabled: true, lastAlertCheckAt: new Date(nowMs - 10 * 60_000).toISOString() }),
    sub({ userId: "old", briefEnabled: false, alertsEnabled: true, lastAlertCheckAt: new Date(nowMs - 3 * 3600_000).toISOString() }),
    sub({ userId: "never", briefEnabled: false, alertsEnabled: true, lastAlertCheckAt: "" }),
    sub({ userId: "off", briefEnabled: false, alertsEnabled: false }),
  ];
  assert.deepEqual(pickTickWork(a, mon0830, new Set(), nowMs).alerts.map((s) => s.userId), ["never", "old"]);
  assert.equal(inAlertHours(at("2026-11-30T13:00:00Z")), false); // 21:00 MYT
  assert.deepEqual(pickTickWork(a, at("2026-11-30T13:00:00Z"), new Set(), nowMs).alerts, []);
});

// ── alerts ──────────────────────────────────────────────────────────────────

const inputs = (over = {}) => ({
  today: TODAY,
  origin: O,
  poStats: { data: [
    { id: "po1", poNo: "PO-1", supplierName: "Acme", status: "SUBMITTED", expectedDate: "2026-11-26", totalSen: 800_000 }, // 1 day late, RM 8,000
    { id: "po2", poNo: "PO-2", supplierName: "Acme", status: "SUBMITTED", expectedDate: "2026-11-26", totalSen: 100_000 }, // below RM 5,000
    { id: "po3", poNo: "PO-3", supplierName: "Old", status: "SUBMITTED", expectedDate: "2026-11-01", totalSen: 900_000 }, // long overdue, not "newly"
    { id: "po4", poNo: "PO-4", supplierName: "Done", status: "RECEIVED", expectedDate: "2026-11-26", totalSen: 900_000 },
    { id: "po5", poNo: "PO-5", supplierName: "Today", status: "CONFIRMED", expectedDate: TODAY, totalSen: 900_000 }, // due today, not overdue
  ] },
  soDue: { data: [
    { id: "so1", companySOId: "SO-1", customerName: "Cust", status: "CONFIRMED", hookkaExpectedDD: "2026-11-25", totalSen: 600_000 }, // 2 days late
    { id: "so2", companySOId: "SO-2", customerName: "Cust", status: "CONFIRMED", hookkaExpectedDD: "2026-11-24", totalSen: 600_000 }, // 3 days: outside window
  ] },
  board: { data: { items: [
    { id: "pr1", poNo: "PRD-1", customerName: "Cust", productCode: "BF1", productName: "Bed", status: "IN_PROGRESS", targetEndDate: "2026-11-26" },
    { id: "pr2", poNo: "PRD-2", status: "COMPLETED", targetEndDate: "2026-11-26" },
  ] } },
  mrpPlan: { data: { materials: [
    { code: "FAB-1", description: "Velvet", uom: "M", short: 12, firstNeedBy: "2026-12-02" },
    { code: "FAB-2", short: 5, firstNeedBy: "2026-12-20" }, // beyond 7 days
    { code: "FAB-3", short: 0, firstNeedBy: "2026-11-28" },
  ] } },
  ...over,
});

test("computeAlerts: newly overdue PO/SO above the value, newly late production, short within 7 days", () => {
  const a = computeAlerts(inputs());
  assert.deepEqual(a.map((x) => x.key), ["po:po1", "so:so1", "prod:pr1", "mat:FAB-1"]);
  const po = a[0];
  assert.match(po.title, /PO-1/);
  assert.match(po.detail, /RM 8,000\.00/);
  assert.equal(po.link, `${O}/procurement/po1`);
  assert.equal(a[2].link, `${O}/production/pr1`);
  assert.equal(a[3].link, `${O}/planning/mrp`);
});

test("computeAlerts: a value the ERP hid from the person never passes the threshold (no leak by alert)", () => {
  // makeRedactor removes a money key the role may not see (or the route sends null):
  // either way the PO / SO is not value-alerted.
  const hidden = inputs().poStats.data.map(({ totalSen, ...rest }) => rest);
  const a = computeAlerts(inputs({ poStats: { data: hidden }, soDue: { data: [{ id: "so1", status: "CONFIRMED", hookkaExpectedDD: "2026-11-26", totalSen: null }] } }));
  assert.ok(!a.some((x) => x.kind === "po" || x.kind === "so"), JSON.stringify(a));
  // and the redactor really does drop a cost figure for a role without costing
  const d = classifyPath("/api/products");
  assert.ok(d.ok);
  const red = makeRedactor(() => false, d.resources)({ data: [{ id: "p", costPriceSen: 100 }] }).value;
  assert.ok(!("costPriceSen" in red.data[0]));
});

test("computeAlerts: a list the person cannot read (null) yields nothing", () => {
  assert.deepEqual(computeAlerts({ today: TODAY, origin: O, poStats: null, soDue: null, board: null, mrpPlan: null }), []);
});

test("debounce: a key sent today is never resent; newly-overdue once; shortages again after 7 days", () => {
  const a = computeAlerts(inputs());
  // nothing sent yet → all
  assert.equal(alertsToSend(a, new Map(), TODAY).length, 4);
  // all sent today → none (one email per key per person per day)
  const today = new Map(a.map((x) => [x.key, TODAY]));
  assert.deepEqual(alertsToSend(a, today, TODAY), []);
  // sent yesterday: PO/SO/production still inside their window → not again; material inside 7 days → not again
  const y = new Map(a.map((x) => [x.key, plusDays(TODAY, -1)]));
  assert.deepEqual(alertsToSend(a, y, TODAY), []);
  // material sent 7 days ago → again
  const wk = new Map([["mat:FAB-1", plusDays(TODAY, -7)]]);
  assert.deepEqual(alertsToSend(a.filter((x) => x.kind === "mat"), wk, TODAY).map((x) => x.key), ["mat:FAB-1"]);
  // duplicates in one batch collapse to one
  assert.equal(alertsToSend([a[0], a[0]], new Map(), TODAY).length, 1);
  assert.equal(debounceSince(TODAY), plusDays(TODAY, -PROACTIVE_CONFIG.alerts.materialRepeatDays));
});

// ── data gaps ───────────────────────────────────────────────────────────────

test("summariseDataGaps: each gap a count + first five with links; unreadable lists left out; no money", () => {
  const g = summariseDataGaps({
    today: TODAY,
    origin: O,
    setupIncomplete: { data: [{ id: "p1", code: "BF-1", missing: ["bom", "price"] }, { id: "p2", code: "BF-2", missing: ["volume"] }] },
    costSummary: { data: { "BF-1": { materialLines: 1, fabricLines: 1, otherLines: 0, missingLines: 0, totalSen: 5000 }, "BF-3": { materialLines: 4, fabricLines: 1, otherLines: 3, missingLines: 2, totalSen: 9000 }, "BF-4": { materialLines: 3, otherLines: 2, missingLines: 0, totalSen: 0 } } },
    salesOrders: { data: [
      { id: "s1", companySOId: "SO-1", customerName: "A", status: "CONFIRMED", hookkaExpectedDD: "" },
      { id: "s2", companySOId: "SO-2", customerName: "B", status: "CONFIRMED", hookkaExpectedDD: "2026-12-01" },
      { id: "s3", companySOId: "SO-3", customerName: "C", status: "DELIVERED", hookkaExpectedDD: null },
    ] },
    workers: { data: [{ id: "w1", empNo: "E1", name: "Ali", departmentId: "", departmentCode: "", status: "ACTIVE" }, { id: "w2", empNo: "E2", name: "Bo", departmentCode: "FAB", status: "ACTIVE" }, { id: "w3", empNo: "E3", name: "Cy", status: "RESIGNED" }] },
    suppliers: null,
    bindings: { data: [] },
  });
  assert.equal(g.gaps.productsWithoutBom.count, 1);
  assert.equal(g.gaps.productsWithoutBom.top[0].link, `${O}/products/p1/bom`);
  assert.equal(g.gaps.productsWithoutPrice.count, 1);
  assert.deepEqual(g.gaps.bomsMissingNonFabricMaterials.top.map((x) => x.label), ["BF-1 — BOM has only the fabric line"]);
  assert.deepEqual(g.gaps.productsWithoutCost.top.map((x) => x.label.split(" ")[0]), ["BF-3", "BF-4"]);
  assert.equal(g.gaps.salesOrdersWithoutDeliveryDate.count, 1);
  assert.equal(g.gaps.salesOrdersWithoutDeliveryDate.top[0].link, `${O}/sales/s1`);
  assert.equal(g.gaps.workersWithoutDepartment.count, 1);
  assert.ok(!("suppliersWithoutBinding" in g.gaps), "suppliers unreadable → left out");
  assert.equal(g.totalGaps, 1 + 1 + 1 + 2 + 1 + 1);
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
  };
  walk(g);
  assert.ok(![...keys].some((k) => !k.startsWith("productsWithout") && /(Sen|Rm|Price|Cost|amount|value|total)$/.test(k)), [...keys].join(","));
});

test("summariseDataGaps: suppliers with no binding; top capped at 5 with the full count", () => {
  const suppliers = { data: Array.from({ length: 8 }, (_, i) => ({ id: `sp${i}`, code: `S${i}`, name: `Sup ${i}`, status: i === 7 ? "INACTIVE" : "ACTIVE" })) };
  const g = summariseDataGaps({ today: TODAY, origin: O, setupIncomplete: null, costSummary: null, salesOrders: null, workers: null, suppliers, bindings: { data: [{ supplierId: "sp0" }] } });
  assert.equal(g.gaps.suppliersWithoutBinding.count, 6);
  assert.equal(g.gaps.suppliersWithoutBinding.top.length, 5);
  assert.equal(g.gaps.suppliersWithoutBinding.top[0].link, `${O}/suppliers/sp1`);
});

// ── the HTML builder ────────────────────────────────────────────────────────

const brief = {
  date: TODAY,
  itemsNeedingAttention: 9,
  sections: {
    salesOrdersOverdue: { count: 7, top: [1, 2, 3, 4, 5].map((i) => ({ so: `SO-${i}`, customer: `Cust <${i}>`, daysLate: i, link: `${O}/sales/s${i}` })) },
    mailWaitingForYou: { count: 2, countedFrom: "the 100 most recent open threads", top: [{ subject: "Quote?", from: "x@y", link: `${O}/mail-center/t1` }, { subject: "Evil", from: "z", link: "javascript:alert(1)" }] },
  },
  noAccess: ["You don't have access to purchase orders."],
};

test("buildBriefEmail: sections with counts, top 5 linked, 'and N more', escaped, unsubscribe + settings links", () => {
  const m = buildBriefEmail({ brief, name: "Lim Ah Kow", date: TODAY, settingsUrl: `${O}/settings/ai-connector`, unsubscribeUrl: `${O}/api/mcp-proactive/unsubscribe?t=abc` });
  assert.match(m.subject, /^Your Hookka morning brief — 9 items · 2026-11-27$/);
  assert.equal(m.items, 9);
  assert.match(m.html, /Good morning, Lim\./);
  assert.match(m.html, /Sales orders overdue/);
  assert.match(m.html, /href="https:\/\/erp\.example\/sales\/s1"/);
  assert.match(m.html, /…and 2 more\./);
  assert.match(m.html, /Cust &lt;1&gt;/, "names escaped");
  assert.ok(!m.html.includes("<1>"));
  assert.ok(!m.html.includes("javascript:"), "non-http links are never rendered");
  assert.match(m.html, /Counted from the 100 most recent open threads\./);
  assert.match(m.html, /You don&#39;t have access to purchase orders\./);
  assert.match(m.html, /href="https:\/\/erp\.example\/api\/mcp-proactive\/unsubscribe\?t=abc"[^>]*>Unsubscribe<\/a>/);
  assert.match(m.html, /settings\/ai-connector/);
  assert.ok(!/Monday: data gaps/.test(m.html), "no gaps section unless given");
  assert.match(m.text, /Sales orders overdue: 7/);
  assert.match(m.text, /Unsubscribe: https:\/\/erp\.example/);
});

test("buildBriefEmail: Monday adds the data-gaps section; [Test] marks a test; empty brief says so", () => {
  const gaps = summariseDataGaps({ today: TODAY, origin: O, setupIncomplete: null, costSummary: null, salesOrders: null, workers: { data: [{ id: "w1", empNo: "E1", name: "Ali", status: "ACTIVE" }] }, suppliers: null, bindings: null });
  const m = buildBriefEmail({ brief, gaps, name: "", date: TODAY, settingsUrl: `${O}/s`, unsubscribeUrl: `${O}/u`, test: true });
  assert.match(m.subject, /^\[Test\] /);
  assert.match(m.html, /Monday: data gaps to fill/);
  assert.match(m.html, /Workers without a department/);
  assert.match(m.html, /Good morning, there\./);
  const e = buildBriefEmail({ brief: { sections: {}, itemsNeedingAttention: 0 }, name: "A", date: TODAY, settingsUrl: "", unsubscribeUrl: "" });
  assert.match(e.subject, /0 items/);
  assert.match(e.html, /nothing needs a look today/);
  assert.match(e.html, /your ERP permissions do not cover any of its lists/);
});

test("buildAlertEmail: grouped by kind, capped lines with 'and N more', escaped", () => {
  const alerts = Array.from({ length: 12 }, (_, i) => ({ key: `prod:${i}`, kind: "prod", title: `Production order P-${i} is late`, detail: "<b>x</b>", link: `${O}/production/${i}` }));
  const m = buildAlertEmail({ alerts, name: "A", date: TODAY, settingsUrl: `${O}/s`, unsubscribeUrl: `${O}/u` });
  assert.equal(m.subject, "Hookka alert: 12 new items need attention");
  assert.match(m.html, /Production orders newly late/);
  assert.equal((m.html.match(/<li /g) || []).length, PROACTIVE_CONFIG.alerts.maxLinesPerEmail);
  assert.match(m.html, /…and 2 more\./);
  assert.ok(!m.html.includes("<b>x</b>"));
  assert.match(m.html, />Unsubscribe</);
  assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

test("thresholds: one config, shown read-only in words (RM, not sen)", () => {
  const t = thresholdsForDisplay();
  assert.ok(t.some((r) => /RM 5,000\.00/.test(r.value)));
  assert.ok(Number.isInteger(PROACTIVE_CONFIG.alerts.poOverdueMinSen) && Number.isInteger(PROACTIVE_CONFIG.alerts.soOverdueMinSen), "money thresholds are integer sen");
});

// ── wiring: as the person, bounded, logged without body ─────────────────────

test("data_gaps is a registered, gated, cached, leak-checked read tool", () => {
  assert.ok(TOOL_NEEDS.data_gaps?.any?.length >= 5);
  assert.ok(STRUCTURED_TOOLS.has("data_gaps") && TOOL_PAGES.data_gaps);
  assert.ok(CACHEABLE_TOOLS.has("data_gaps"));
  assert.ok(LEAK_CHECK_TOOLS.some((t) => t.name === "data_gaps" && t.moneyExpected === false));
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /name: "data_gaps"/);
  assert.match(mcp, /if \(name === "data_gaps"\)/);
  // every data_gaps read goes through readValue (gate + redaction)
  const block = mcp.slice(mcp.indexOf('if (name === "data_gaps")'), mcp.indexOf("// ── round 4 (owner 2026-11-26)"));
  assert.equal((block.match(/readValue\(c, token, "/g) || []).length, 6);
  assert.ok(!/innerGet\(|appRef/.test(block));
});

test("route: brief = daily_brief via runToolAs with the person's own token; alerts via readManyAsPerson; token revoked", () => {
  const r = read("src/api/routes/mcp-proactive.ts");
  assert.match(r, /runToolAs\(c, id, token, "daily_brief", \{\}\)/);
  assert.match(r, /runToolAs\(c, id, token, "data_gaps", \{\}\)/);
  assert.match(r, /readManyAsPerson\(c, id, token, \[/);
  assert.match(r, /issueTokens\(db\(c\), p\.userId, PROACTIVE_CLIENT_ID\)/);
  assert.match(r, /finally \{\s*await revokeToken\(db\(c\), tok\.tokenId\)/);
  assert.match(r, /enqueueEmail\(c, \{ to: s\.email/, "the ERP's existing outbox sender");
  assert.ok(!/fetch\(\s*["'`]https?:/.test(r), "no direct mail-provider call");
  // logged without the body
  const logs = r.match(/logSend\([^;]+;/g) || [];
  assert.ok(logs.length >= 4);
  for (const l of logs) assert.ok(!/html|text:/.test(l), l);
  // claim before send: brief key + alert keys
  assert.match(r, /claimKeys\(db\(c\), s\.userId, \["brief"\], now\.day\)/);
  assert.match(r, /claimKeys\(db\(c\), s\.userId, fresh\.map/);
  assert.equal(PROACTIVE_CLIENT_ID, "mcpc_morning_brief");
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /export async function readManyAsPerson[\s\S]{0,400}asPerson\(c, id, token[\s\S]{0,200}readValue\(c, token, r\.path, r\.query\)/);
});

test("store: tables self-apply snake_case; brief claim is per person per day; the log has no body column", () => {
  const s = read("src/api/lib/mcp-proactive-store.ts");
  for (const t of ["mcp_brief_subscriptions", "mcp_proactive_keys", "mcp_proactive_sends"]) assert.match(s, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`));
  assert.match(s, /PRIMARY KEY \(user_id, alert_key, day\)/);
  assert.match(s, /ON CONFLICT \(user_id, alert_key, day\) DO NOTHING RETURNING alert_key/);
  const sends = s.slice(s.indexOf("CREATE TABLE IF NOT EXISTS mcp_proactive_sends"), s.indexOf("mcp_proactive_sends_user_idx"));
  assert.ok(!/body|html|subject/.test(sends), "the send log never stores the email");
  // only approved (or Super Admin), active accounts with an email
  assert.match(s, /a\.user_id IS NOT NULL OR UPPER\(u\.role\) = 'SUPER_ADMIN'/);
  assert.match(s, /u\.isActive = 1/);
});

test("heartbeat fires the tick every beat on its own invocation; tick is CRON_SECRET-gated", () => {
  const hb = read("src/api/routes/agent-heartbeat.ts");
  assert.match(hb, /\/api\/internal\/mcp-proactive\/tick/);
  const r = read("src/api/routes/mcp-proactive.ts");
  assert.match(r, /internal\.post\("\/tick"[\s\S]{0,300}constantTimeEqual\(c\.req\.header\("x-cron-secret"\)/);
  const w = read("src/api/worker.ts");
  const auth = w.indexOf('app.use("/api/*", authMiddleware)');
  assert.ok(w.indexOf('app.route("/api/internal/mcp-proactive"') > 0 && w.indexOf('app.route("/api/internal/mcp-proactive"') < auth, "tick mounted before the session gate (own auth)");
  assert.ok(w.indexOf('app.route("/api/mcp-admin/proactive"') > auth, "settings behind the session gate");
});

test("unsubscribe: GET only shows a button (link scanners), POST with the token does it", () => {
  const r = read("src/api/routes/mcp-proactive.ts");
  const get = r.slice(r.indexOf('publicRoutes.get("/unsubscribe"'), r.indexOf('publicRoutes.post("/unsubscribe"'));
  assert.ok(!/unsubscribeWithToken/.test(get), "GET never unsubscribes");
  assert.match(get, /<form method="post"/);
  assert.match(r, /publicRoutes\.post\("\/unsubscribe"[\s\S]{0,400}unsubscribeWithToken\(db\(c\), t\)/);
});

test("settings page: hooks in their own file; component mounted on the AI Connector page", () => {
  const page = read("src/pages/settings/AiConnector.tsx");
  assert.match(page, /<AiBriefSettings \/>/);
  const comp = read("src/pages/settings/AiBriefSettings.tsx");
  assert.ok(!/export function use[A-Z]/.test(comp), "no hook exported from the component file");
  assert.match(read("src/pages/settings/useAiBriefSettings.ts"), /export function useAiBriefSettings/);
});
