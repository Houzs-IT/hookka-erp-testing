// ---------------------------------------------------------------------------
// mcp-4bc.test.mjs — AI Connector round 4b (write actions: Mail Center reply,
// notes on PO / service case, PO approval) and round 4c (role-aware tools/list,
// role prompts, structured output, links + RM, cache). docs/plans/mcp-connector.md §3e.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const actions = await import("../src/api/lib/mcp-actions.ts");
const inner = await import("../src/api/lib/mcp-inner.ts");
const wa = await import("../src/api/lib/mcp-write-actions.ts");
const vis = await import("../src/api/lib/mcp-visibility.ts");
const quick = await import("../src/api/lib/mcp-quick.ts");
const limits = await import("../src/api/lib/mcp-limits.ts");

// ── in-memory mcp_pending_actions + kv_config ───────────────────────────────
function fakeDb() {
  const rows = new Map();
  const kv = new Map();
  const db = {
    rows,
    kv,
    prepare(sql) {
      const q = sql.replace(/\s+/g, " ").trim();
      let args = [];
      const stmt = {
        bind(...a) {
          args = a;
          return stmt;
        },
        async run() {
          if (q.startsWith("CREATE")) return {};
          if (q.startsWith("UPDATE mcp_pending_actions SET payload_json = '{}' WHERE used_at IS NULL AND expires_at <=")) return {};
          if (q.startsWith("INSERT INTO mcp_pending_actions")) {
            const [id, token_id, user_id, kind, payload_json, summary, created_at, expires_at] = args;
            rows.set(id, { id, token_id, user_id, kind, payload_json, summary, created_at, expires_at, used_at: null, cancelled_at: null });
            return {};
          }
          if (q.startsWith("UPDATE mcp_pending_actions SET result_status")) {
            const r = rows.get(args[2]);
            if (r) Object.assign(r, { result_status: args[0], result_note: args[1], payload_json: "{}" });
            return {};
          }
          if (q.startsWith("INSERT INTO kv_config")) {
            kv.set(args[0], args[1]);
            return {};
          }
          throw new Error(`unexpected run: ${q}`);
        },
        async first() {
          if (q.startsWith("SELECT kind FROM mcp_pending_actions")) {
            const [id, tok, user, now] = args;
            const r = rows.get(id);
            return r && r.token_id === tok && r.user_id === user && !r.used_at && !r.cancelled_at && r.expires_at > now ? { kind: r.kind } : null;
          }
          if (q.startsWith("UPDATE mcp_pending_actions SET used_at")) {
            const [now, id, tok, user, now2] = args;
            const r = rows.get(id);
            if (!r || r.token_id !== tok || r.user_id !== user || r.used_at || r.cancelled_at || !(r.expires_at > now2)) return null;
            r.used_at = now;
            return { kind: r.kind, payloadJson: r.payload_json, summary: r.summary };
          }
          if (q.startsWith("SELECT COUNT(*) AS n FROM mcp_pending_actions")) {
            const [user, since] = args;
            return { n: [...rows.values()].filter((r) => r.user_id === user && r.used_at && r.used_at >= since).length };
          }
          if (q.startsWith("SELECT value FROM kv_config")) return kv.has(args[0]) ? { value: kv.get(args[0]) } : null;
          throw new Error(`unexpected first: ${q}`);
        },
      };
      return stmt;
    },
  };
  return db;
}

const PO = { id: "po-1", poNo: "PO-2611-001", status: "SUBMITTED", supplierName: "Acme Foam", notes: "first line", updatedAt: "2026-11-27T01:00:00.000Z", totalSen: 123456, expectedDate: "2026-12-01", items: [{}, {}] };
const CASE = { id: "sc-1", caseNo: "SC-2611-009", status: "OPEN", customerName: "Ikea", actionLog: [{ id: "act-a", date: "2026-11-20", description: "Called customer" }] };
const THREAD = {
  thread: { id: "th-1", subject: "Delivery date?", mailboxAddress: "sales@hookka.com", status: "open" },
  messages: [
    { id: "m1", direction: "inbound", fromAddress: "buyer@client.com", fromName: "Buyer", toAddresses: ["sales@hookka.com"], ccAddresses: [], messageId: "<a@x>", createdAt: "2026-11-26T01:00:00Z", textBody: "When will it arrive?" },
  ],
};

/** The ERP, faked: reads as the person + writes that apply the PUT, with the route's own permission gate. */
function fakeErp({ perms = ["*"], po = { ...PO }, kase = structuredClone(CASE) } = {}) {
  const writes = [];
  const audits = [];
  const has = (r, a) => perms.includes("*") || perms.includes(`${r}:${a}`);
  const deps = (db) => ({
    db,
    tokenId: "t1",
    userId: "u1",
    userName: "Lim Wei",
    now: () => Date.parse("2026-11-27T02:00:00Z"),
    can: async (r, a) => has(r, a),
    read: async (path) => {
      if (path === "/api/purchase-orders/po-1") return { status: 200, body: { success: true, data: po } };
      if (path === "/api/service-cases/sc-1") return { status: 200, body: { success: true, data: kase } };
      if (path === "/api/mail-center/threads/th-1") return { status: 200, body: THREAD };
      if (path === "/api/mail-center/addresses") return { status: 200, body: [{ address: "sales@hookka.com", active: true, assignedUserId: "u1" }] };
      if (path === "/api/search") return { status: 200, body: { data: { groups: [{ kind: "purchase_order", items: [{ id: "po-1", label: "PO-2611-001" }] }, { kind: "service_case", items: [{ id: "sc-1", label: "SC-2611-009" }] }] } } };
      return { status: 404, body: { error: "not found" } };
    },
    write: async (actionId, req) => {
      writes.push({ actionId, ...req });
      // The route's own permission check, exactly like requirePermission.
      const need = req.path.startsWith("/api/mail-center") ? [["mail-center", "create"]] : req.path.startsWith("/api/service-cases") ? [["service-cases", "update"]] : req.body.status === "CONFIRMED" ? [["purchase-orders", "update"], ["purchase-orders", "approve"]] : [["purchase-orders", "update"]];
      for (const [r, a] of need) if (!has(r, a)) return { status: 403, body: { success: false, error: "Forbidden", missingPermission: `${r}:${a}` } };
      if (req.path === "/api/purchase-orders/po-1") {
        Object.assign(po, req.body.notes !== undefined ? { notes: req.body.notes } : {}, req.body.status ? { status: req.body.status } : {});
        return { status: 200, body: { success: true, data: po } };
      }
      if (req.path === "/api/service-cases/sc-1") {
        kase.actionLog = req.body.actionLog;
        return { status: 200, body: { success: true, data: kase } };
      }
      return { status: 200, body: { ok: true, messageId: "m2" } };
    },
    audit: async (kind, ref, after) => {
      audits.push({ kind, ref, after });
    },
  });
  return { deps, writes, audits, po, kase };
}

async function switchesOn(db, ...which) {
  await actions.setActionsEnabled(db, true, "owner");
  for (const w of which) await actions.setWriteActionSwitch(db, w, true, "owner");
}

test("4b: a proposal never writes; a confirm writes exactly once", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  await switchesOn(db, "note");
  const erp = fakeErp();
  const d = erp.deps(db);
  const p = await wa.proposeWrite(d, "po_note", { number_or_id: "PO-2611-001", note: "Supplier promised Friday" });
  assert.equal(p.ok, true, p.text);
  assert.match(p.summary, /PO-2611-001/);
  assert.match(p.summary, /Supplier promised Friday/);
  assert.equal(erp.writes.length, 0, "a proposal never writes");
  const c1 = await wa.confirmPending(d, p.confirmationId);
  assert.equal(c1.ok, true, c1.text);
  assert.equal(erp.writes.length, 1);
  assert.equal(erp.writes[0].method, "PUT");
  assert.equal(erp.writes[0].path, "/api/purchase-orders/po-1");
  assert.deepEqual(Object.keys(erp.writes[0].body).sort(), ["expectedUpdatedAt", "notes"]);
  assert.equal(erp.po.notes, "first line\n[Note 2026-11-27 Lim Wei (via AI Connector): Supplier promised Friday]");
  // the same id again: refused, still one write
  const c2 = await wa.confirmPending(d, p.confirmationId);
  assert.equal(c2.ok, false);
  assert.equal(c2.status, 404);
  assert.equal(erp.writes.length, 1);
});

test("4b: service-case note appends to Action taken (fresh read) and writes the ERP audit trail", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  await switchesOn(db, "note");
  const erp = fakeErp();
  const d = erp.deps(db);
  const p = await wa.proposeWrite(d, "case_note", { number_or_id: "SC-2611-009", note: "Replacement leg sent" });
  assert.equal(p.ok, true, p.text);
  // someone else adds an entry between proposal and confirm — it must survive
  erp.kase.actionLog.push({ id: "act-b", date: "2026-11-27", description: "Colleague entry" });
  const c = await wa.confirmPending(d, p.confirmationId);
  assert.equal(c.ok, true, c.text);
  assert.equal(erp.kase.actionLog.length, 3);
  assert.equal(erp.kase.actionLog[1].description, "Colleague entry");
  assert.match(erp.kase.actionLog[2].description, /^Replacement leg sent \(via AI Connector\)$/);
  assert.equal(erp.kase.actionLog[2].createdByName, "Lim Wei");
  assert.equal(erp.audits.length, 1);
  assert.equal(erp.audits[0].ref, "sc-1");
});

test("4b: a switched-off action is refused (propose and confirm), without using the confirmation up", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  const erp = fakeErp();
  const d = erp.deps(db);
  // main switch off
  let p = await wa.proposeWrite(d, "po_note", { number_or_id: "po-1", note: "x" });
  assert.equal(p.ok, false);
  assert.equal(p.text, actions.ACTIONS_OFF_MESSAGE);
  // main on, the action's own switch off (the default)
  await actions.setActionsEnabled(db, true, "owner");
  p = await wa.proposeWrite(d, "po_approval", { number_or_id: "po-1" });
  assert.equal(p.ok, false);
  assert.equal(p.status, 403);
  assert.match(p.text, /"Approve purchase orders" is switched off/);
  // proposed while on, switched off before the yes: refused, nothing written, still pending
  await actions.setWriteActionSwitch(db, "po_approval", true, "owner");
  p = await wa.proposeWrite(d, "po_approval", { number_or_id: "po-1" });
  assert.equal(p.ok, true, p.text);
  await actions.setWriteActionSwitch(db, "po_approval", false, "owner");
  const c = await wa.confirmPending(d, p.confirmationId);
  assert.equal(c.ok, false);
  assert.equal(c.status, 403);
  assert.equal(erp.writes.length, 0);
  assert.equal(db.rows.get(p.confirmationId).used_at, null);
  assert.equal(await actions.writeActionSwitch(db, "mail_reply"), false, "default off");
});

test("4b: a person without the ERP permission gets the ERP's own refusal", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  await switchesOn(db, "po_approval", "note");
  // propose: the same hasPermission check the route uses
  let erp = fakeErp({ perms: ["purchase-orders:read", "purchase-orders:update"] });
  let p = await wa.proposeWrite(erp.deps(db), "po_approval", { number_or_id: "po-1" });
  assert.equal(p.ok, false);
  assert.match(p.text, /purchase-orders:approve/);
  // permission removed after the proposal: the route itself refuses, its message passed through
  const perms = ["purchase-orders:read", "purchase-orders:update", "purchase-orders:approve"];
  erp = fakeErp({ perms });
  p = await wa.proposeWrite(erp.deps(db), "po_approval", { number_or_id: "po-1" });
  assert.equal(p.ok, true, p.text);
  perms.splice(perms.indexOf("purchase-orders:approve"), 1);
  const c = await wa.confirmPending(erp.deps(db), p.confirmationId);
  assert.equal(c.ok, false);
  assert.equal(c.status, 403);
  assert.match(c.text, /Not approved — the ERP refused it — you don't have the purchase-orders:approve permission/);
  assert.equal(erp.writes.length, 1, "the ERP decided");
  assert.equal(erp.po.status, "SUBMITTED");
});

test("4b: PO approval only for a SUBMITTED PO, body is status CONFIRMED + the stamp the person saw", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  await switchesOn(db, "po_approval");
  const erp = fakeErp({ po: { ...PO, status: "DRAFT" } });
  const bad = await wa.proposeWrite(erp.deps(db), "po_approval", { number_or_id: "po-1" });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /Only a sent \(SUBMITTED\) PO can be approved/);
  const ok = fakeErp();
  const p = await wa.proposeWrite(ok.deps(db), "po_approval", { number_or_id: "PO-2611-001" });
  assert.match(p.summary, /RM 1,234\.56/);
  const c = await wa.confirmPending(ok.deps(db), p.confirmationId);
  assert.equal(c.ok, true, c.text);
  assert.deepEqual(ok.writes[0].body, { status: "CONFIRMED", expectedUpdatedAt: PO.updatedAt });
  assert.equal(ok.po.status, "CONFIRMED");
});

test("4b: Mail Center reply shows draft, recipients and thread; carries the reply guard; never force", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  await switchesOn(db, "mail_reply");
  const erp = fakeErp();
  const p = await wa.proposeWrite(erp.deps(db), "mail_reply", { thread_id: "th-1", body: "It ships on Friday." });
  assert.equal(p.ok, true, p.text);
  assert.match(p.summary, /Delivery date\?/);
  assert.match(p.summary, /To: buyer@client\.com/);
  assert.match(p.summary, /It ships on Friday\./);
  assert.match(p.summary, /reply guard/);
  assert.doesNotMatch(p.target, /Friday/, "the log line never carries the body");
  const c = await wa.confirmPending(erp.deps(db), p.confirmationId);
  assert.equal(c.ok, true, c.text);
  assert.equal(erp.writes[0].path, "/api/mail-center/threads/th-1/reply");
  assert.deepEqual(erp.writes[0].body, { text: "It ships on Friday.", afterMessageId: "m1" });
  // a colleague replied first: the route's 409 in plain words
  assert.match(wa.describeWriteOutcome("mail_reply", 409, { code: "already_replied", by: "Mei", at: "2026-11-27T02:01:00Z" }).text, /Mei already replied/);
  // someone else's mailbox
  const other = await wa.proposeWrite(erp.deps(db), "mail_reply", { thread_id: "th-1", body: "x", from_mailbox: "boss@hookka.com" });
  assert.equal(other.ok, false);
});

test("4b: the write fence — patterned allowlist, body keys per kind, nothing else", () => {
  assert.deepEqual(
    inner.ACTION_ALLOWLIST.map((a) => `${a.kind} ${a.method} ${a.path}`),
    [
      "meeting POST /api/meetings/meetings",
      "email POST /api/mail-center/compose",
      "mail_reply POST /api/mail-center/threads/:ref/reply",
      "po_note PUT /api/purchase-orders/:ref",
      "case_note PUT /api/service-cases/:ref",
      "po_approval PUT /api/purchase-orders/:ref",
    ],
  );
  assert.ok(inner.isAllowlisted("PUT", "/api/purchase-orders/po-1"));
  assert.ok(!inner.isAllowlisted("DELETE", "/api/purchase-orders/po-1"));
  assert.ok(!inner.isAllowlisted("PUT", "/api/purchase-orders/po-1/supplier-date"));
  assert.ok(!inner.isAllowlisted("PUT", "/api/sales-orders/so-1"));
  assert.ok(!inner.isAllowlisted("POST", "/api/stock-adjustments"));
  assert.ok(!inner.isAllowlisted("PUT", "/api/purchase-orders/../payments"));
  assert.equal(inner.allowlistedAction("po_note", "a/b"), null);
  // a PO note may carry notes only — never items, prices, supplier or status
  assert.ok(inner.actionBodyAllowed("po_note", { notes: "x", expectedUpdatedAt: "t" }));
  assert.ok(!inner.actionBodyAllowed("po_note", { notes: "x", items: [] }));
  assert.ok(!inner.actionBodyAllowed("po_note", { notes: "x", status: "CANCELLED" }));
  assert.ok(!inner.actionBodyAllowed("po_note", { notes: "x", totalSen: 1 }));
  assert.ok(inner.actionBodyAllowed("po_approval", { status: "CONFIRMED" }));
  assert.ok(!inner.actionBodyAllowed("po_approval", { status: "CANCELLED" }));
  assert.ok(!inner.actionBodyAllowed("po_approval", { status: "CONFIRMED", notes: "x" }));
  assert.ok(!inner.actionBodyAllowed("case_note", { actionLog: [], status: "CLOSED" }));
  assert.ok(!inner.actionBodyAllowed("mail_reply", { text: "hi", force: true }));
  assert.ok(!inner.actionBodyAllowed("payment", { amount: 1 }));
  // arming a PUT to a path outside the list does nothing
  inner.armConfirmedAction("mcpa_p", "t1", "PUT", "/api/sales-orders/so-1", 1000);
  assert.equal(inner.takeConfirmedAction("mcpa_p", "t1", "PUT", "/api/sales-orders/so-1", 1001), false);
  inner.armConfirmedAction("mcpa_q", "t1", "PUT", "/api/service-cases/sc-1", 1000);
  assert.equal(inner.takeConfirmedAction("mcpa_q", "t1", "PUT", "/api/service-cases/sc-1", 1001), true);
});

test("4c P1: tools hidden by the same module gate; write tools by switch + permission", async () => {
  // accounting only → payables visible; no accounting → company_report / payables hidden
  const can = (set) => async (r) => set.includes(r);
  assert.equal(await vis.readToolAllowed("payables_summary", can(["accounting"])), true);
  assert.equal(await vis.readToolAllowed("payables_summary", can(["sales-orders"])), false);
  assert.equal(await vis.readToolAllowed("company_report", can(["sales-orders", "purchase-orders"])), false);
  // product_cost needs products AND costing (product-costing or cost-ledger — the module gate of /api/product-costing)
  assert.equal(await vis.readToolAllowed("product_cost", can(["products"])), false);
  assert.equal(await vis.readToolAllowed("product_cost", can(["products", "cost-ledger"])), true);
  assert.equal(await vis.readToolAllowed("product_cost", can(["products", "product-costing"])), true);
  assert.equal(await vis.readToolAllowed("product_cost", can(["products", "product-pricing"])), false);
  // stock_check: any of its sources
  assert.equal(await vis.readToolAllowed("stock_check", can(["products"])), true);
  assert.equal(await vis.readToolAllowed("stock_check", can([])), false);
  // tools without an entry (search, whoami, …) always listed
  assert.equal(await vis.readToolAllowed("search", can([])), true);
  // every round-4 quick answer has a gate entry
  for (const t of ["po_overdue", "supplier_lateness", "uninvoiced_deliveries", "production_output", "worker_efficiency", "raw_material_summary", "gross_profit", "production_lead_time"]) assert.ok(vis.TOOL_NEEDS[t], t);
  // wiring: tools/list filters, a hidden tool answers no access, write tools need switch + permission
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /case "tools\/list":\n\s+\/\/ Round 4c P1: only the tools this person can use\.\n\s+return reply\(\{ tools: await visibleTools\(c\) \}\);/);
  assert.match(mcp, /!\(await \(await toolAccess\(c\)\)\(name\)\)\) \{\n\s+result = text\(`You don't have access to this in the ERP/);
  assert.match(mcp, /if \(!main \|\| !switches\[w\.switch\]\) return false;/);
});

test("4c P2: role prompts exist, expand, and each names tools that exist", () => {
  const names = quick.PROMPTS.map((p) => p.name);
  for (const n of ["owner_morning_report", "finance_review", "purchasing_review", "production_review", "warehouse_review", "sales_review"]) {
    assert.ok(names.includes(n), n);
    const t = quick.promptText(n, {});
    assert.ok(t && t.length > 40, n);
    for (const tool of quick.PROMPT_TOOLS[n]) assert.match(t, new RegExp(tool), `${n} mentions ${tool}`);
  }
  for (const p of quick.PROMPTS) assert.ok(quick.PROMPT_TOOLS[p.name], `PROMPT_TOOLS has ${p.name}`);
  assert.match(quick.promptText("finance_review", { month: "2026-10" }), /month: "2026-10"/);
});

test("4c P3 + P5: structured output parsed from the text, links and RM", () => {
  const q = vis.parseQuickText('Fields hidden for this person: costSen.\n{"count":2,"rows":[{"poId":"po-1","valueSen":12345},{"soId":"so-9","url":"https://x/sales/so-9","totalSen":null}]}');
  assert.deepEqual(q.hidden, ["costSen"]);
  const out = vis.withLinksAndRm("po_overdue", q.value, "https://erp");
  assert.equal(out.erpLink, "https://erp/procurement");
  assert.equal(out.rows[0].url, "https://erp/procurement/po-1");
  assert.equal(out.rows[0].valueRm, 123.45);
  assert.ok(!("valueSen" in out.rows[0]));
  assert.equal(out.rows[1].url, "https://x/sales/so-9", "an existing link is kept");
  assert.equal(out.rows[1].totalRm, null, "hidden money stays null, never 0");
  assert.equal(vis.parseQuickText("{not json"), null);
  assert.equal(vis.QUICK_OUTPUT_SCHEMA.type, "object");
  for (const t of vis.STRUCTURED_TOOLS) assert.ok(vis.TOOL_PAGES[t], `page for ${t}`);
  const mcp = read("src/api/routes/mcp.ts");
  assert.match(mcp, /STRUCTURED_TOOLS\.has\(t\.name\) \? \{ \.\.\.t, outputSchema: QUICK_OUTPUT_SCHEMA \}/);
  assert.match(mcp, /if \(STRUCTURED_TOOLS\.has\(name\) && !result\.isError\) result = structured\(name, result, originOf\(c\)\);/);
});

test("4c P4: ~60 s per-person cache keyed by person + args", () => {
  assert.equal(limits.ANSWER_CACHE_TTL_MS, 60_000);
  for (const t of ["payables_summary", "so_overdue", "deliveries_due", "production_late", "company_report"]) assert.ok(limits.CACHEABLE_TOOLS.has(t), t);
  for (const t of ["confirm_action", "propose_note", "propose_mail_reply", "propose_po_approval", "erp_get"]) assert.ok(!limits.CACHEABLE_TOOLS.has(t), t);
  assert.notEqual(limits.AnswerCache.key("u1", "R", "t", { a: 1 }), limits.AnswerCache.key("u1", "R", "t", { a: 2 }));
});

test("4b wiring: admin switches are Super Admin only; the brief gives thread ids", () => {
  const admin = read("src/api/routes/mcp-admin.ts");
  const at = admin.indexOf('app.post("/admin/write-actions"');
  assert.ok(at > 0);
  assert.match(admin.slice(at, at + 160), /const denied = requireSuperAdmin\(c\);/);
  const brief = quick.buildDailyBrief({ today: "2026-11-27", origin: "https://erp", userId: "u1", orders: null, poStats: null, mailThreads: { data: [{ id: "th-1", subject: "Hi", lastDirection: "inbound", unread: true }] }, serviceApprovals: null, pendingLeaves: null, noAccess: [] });
  assert.equal(brief.sections.mailWaitingForYou.top[0].threadId, "th-1");
});
