// ---------------------------------------------------------------------------
// order-notification.test.mjs — HK-0025: "Send Notification" on the Production
// Overview. An order notice is an announcement carrying priority + order no.
//   1. pure builder (src/lib/order-notification.ts): title/body, priority set
//   2. POST /api/announcements stores priority/order_no/order_id, forces the
//      WARNING category (the worker phone's highlight) for URGENT/OVERDUE
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
    poNo: "PO-001",
    model: "Sofa 8211",
    requiredDate: "2026-09-25",
    status: "PENDING",
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
    priority: "PRIORITY", poNo: "PO-2", model: "", requiredDate: "", status: "IN_PROGRESS", note: "  ",
  });
  assert.equal(p.title, "PRIORITY ORDER - PO-2");
  assert.match(p.body, /Required Date: -\nCurrent Status: In Progress/);
  assert.ok(!p.body.includes("\n\n\n"));
});

// ---- route -----------------------------------------------------------------
function makeDb(seed = []) {
  const rows = new Map(seed.map((r) => [r.id, r]));
  const inserts = [];
  const prepare = (sql) => {
    const s = sql.trim();
    let bound = [];
    const o = {
      bind(...a) { bound = a; return o; },
      async first() {
        if (/FROM announcements WHERE id = \?/i.test(s)) return rows.get(bound[0]) ?? null;
        return null;
      },
      async all() {
        if (/FROM announcements WHERE org_id = \?/i.test(s)) return { results: [...rows.values()] };
        if (/FROM users WHERE id IN/i.test(s)) {
          return { results: [{ id: "user-1", displayName: "Supervisor Sam" }] };
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
  return { db: { prepare }, inserts };
}

async function adminApp(db, tag) {
  const mod = await import(
    pathToFileURL(resolve(process.cwd(), "src/api/routes/announcements.ts")).href + `?t=${tag}`
  );
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", mod.announcementsAdmin);
  return parent;
}
const post = (app, body) =>
  app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, {});

test("POST stores priority + order and forces WARNING for URGENT", async () => {
  const { db, inserts } = makeDb();
  const app = await adminApp(db, "post-urgent");
  const res = await post(app, {
    title: "URGENT ORDER - PO-001",
    body: "x",
    priority: "urgent",
    orderNo: "PO-001",
    orderId: "po-1",
    category: "GENERAL",
    targetDeptCodes: ["FAB_CUT", "UPHOLSTERY"],
  });
  assert.equal(res.status, 201);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].priority, "URGENT");
  assert.equal(inserts[0].order_no, "PO-001");
  assert.equal(inserts[0].order_id, "po-1");
  assert.equal(inserts[0].category, "WARNING");
  assert.equal(inserts[0].target_type, "DEPTS");
  const j = await res.json();
  assert.equal(j.data.priority, "URGENT");
  assert.equal(j.data.orderNo, "PO-001");
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

test("GET list publishes priority, orderNo and who sent it", async () => {
  const { db } = makeDb([
    {
      id: "ann-1", org_id: "hookka", title: "t", body: "", is_active: true,
      created_by: "user-1", created_at: "2026-10-15T01:00:00Z",
      priority: "OVERDUE", order_no: "PO-9", category: "WARNING",
    },
  ]);
  const app = await adminApp(db, "get");
  const res = await app.request("/", {}, {});
  const j = await res.json();
  assert.equal(j.data[0].priority, "OVERDUE");
  assert.equal(j.data[0].orderNo, "PO-9");
  assert.equal(j.data[0].createdByName, "Supervisor Sam");
});
