// ---------------------------------------------------------------------------
// order-notification.test.mjs — HK-0025: "Send Notification" on the Production
// Overview. An order notice is an announcement carrying priority + order no.
//   1. pure builder (src/lib/order-notification.ts): title/body, priority set
//   2. POST /api/announcements: ONE announcement + ONE push per batch, text
//      built server-side from orders looked up by id + org, cap + dedupe + RBAC
//   3. GET /api/announcements publishes priority, orderNo and the sender name
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const lib = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/order-notification.ts")).href
);

test("priority: only the three known values, case-insensitive, else null", () => {
  assert.deepEqual([...lib.ORDER_PRIORITIES], ["URGENT", "OVERDUE", "PRIORITY"]);
  assert.equal(lib.readOrderPriority("urgent"), "URGENT");
  assert.equal(lib.readOrderPriority(" Overdue "), "OVERDUE");
  assert.equal(lib.readOrderPriority("PRIORITY"), "PRIORITY");
  assert.equal(lib.readOrderPriority("NORMAL"), null);
  assert.equal(lib.readOrderPriority(undefined), null);
});

test("highlight: URGENT and OVERDUE are WARNING, PRIORITY is GENERAL", () => {
  assert.equal(lib.orderNoticeCategory("URGENT"), "WARNING");
  assert.equal(lib.orderNoticeCategory("OVERDUE"), "WARNING");
  assert.equal(lib.orderNoticeCategory("PRIORITY"), "GENERAL");
});

test("builder: ticket wording, dd/mm/yyyy date, optional supervisor note", () => {
  const n = lib.buildOrderNotice({
    priority: "URGENT",
    orders: [{ poNo: "PO-001", model: "Sofa 8211", requiredDate: "2026-09-25", status: "PENDING" }],
    note: "Customer collecting Friday",
  });
  assert.equal(n.title, "URGENT ORDER - PO-001");
  assert.equal(
    n.body,
    [
      "Order No.: PO-001",
      "Model: Sofa 8211",
      "Required Date: 25/09/2026",
      "Current Status: Pending",
      "Priority: URGENT",
      "",
      "Customer collecting Friday",
      "",
      "Please prioritise this order first.",
    ].join("\n"),
  );
  const p = lib.buildOrderNotice({
    priority: "PRIORITY",
    orders: [{ poNo: "PO-2", model: "", requiredDate: "", status: "IN_PROGRESS" }],
    note: "  ",
  });
  assert.equal(p.title, "PRIORITY ORDER - PO-2");
  assert.match(p.body, /Required Date: -\nCurrent Status: In Progress/);
  assert.ok(!p.body.includes("\n\n\n"));
  const m = lib.buildOrderNotice({
    priority: "OVERDUE",
    orders: [
      { poNo: "PO-1", model: "A", requiredDate: "2026-01-02", status: "PENDING" },
      { poNo: "PO-2", model: "B", requiredDate: "2026-01-03", status: "PENDING" },
    ],
  });
  assert.equal(m.title, "OVERDUE ORDERS - 2 orders");
  assert.ok(m.body.includes("Order No.: PO-1") && m.body.includes("Order No.: PO-2"));
});

// ---- route -----------------------------------------------------------------
// The fake DB routes by table/clause, never by column NAMES in the INSERT's
// value order beyond the parsed column list; pushes are counted via the one
// workers lookup sendPushToSubscribers issues per call.
const ORDERS = {
  "po-1": { id: "po-1", orgId: "hookka", poNo: "PO-001", productName: "Sofa 8211", productCode: "S1", status: "PENDING", targetEndDate: "2026-09-20", hookkaExpectedDD: "2026-09-25" },
  "po-2": { id: "po-2", orgId: "hookka", poNo: "PO-002", productName: "Bed 1", productCode: "B1", status: "IN_PROGRESS", targetEndDate: "2026-09-21", hookkaExpectedDD: null },
  "po-other": { id: "po-other", orgId: "other-org", poNo: "PO-X", productName: "x", productCode: "x", status: "PENDING", targetEndDate: "", hookkaExpectedDD: null },
};

function makeDb(seed = []) {
  const rows = new Map(seed.map((r) => [r.id, r]));
  const inserts = [];
  const userLookups = [];
  const pushQueries = [];
  const prepare = (sql) => {
    const s = sql.trim();
    let bound = [];
    const o = {
      bind(...a) { bound = a; return o; },
      async first() {
        if (/FROM announcements WHERE id = \?/i.test(s)) return rows.get(bound[0]) ?? null;
        if (/FROM announcements\s+WHERE org_id = \? AND priority = \? AND order_id = \?/i.test(s)) {
          const [org, pr, oid, since] = bound;
          return [...rows.values()].find(
            (r) => r.org_id === org && r.priority === pr && r.order_id === oid && r.created_at >= since,
          ) ?? null;
        }
        return null;
      },
      async all() {
        if (/FROM announcements WHERE org_id = \?/i.test(s)) return { results: [...rows.values()] };
        if (/FROM users WHERE orgId = \? AND id IN/i.test(s)) {
          userLookups.push(bound);
          return { results: [{ id: "user-1", displayName: "Supervisor Sam" }] };
        }
        if (/FROM production_orders po/i.test(s)) {
          const [org, ...ids] = bound;
          return { results: ids.map((i) => ORDERS[i]).filter((r) => r && r.orgId === org) };
        }
        if (/FROM workers WHERE status = 'ACTIVE'/i.test(s)) {
          pushQueries.push(bound.slice(0, bound.length / 2));
          return { results: [] };
        }
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO announcements/i.test(s)) {
          // is_active is the literal TRUE in the SQL, so it has no bind.
          const cols = s.match(/\(([^)]*)\)\s*VALUES/i)[1].split(",").map((x) => x.trim())
            .filter((x) => x !== "is_active");
          const row = Object.fromEntries(cols.map((c, i) => [c, bound[i]]));
          inserts.push(row);
          rows.set(row.id, row);
        }
        return { success: true };
      },
    };
    return o;
  };
  return { db: { prepare }, inserts, userLookups, pushQueries };
}

async function adminApp(db, tag, role = "SUPER_ADMIN") {
  const mod = await import(
    pathToFileURL(resolve(process.cwd(), "src/api/routes/announcements.ts")).href + `?t=${tag}`
  );
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", role);
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", mod.announcementsAdmin);
  return parent;
}
const ENV = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
const post = (app, body) =>
  app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, ENV);

test("POST: one announcement for several orders, server-built text, ONE push", async () => {
  const { db, inserts, pushQueries } = makeDb();
  const app = await adminApp(db, "post-batch");
  const res = await post(app, {
    priority: "urgent",
    orderIds: ["po-1", "po-2"],
    note: "Friday pickup",
    title: "spoofed title",
    orderNo: "SPOOF",
    category: "GENERAL",
    targetDeptCodes: ["FAB_CUT", "UPHOLSTERY"],
  });
  assert.equal(res.status, 201);
  assert.equal(inserts.length, 1);
  const r = inserts[0];
  assert.equal(r.priority, "URGENT");
  assert.equal(r.category, "WARNING");
  assert.equal(r.target_type, "DEPTS");
  assert.equal(r.title, "URGENT ORDERS - 2 orders");
  assert.equal(r.order_no, "PO-001, PO-002");
  assert.equal(r.order_id, "po-1,po-2");
  assert.ok(r.body.includes("Required Date: 25/09/2026"));
  assert.ok(r.body.includes("Friday pickup"));
  assert.equal(pushQueries.length, 1, "exactly one push fan-out");
  assert.deepEqual(pushQueries[0], ["FAB_CUT", "UPHOLSTERY"]);
  const j = await res.json();
  assert.equal(j.data.priority, "URGENT");
});

test("POST: unknown / other-org order is 404, nothing stored or pushed", async () => {
  const { db, inserts, pushQueries } = makeDb();
  const app = await adminApp(db, "post-foreign");
  const res = await post(app, { priority: "URGENT", orderIds: ["po-1", "po-other"] });
  assert.equal(res.status, 404);
  assert.equal(inserts.length, 0);
  assert.equal(pushQueries.length, 0);
});

test("POST: more than 10 orders is rejected server-side", async () => {
  const { db, inserts } = makeDb();
  const app = await adminApp(db, "post-cap");
  const orderIds = Array.from({ length: 11 }, (_, i) => `po-${i}`);
  const res = await post(app, { priority: "URGENT", orderIds });
  assert.equal(res.status, 400);
  assert.equal(inserts.length, 0);
});

test("POST: same orders + priority twice in a day is 409, one push total", async () => {
  const { db, inserts, pushQueries } = makeDb();
  const app = await adminApp(db, "post-dup");
  const body = { priority: "OVERDUE", orderIds: ["po-2", "po-1"], targetDeptCodes: ["FAB_CUT"] };
  assert.equal((await post(app, body)).status, 201);
  assert.equal((await post(app, { ...body, orderIds: ["po-1", "po-2"] })).status, 409);
  assert.equal(inserts.length, 1);
  assert.equal(pushQueries.length, 1);
});

test("dedupe day is the Malaysia day (UTC+8), not the UTC date", () => {
  const day = (iso) => lib.mytDayStartIso(new Date(iso));
  // 07:00 and 09:00 MYT on 29 Oct straddle UTC midnight: same day.
  assert.equal(day("2026-10-28T23:00:00Z"), "2026-10-28T16:00:00.000Z");
  assert.equal(day("2026-10-29T01:00:00Z"), "2026-10-28T16:00:00.000Z");
  // 23:30 MYT on 28 Oct and 07:00 MYT on 29 Oct share a UTC date: different days.
  assert.equal(day("2026-10-28T15:30:00Z"), "2026-10-27T16:00:00.000Z");
});

test("POST: a send at 23:30 MYT does not block the same orders at 07:00 MYT next day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-28T23:00:00Z") });
  const { db, inserts } = makeDb([{
    id: "ann-prev", org_id: "hookka", priority: "OVERDUE", order_id: "po-1",
    created_at: "2026-10-28T15:30:00.000Z",
  }]);
  const app = await adminApp(db, "post-myt-day");
  const res = await post(app, { priority: "OVERDUE", orderIds: ["po-1"] });
  assert.equal(res.status, 201);
  assert.equal(inserts.length, 1);
});

test("POST: a role without announcements:create gets 403 and nothing is written", async () => {
  const { db, inserts, pushQueries } = makeDb();
  const app = await adminApp(db, "post-denied", "READ_ONLY");
  const res = await post(app, { priority: "URGENT", orderIds: ["po-1"] });
  assert.equal(res.status, 403);
  assert.equal(inserts.length, 0);
  assert.equal(pushQueries.length, 0);
});

test("POST without priority keeps today's behaviour (no order columns set)", async () => {
  const { db, inserts } = makeDb();
  const app = await adminApp(db, "post-plain");
  const res = await post(app, { title: "Hello", category: "SOP" });
  assert.equal(res.status, 201);
  assert.equal(inserts[0].priority, null);
  assert.equal(inserts[0].order_no, null);
  assert.equal(inserts[0].category, "SOP");
});

test("GET list publishes priority, orderNo and who sent it (org-scoped lookup)", async () => {
  const { db, userLookups } = makeDb([
    {
      id: "ann-1", org_id: "hookka", title: "t", body: "", is_active: true,
      created_by: "user-1", created_at: "2026-10-15T01:00:00Z",
      priority: "OVERDUE", order_no: "PO-9", category: "WARNING",
    },
  ]);
  const app = await adminApp(db, "get");
  const res = await app.request("/", {}, ENV);
  const j = await res.json();
  assert.equal(j.data[0].priority, "OVERDUE");
  assert.equal(j.data[0].orderNo, "PO-9");
  assert.equal(j.data[0].createdByName, "Supervisor Sam");
  assert.equal(userLookups[0][0], "hookka");
});
