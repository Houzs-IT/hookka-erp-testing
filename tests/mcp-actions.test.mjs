// ---------------------------------------------------------------------------
// mcp-actions.test.mjs — AI Connector actions (book a meeting, send an email)
// with the person's confirmation, document_flow and the write fence
// (owner 2026-11-26 「先确认再做」; docs/plans/mcp-connector.md §3b).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const actions = await import("../src/api/lib/mcp-actions.ts");
const inner = await import("../src/api/lib/mcp-inner.ts");
const flow = await import("../src/api/lib/mcp-flow.ts");
const { authMiddleware } = await import("../src/api/lib/auth-middleware.ts");

// ── a tiny in-memory stand-in for the mcp_pending_actions SQL ───────────────
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
          if (q.startsWith("UPDATE mcp_pending_actions SET payload_json = '{}' WHERE used_at IS NULL AND expires_at <=")) {
            for (const r of rows.values()) if (!r.used_at && r.expires_at <= args[0]) r.payload_json = "{}";
            return {};
          }
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
          if (q.startsWith("UPDATE mcp_pending_actions SET used_at")) {
            const [now, id, tok, user, now2] = args;
            const r = rows.get(id);
            if (!r || r.token_id !== tok || r.user_id !== user || r.used_at || r.cancelled_at || !(r.expires_at > now2)) return null;
            r.used_at = now;
            // Postgres camelCases result columns (db-pg.ts) — the reader must dual-key.
            return { kind: r.kind, payloadJson: r.payload_json, summary: r.summary };
          }
          if (q.startsWith("UPDATE mcp_pending_actions SET cancelled_at")) {
            const [now, id, tok, user] = args;
            const r = rows.get(id);
            if (!r || r.token_id !== tok || r.user_id !== user || r.used_at || r.cancelled_at) return null;
            Object.assign(r, { cancelled_at: now, payload_json: "{}" });
            return { id };
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

test("pending action lifecycle: single use, same token and person, 10-minute expiry, body dropped after", async () => {
  actions._resetActionStoreForTests();
  const db = fakeDb();
  const t0 = Date.parse("2026-11-26T02:00:00Z");
  const a = await actions.createPendingAction(db, { tokenId: "t1", userId: "u1", kind: "email", payload: { to: ["a@x.com"], subject: "Hi", text: "secret body" }, summary: "s" }, t0);
  assert.match(a.id, /^mcpa_[a-f0-9]{24}$/);
  // another token / another person cannot use it
  assert.equal(await actions.consumePendingAction(db, a.id, "t2", "u1", t0 + 1000), null);
  assert.equal(await actions.consumePendingAction(db, a.id, "t1", "u2", t0 + 1000), null);
  const got = await actions.consumePendingAction(db, a.id, "t1", "u1", t0 + 1000);
  assert.equal(got.kind, "email");
  assert.equal(got.payload.text, "secret body");
  // single use
  assert.equal(await actions.consumePendingAction(db, a.id, "t1", "u1", t0 + 2000), null);
  await actions.finishPendingAction(db, a.id, 201, "Email sent.");
  assert.equal(db.rows.get(a.id).payload_json, "{}");
  assert.equal(await actions.confirmedSince(db, "u1", actions.myDayStartIso(t0)), 1);

  // expiry
  const b = await actions.createPendingAction(db, { tokenId: "t1", userId: "u1", kind: "meeting", payload: { title: "x" }, summary: "s" }, t0);
  assert.equal(await actions.consumePendingAction(db, b.id, "t1", "u1", t0 + actions.ACTION_TTL_MS + 1), null);
  // the next proposal blanks what expired unused
  await actions.createPendingAction(db, { tokenId: "t1", userId: "u1", kind: "meeting", payload: { title: "y" }, summary: "s" }, t0 + actions.ACTION_TTL_MS + 2);
  assert.equal(db.rows.get(b.id).payload_json, "{}");

  // cancel
  const c = await actions.createPendingAction(db, { tokenId: "t1", userId: "u1", kind: "meeting", payload: {}, summary: "s" }, t0);
  assert.equal(await actions.cancelPendingAction(db, c.id, "t2", "u1", t0), false);
  assert.equal(await actions.cancelPendingAction(db, c.id, "t1", "u1", t0), true);
  assert.equal(await actions.consumePendingAction(db, c.id, "t1", "u1", t0 + 1), null);
});

test("owner switch: off unless explicitly on", async () => {
  const db = fakeDb();
  assert.equal(await actions.actionsEnabled(db), false);
  await actions.setActionsEnabled(db, true, "owner");
  assert.equal(await actions.actionsEnabled(db), true);
  await actions.setActionsEnabled(db, false, "owner");
  assert.equal(await actions.actionsEnabled(db), false);
  db.kv.set(actions.ACTIONS_SWITCH_KEY, "not json");
  assert.equal(await actions.actionsEnabled(db), false);
});

test("write fence: only the two allowlisted routes, only once, only for the armed token / method / path", () => {
  assert.deepEqual(
    inner.ACTION_ALLOWLIST.map((a) => `${a.method} ${a.path}`),
    ["POST /api/meetings/meetings", "POST /api/mail-center/compose"],
  );
  const now = 1_000_000;
  // never armed
  assert.equal(inner.takeConfirmedAction("mcpa_x", "t1", "POST", "/api/mail-center/compose", now), false);
  // a path outside the allowlist cannot even be armed
  inner.armConfirmedAction("mcpa_bad", "t1", "POST", "/api/sales-orders", now);
  assert.equal(inner.takeConfirmedAction("mcpa_bad", "t1", "POST", "/api/sales-orders", now), false);
  inner.armConfirmedAction("mcpa_del", "t1", "DELETE", "/api/mail-center/compose", now);
  assert.equal(inner.takeConfirmedAction("mcpa_del", "t1", "DELETE", "/api/mail-center/compose", now), false);
  // armed for email: wrong token / wrong path refuse — and burn the arm
  inner.armConfirmedAction("mcpa_a", "t1", "POST", "/api/mail-center/compose", now);
  assert.equal(inner.takeConfirmedAction("mcpa_a", "t2", "POST", "/api/mail-center/compose", now), false);
  assert.equal(inner.takeConfirmedAction("mcpa_a", "t1", "POST", "/api/mail-center/compose", now), false);
  inner.armConfirmedAction("mcpa_b", "t1", "POST", "/api/mail-center/compose", now);
  assert.equal(inner.takeConfirmedAction("mcpa_b", "t1", "POST", "/api/meetings/meetings", now), false);
  // the right one: once
  inner.armConfirmedAction("mcpa_c", "t1", "POST", "/api/mail-center/compose", now);
  assert.equal(inner.takeConfirmedAction("mcpa_c", "t1", "POST", "/api/mail-center/compose", now + 1), true);
  assert.equal(inner.takeConfirmedAction("mcpa_c", "t1", "POST", "/api/mail-center/compose", now + 2), false);
  // stale arm
  inner.armConfirmedAction("mcpa_d", "t1", "POST", "/api/meetings/meetings", now);
  assert.equal(inner.takeConfirmedAction("mcpa_d", "t1", "POST", "/api/meetings/meetings", now + 31_000), false);
});

test("auth middleware: a plain MCP token POST is still refused; only the armed confirmed action gets through", async () => {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  let hits = 0;
  const ok = (c) => {
    hits++;
    return c.json({ ok: true, userId: c.get("userId") }, 201);
  };
  app.post("/api/mail-center/compose", ok);
  app.post("/api/meetings/meetings", ok);
  app.post("/api/sales-orders", ok);
  const token = "hkmcp_test_token_for_fence";
  inner.rememberVerified(token, { tokenId: "t9", userId: "u9", clientId: "c", role: "STAFF", orgId: null, name: "Test" });
  const secret = inner.mcpInnerSecret();
  const post = (path, headers) => app.request(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: "{}" }, {});

  // straight from outside: refused
  assert.equal((await post("/api/mail-center/compose", {})).status, 403);
  // from the tool runner but not a confirmed action: refused (read-only)
  const r1 = await post("/api/mail-center/compose", { [inner.MCP_INNER_HEADER]: secret });
  assert.equal(r1.status, 403);
  assert.match((await r1.json()).error, /read-only/);
  // naming an action that was never armed: refused
  assert.equal((await post("/api/mail-center/compose", { [inner.MCP_INNER_HEADER]: secret, [inner.MCP_ACTION_HEADER]: "mcpa_none" })).status, 403);
  // armed for email, aimed at sales orders: refused
  inner.armConfirmedAction("mcpa_e1", "t9", "POST", "/api/mail-center/compose");
  assert.equal((await post("/api/sales-orders", { [inner.MCP_INNER_HEADER]: secret, [inner.MCP_ACTION_HEADER]: "mcpa_e1" })).status, 403);
  // armed + right path: through, as the person; and only once
  inner.armConfirmedAction("mcpa_e2", "t9", "POST", "/api/mail-center/compose");
  const r2 = await post("/api/mail-center/compose", { [inner.MCP_INNER_HEADER]: secret, [inner.MCP_ACTION_HEADER]: "mcpa_e2" });
  assert.equal(r2.status, 201);
  assert.equal((await r2.json()).userId, "u9");
  assert.equal((await post("/api/mail-center/compose", { [inner.MCP_INNER_HEADER]: secret, [inner.MCP_ACTION_HEADER]: "mcpa_e2" })).status, 403);
  assert.equal(hits, 1);
});

const BOOT = {
  me: "hookka:u1",
  people: [
    { key: "hookka:u1", name: "Lim Wei", email: "lim@hookka.com" },
    { key: "hookka:u2", name: "Adrian Tan", email: "adrian@hookka.com" },
    { key: "hookka:u3", name: "Adrian Lee", email: "adrian.lee@hookka.com" },
    { key: "houzs:u7", name: "Mei Ling", email: "mei@houzs.com" },
  ],
  rooms: [
    { id: 1, name: "Board Room", seats: 12, active: true },
    { id: 2, name: "Small Room", seats: 2, active: true },
    { id: 3, name: "Old Room", seats: 8, active: false },
  ],
};
const NOW = Date.parse("2026-11-26T02:00:00Z"); // 10:00 Malaysia

test("propose_meeting: resolves people and room, Malaysia time, the hub's own body", () => {
  const p = actions.buildMeetingProposal(
    { title: "Supplier review", start: "2026-11-27T15:00", attendees: ["Adrian Tan", "mei@houzs.com", "guest@vendor.com", "Lim Wei"], room: "board" },
    actions.readBootstrap(BOOT),
    NOW,
  );
  assert.equal(p.ok, true);
  assert.equal(p.body.start, "2026-11-27T07:00:00.000Z");
  assert.equal(p.body.end, "2026-11-27T08:00:00.000Z");
  assert.equal(p.body.organizer, "hookka:u1");
  assert.deepEqual(p.body.attendees, ["hookka:u2", "houzs:u7"]);
  assert.deepEqual(p.body.guestEmails, ["guest@vendor.com"]);
  assert.equal(p.body.roomId, 1);
  assert.equal(p.body.repeat, "none");
  assert.match(p.summary, /Supplier review/);
  assert.match(p.summary, /Board Room/);
  assert.match(p.summary, /Adrian Tan, Mei Ling, guest@vendor\.com/);
  assert.equal(p.target, "meeting: Supplier review @ 2026-11-27T07:00");

  const bad = (args, re) => {
    const r = actions.buildMeetingProposal({ title: "x", start: "2026-11-27T15:00", ...args }, actions.readBootstrap(BOOT), NOW);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  };
  bad({ attendees: ["Adrian"] }, /matches 2 people/);
  bad({ attendees: ["Nobody Here"] }, /No colleague/);
  bad({ room: "Old Room" }, /No meeting room/);
  bad({ start: "tomorrow 3pm" }, /date and time/);
  bad({ start: "2026-11-25T15:00" }, /already passed/);
  bad({ end: "2026-11-27T14:00" }, /end after it starts/);
  bad({ title: "" }, /title/);
  const crowded = actions.buildMeetingProposal({ title: "x", start: "2026-11-27T15:00", attendees: ["Adrian Tan", "Mei Ling"], room: "Small Room" }, actions.readBootstrap(BOOT), NOW);
  assert.match(crowded.warnings[0], /seats 2, but 3 people/);

  const busy = actions.meetingBusyWarnings(
    p.body,
    { meetings: [{ title: "Weekly", start: "2026-11-27T07:30:00Z", end: "2026-11-27T08:30:00Z", roomId: 1, organizer: "hookka:u2", attendees: [] }, { title: "Later", start: "2026-11-27T09:00:00Z", end: "2026-11-27T10:00:00Z", roomId: 1, organizer: "hookka:u1", attendees: [] }] },
    BOOT.people,
  );
  assert.deepEqual(busy, ['The room is already booked for "Weekly" then.', 'Adrian Tan is in "Weekly" then.']);
});

test("propose_email: the compose route's recipient rules, the person's own mailbox, body never in the log line", () => {
  const boxes = actions.readMailboxes([
    { address: "Lim@hookka.com", active: true, assignedUserId: "u1" },
    { address: "sales@hookka.com", active: true, assignedUserId: "u5" },
    { address: "old@hookka.com", active: false, assignedUserId: "u1" },
  ]);
  const p = actions.buildEmailProposal({ to: ["Ali <ali@customer.com>"], cc: "boss@hookka.com", subject: "Delivery date", body: "Your order ships Friday.\nThanks" }, boxes, "u1");
  assert.equal(p.ok, true);
  assert.deepEqual(p.body, { fromAddress: "lim@hookka.com", to: ["ali@customer.com"], cc: ["boss@hookka.com"], subject: "Delivery date", text: "Your order ships Friday.\nThanks" });
  assert.match(p.summary, /Your order ships Friday/);
  assert.equal(p.target, "email: to ali@customer.com — Delivery date");
  assert.doesNotMatch(p.target, /Friday/);
  assert.equal(actions.actionTarget("email", p.body), p.target);

  const bad = (args, re, uid = "u1", b = boxes) => {
    const r = actions.buildEmailProposal({ to: ["a@x.com"], subject: "s", body: "b", ...args }, b, uid);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  };
  bad({ to: [] }, /at least one recipient/);
  bad({ to: ["not-an-email"] }, /Not a valid email/);
  bad({ to: ["a@x.com"], cc: ["a@x.com"] }, /both to and cc/);
  bad({ subject: "" }, /subject/);
  bad({ body: "" }, /message/);
  bad({ from_mailbox: "boss@hookka.com" }, /may not send from boss@hookka\.com/);
  bad({}, /Say which mailbox/, "u9");
  bad({}, /no Mail Center mailbox/, "u1", []);
  const shared = actions.buildEmailProposal({ to: ["a@x.com"], subject: "s", body: "b", from_mailbox: "sales@hookka.com" }, boxes, "u1");
  assert.equal(shared.ok && shared.body.fromAddress, "sales@hookka.com");
});

test("outcomes in plain words, including a booking clash", () => {
  assert.equal(actions.describeOutcome("email", 201, { ok: true }).ok, true);
  const no = actions.describeOutcome("email", 403, { error: "not allowed to send from x@hookka.com" });
  assert.equal(no.ok, false);
  assert.match(no.text, /not allowed to send from/);
  assert.match(actions.describeOutcome("meeting", 201, { ids: [42], created: 1 }).text, /meeting 42/);
  const clash = actions.describeOutcome("meeting", 409, { conflict: { room: { title: "Weekly" }, people: [], rules: [] }, suggestTime: null });
  assert.equal(clash.ok, false);
  assert.match(clash.text, /room is taken by "Weekly"/);
  assert.equal(actions.parseWhen("2026-11-27T15:00+08:00"), Date.parse("2026-11-27T07:00:00Z"));
  assert.equal(actions.parseWhen("2026-11-27 15:00"), Date.parse("2026-11-27T07:00:00Z"));
  assert.equal(actions.parseWhen("2026-11-27T07:00:00Z"), Date.parse("2026-11-27T07:00:00Z"));
  assert.equal(actions.parseWhen("27/11 3pm"), null);
});

test("document_flow: anchor pick, SO refs from any document, the chain in flow order (RM, links)", () => {
  const search = {
    data: {
      groups: [
        { kind: "customer", items: [{ id: "c1", label: "SO Furniture" }] },
        { kind: "invoice", items: [{ id: "inv-9", label: "INV-2611-088" }] },
        { kind: "sales_order", items: [{ id: "so-1", label: "SO-2611-376" }] },
      ],
    },
  };
  assert.deepEqual(flow.pickFlowAnchor(search, "INV-2611-088"), { kind: "invoice", id: "inv-9", label: "INV-2611-088" });
  assert.deepEqual(flow.pickFlowAnchor(search, "2611"), { kind: "sales_order", id: "so-1", label: "SO-2611-376" });
  assert.equal(flow.pickFlowAnchor({ data: { groups: [{ kind: "customer", items: [{ id: "c1" }] }] } }, "x"), null);
  assert.deepEqual(flow.parseAnchorId("delivery_order:do-7"), { kind: "delivery_order", id: "do-7" });
  assert.equal(flow.parseAnchorId("customer:c1"), null);

  assert.deepEqual(flow.soRefsFromDoc("sales_order", "so-1", null), { refs: ["so-1"], viaDo: null });
  assert.deepEqual(flow.soRefsFromDoc("production_order", "po-1", { data: { salesOrderId: "so-1" } }).refs, ["so-1"]);
  // consolidated DO: no salesOrderId, one SO per line
  assert.deepEqual(flow.soRefsFromDoc("delivery_order", "do-7", { data: { salesOrderId: "", items: [{ salesOrderNo: "SO-2611-376" }, { salesOrderNo: "SO-2611-380" }, { salesOrderNo: "SO-2611-376" }] } }).refs, ["SO-2611-376", "SO-2611-380"]);
  assert.deepEqual(flow.soRefsFromDoc("invoice", "inv-9", { data: { salesOrderId: "", companySOId: "", deliveryOrderId: "do-7" } }), { refs: [], viaDo: "do-7" });

  const detail = {
    success: true,
    data: { id: "so-1", companySOId: "SO-2611-376", customerName: "Acme", status: "IN_PRODUCTION", totalSen: 210000, companySODate: "2026-11-02T00:00:00Z" },
    linkedPOs: [{ id: "po-1", poNo: "SO-2611-376-01", productCode: "5530", quantity: 3, status: "IN_PROGRESS", currentDepartment: "SEWING", jobCards: [{ status: "COMPLETED" }, { status: "IN_PROGRESS" }], deliveryDoNo: "" }],
    linkedDOs: [{ id: "do-7", doNo: "DO-2611-102", status: "DELIVERED", deliveredAt: "2026-11-20T03:00:00Z" }],
    linkedInvoices: [{ id: "inv-9", invoiceNo: "INV-2611-088", status: "PARTIAL", totalSen: 210000, paidAmount: 100000, paymentDate: "2026-11-24" }],
    linkedPayments: [{ id: "pay-1", receiptNumber: "OR-0091", date: "2026-11-24", amount: 100000, status: "CLEARED" }],
  };
  const footprint = { data: { rows: [{ table: "job_cards (not yet finished)", count: 1 }] } };
  const f = flow.shapeFlow(detail, footprint, "https://erp.example");
  assert.equal(f.salesOrder, "SO-2611-376");
  assert.deepEqual(f.links.map((l) => l.type), ["sales-order", "production-order", "job-cards", "delivery-order", "invoice", "payment"]);
  assert.equal(f.links[0].amountRm, 2100);
  assert.equal(f.links[0].url, "https://erp.example/sales/so-1");
  assert.match(f.links[1].detail, /job cards 1\/2 done/);
  assert.equal(f.links[2].status, "1 still open");
  assert.equal(f.links[3].date, "2026-11-20");
  assert.equal(f.links[4].amountRm, 2100);
  assert.match(f.links[4].detail, /paid RM 1000\.00 on 2026-11-24/);
  assert.equal(f.links[5].url, "https://erp.example/invoices/payments?payments.q=OR-0091");
  // a money field the redactor removed stays null — never guessed
  const hidden = flow.shapeFlow({ data: { id: "so-1", companySOId: "SO-1" }, linkedInvoices: [{ id: "i", invoiceNo: "INV-1" }] }, null, "https://e");
  assert.equal(hidden.links[0].amountRm, null);
  assert.equal(hidden.links[1].amountRm, null);
});

test("wiring: proposals and confirmations are fenced, logged, and the tools say 'ask first'", () => {
  const mcp = read("src/api/routes/mcp.ts");
  // confirm_action: switch, daily cap, single-use claim, THEN the inner POST
  const ca = mcp.slice(mcp.indexOf("async function confirmAction("));
  const sw = ca.indexOf("if (!(await actionsEnabled(c.var.DB))) return fail(ACTIONS_OFF_MESSAGE, 403);");
  const cap = ca.indexOf(">= ACTIONS_PER_DAY");
  const claim = ca.indexOf("const act = await consumePendingAction(c.var.DB, cid, id.tokenId, id.userId);");
  const run = ca.indexOf("out = await innerAction(c, id, token, cid, act.kind, act.payload);");
  assert.ok(sw > 0 && cap > sw && claim > cap && run > claim);
  // the inner write is armed for exactly the allowlisted route, then sent with both inner headers
  const ia = mcp.slice(mcp.indexOf("async function innerAction("), mcp.indexOf("async function confirmAction("));
  assert.match(ia, /const route = allowlistedAction\(kind\);/);
  assert.match(ia, /armConfirmedAction\(actionId, id\.tokenId, route\.method, route\.path\);/);
  assert.match(ia, /\[MCP_INNER_HEADER\]: mcpInnerSecret\(\),\n\s+\[MCP_ACTION_HEADER\]: actionId,/);
  // propose_*: switch first
  const pa = mcp.slice(mcp.indexOf("async function proposeAction("));
  assert.ok(pa.indexOf("if (!(await actionsEnabled(c.var.DB))) return fail(ACTIONS_OFF_MESSAGE, 403);") < pa.indexOf("innerGet("));
  // tool descriptions tell the AI to ask first
  for (const t of ["propose_meeting", "propose_email"]) {
    const at = mcp.indexOf(`name: "${t}"`);
    assert.match(mcp.slice(at, at + 600), /Show this summary to the person and ask them to confirm\. Only call confirm_action after they explicitly say yes\./, t);
    assert.match(mcp.slice(at, mcp.indexOf("annotations:", at) + 120), /annotations: \{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true \}/, t);
  }
  // the admin switch is Super Admin only
  const admin = read("src/api/routes/mcp-admin.ts");
  const at = admin.indexOf('app.post("/admin/actions"');
  assert.ok(at > 0);
  assert.match(admin.slice(at, at + 160), /const denied = requireSuperAdmin\(c\);/);
});
