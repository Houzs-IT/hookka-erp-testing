// BUG-2026-11-28-613 — PUT /api/invoices/:id { status: "PAID" } on a SENT or
// OVERDUE invoice was an allowed transition that set the status with no money:
// paidAmount unchanged, no invoice_payments row, no ledger entry, no change to
// the customer balance, yet the invoice dropped out of receivables / aging.
// A paid status must now be backed by payments. Drives the REAL handler.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));

const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const { default: invoicesApp } = await import(src("src/api/routes/invoices.ts"));
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

function makeDb(invoice) {
  const batches = [];
  const prepare = (sql) => {
    const q = norm(sql);
    const stmt = {
      sql: q,
      args: [],
      bind(...a) {
        stmt.args = a;
        return stmt;
      },
      async first() {
        if (/^SELECT created_at FROM invoices WHERE id = \?/.test(q)) return { createdAt: "2026-11-01T00:00:00.000Z" };
        if (/FROM invoices WHERE id = \?/.test(q)) return stmt.args[0] === invoice.id ? { ...invoice } : null;
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  return {
    batches,
    db: {
      prepare,
      async batch(stmts) {
        batches.push(stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return stmts.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
      },
    },
  };
}

function put(db, body) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  app.route("/", invoicesApp);
  return app.request("/inv-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const invoice = (over = {}) => ({
  id: "inv-1",
  invoiceNo: "INV-2611-001",
  status: "SENT",
  customerId: "cust-1",
  totalSen: 10000,
  subtotalSen: 10000,
  paidAmount: 0,
  deliveryOrderId: null,
  salesOrderId: null,
  ...over,
});

for (const status of ["SENT", "OVERDUE", "PARTIAL_PAID"]) {
  test(`a bare { status: "PAID" } on a ${status} invoice with payments short of the total is refused`, async () => {
    const { db, batches } = makeDb(invoice({ status, paidAmount: status === "PARTIAL_PAID" ? 4000 : 0 }));
    const res = await put(db, { status: "PAID" });
    assert.equal(res.status, 409, await res.clone().text());
    const body = await res.json();
    assert.match(body.error, /cannot be marked PAID/);
    assert.equal(batches.length, 0, "nothing written");
  });
}

test('a bare { status: "PARTIAL_PAID" } with no payment recorded is refused', async () => {
  const { db, batches } = makeDb(invoice({ status: "SENT", paidAmount: 0 }));
  const res = await put(db, { status: "PARTIAL_PAID" });
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(batches.length, 0);
});

test("a status change that is not a paid status still goes through (SENT -> OVERDUE)", async () => {
  const { db, batches } = makeDb(invoice({ status: "SENT" }));
  const res = await put(db, { status: "OVERDUE" });
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(batches.flat().some((s) => /^UPDATE invoices SET status = \?/.test(s.sql)));
});

test("the phone list no longer carries a bulk Mark Paid for invoices", () => {
  const screen = readFileSync("src/pages/m/screens/ModuleListScreen.tsx", "utf8");
  assert.doesNotMatch(screen, /endpoint: \(id\) => `\/api\/invoices\//);
});
