// ---------------------------------------------------------------------------
// po-short-close.test.mjs — HK-0119. The Hookka office bills POs straight
// from the PO without a GRN, so a PO the supplier under-delivered never
// reaches RECEIVED and could only be Cancelled. CONFIRMED / PARTIAL_RECEIVED
// may now go straight to CLOSED; RECEIVED still needs a posted GRN.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { Hono } = await import("hono");
const { default: poApp } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/purchase-orders.ts")).href
);

function harness(status) {
  const existing = {
    id: "po-1",
    poNo: "PO-2608-026",
    supplierId: "s-1",
    supplierName: "SOOMAX",
    status,
    subtotalSen: 36000,
    totalSen: 36000,
    orderDate: "2026-08-03",
    expectedDate: "2026-08-10",
    receivedDate: null,
    notes: "",
    purchase_org_code: "HOOKKA",
  };
  const updates = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/FROM purchase_orders WHERE id = \?/.test(sql)) return existing;
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
  });
  const DB = {
    prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()),
    async exec() {
      return { count: 0 };
    },
    async batch(stmts) {
      for (const s of stmts) if (/^UPDATE purchase_orders SET/.test(s.sql)) updates.push(s.args);
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", DB);
    c.set("orgId", "org-1");
    c.set("userId", "u-1");
    c.set("userRole", "SUPER_ADMIN");
    await next();
  });
  app.route("/", poApp);
  const put = (body) =>
    app.request(
      "/po-1",
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      { SESSION_CACHE: undefined },
    );
  return { put, updates };
}
// UPDATE bind order: supplierId, supplierName, subtotal, total, status, orderDate, expectedDate, receivedDate, notes, org, updated_at, id
const statusOf = (args) => args[4];
const notesOf = (args) => args[8];

for (const from of ["CONFIRMED", "PARTIAL_RECEIVED"]) {
  test(`${from} -> CLOSED without a GRN is allowed and keeps the reason in notes`, async () => {
    const { put, updates } = harness(from);
    const notes = "[CLOSED 2026-10-28: supplier sent 180 of 400, rest not coming]";
    const res = await put({ status: "CLOSED", notes });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(updates.length, 1);
    assert.equal(statusOf(updates[0]), "CLOSED");
    assert.equal(notesOf(updates[0]), notes);
  });
}

test("CONFIRMED -> RECEIVED still needs a posted GRN", async () => {
  const { put, updates } = harness("CONFIRMED");
  const res = await put({ status: "RECEIVED" });
  assert.equal(res.status, 412);
  assert.equal(updates.length, 0);
});

test("DRAFT and SUBMITTED cannot be closed (nothing was ordered yet)", async () => {
  for (const from of ["DRAFT", "SUBMITTED"]) {
    const { put, updates } = harness(from);
    const res = await put({ status: "CLOSED" });
    assert.equal(res.status, 400, from);
    assert.equal(updates.length, 0);
  }
});

test("detail page offers Close PO on CONFIRMED / PARTIAL_RECEIVED and writes a [CLOSED …] note", () => {
  const page = readFileSync(resolve(process.cwd(), "src/pages/procurement/detail.tsx"), "utf8");
  assert.match(page, /const canCloseShort = \["CONFIRMED", "PARTIAL_RECEIVED"\]\.includes\(po\.status\)/);
  assert.match(page, /const target = closeShort \? "CLOSED" : "CANCELLED"/);
  assert.match(page, /const annotation = `\[\$\{target\} \$\{today\}: \$\{reason\}\]`/);
});
