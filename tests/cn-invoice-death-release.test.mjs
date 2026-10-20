// ---------------------------------------------------------------------------
// cn-invoice-death-release.test.mjs — T-006 R4 + HK-0109, against the REAL
// handlers (invoices PUT/DELETE, consignment-notes convert) and the real
// release builder. CI has no Postgres, so the DB is a fake that answers reads
// from a small state object and records each batch. Its batch() plays the one
// piece of Postgres behaviour the fix leans on: the guard statement raises
// (CAST of non-numeric text) when the CN is no longer FULLY_SOLD from this
// invoice, and the whole batch rolls back.
//
// R4: voiding / deleting a CN-sourced invoice left the CN at FULLY_SOLD, linked
//     to a dead invoice, forever. Staging's port restored
//     `statusBeforeConversion ?? "PARTIALLY_SOLD"` with an unconditional UPDATE,
//     so a CN that had moved on (CLOSED / RETURNED) silently reopened, and a CN
//     converted before the column existed got a guessed status.
// HK-0109: convert-to-invoice (and /return) wrote customers.updated_at, a
//     column customers has never had — the batch failed, convert 500'd.
// ---------------------------------------------------------------------------
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
const { default: cnApp } = await import(src("src/api/routes/consignment-notes.ts"));
const { buildInvoiceDeathCnReleaseStatements } = await import(
  src("src/api/lib/consignment-note-shared.ts")
);
const { translateSql } = await import(src("src/api/lib/supabase-compat.ts"));
const SCHEMA = JSON.parse(readFileSync("tests/db-schema.json", "utf8"));

const CONVERTED_AT = "2026-10-01T03:00:00.000Z";
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

function makeState(over = {}) {
  return {
    cn: {
      id: "cn-1",
      noteNumber: "CN-0001",
      status: "FULLY_SOLD",
      statusBeforeConversion: "IN_TRANSIT",
      convertedInvoiceId: "inv-1",
      consignmentOrderId: "co-1",
      customerId: "cust-1",
      ...over.cn,
    },
    invoice: {
      id: "inv-1",
      invoiceNo: "INV-0001",
      status: "DRAFT",
      customerId: "cust-1",
      totalSen: 10000,
      subtotalSen: 10000,
      paidAmount: 0,
      deliveryOrderId: null,
      salesOrderId: null,
      created_at: CONVERTED_AT,
      ...over.invoice,
    },
    units: over.units ?? [
      { id: "u-1", status: "DELIVERED", deliveredAt: CONVERTED_AT, cnId: "cn-1" },
    ],
    // Applied just before the batch runs: another request moved the CN on.
    moveOnBeforeBatch: over.moveOnBeforeBatch ?? null,
  };
}

function makeDb(state) {
  const batches = [];
  function prepare(sql) {
    const q = norm(sql);
    const stmt = {
      sql: q,
      args: [],
      bind(...a) {
        stmt.args = a;
        return stmt;
      },
      async first() {
        if (/FROM consignment_notes WHERE convertedInvoiceId = \?/.test(q)) {
          return state.cn && state.cn.convertedInvoiceId === stmt.args[0] ? { ...state.cn } : null;
        }
        if (/^SELECT created_at FROM invoices WHERE id = \?/.test(q)) {
          return stmt.args[0] === state.invoice.id ? { createdAt: state.invoice.created_at } : null;
        }
        if (/FROM invoices WHERE id = \?/.test(q)) {
          return stmt.args[0] === state.invoice.id ? { ...state.invoice } : null;
        }
        if (/FROM consignment_notes WHERE id = \?/.test(q)) {
          return state.cn ? { ...state.cn } : null;
        }
        return null;
      },
      async all() {
        if (/FROM fg_units/.test(q) && /status = 'DELIVERED'/.test(q)) {
          const [cnId, at] = stmt.args;
          return { results: state.units.filter((u) => u.cnId === cnId && u.status === "DELIVERED" && u.deliveredAt === at) };
        }
        if (/FROM consignment_items/.test(q)) {
          return { results: [{ id: "ci-1", consignmentNoteId: "cn-1", productCode: "P1", productName: "P1", quantity: 1, unitPrice: 100, status: "AT_BRANCH" }] };
        }
        return { results: [] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
    return stmt;
  }
  return {
    batches,
    db: {
      prepare,
      async batch(stmts) {
        if (state.moveOnBeforeBatch) Object.assign(state.cn, state.moveOnBeforeBatch);
        for (const s of stmts) {
          if (/CN_RELEASE_CONFLICT/.test(s.sql)) {
            const [invoiceId, cnId] = s.args;
            const ok = state.cn.id === cnId && state.cn.status === "FULLY_SOLD" && state.cn.convertedInvoiceId === invoiceId;
            if (!ok) throw new Error(`invalid input syntax for type integer: "CN_RELEASE_CONFLICT ${cnId}"`);
          }
        }
        batches.push(stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return stmts.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
      },
    },
  };
}

function mount(app, db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", app);
  return parent;
}

const del = (db) => mount(invoicesApp, db).request("/inv-1", { method: "DELETE" });
const voidInv = (db) =>
  mount(invoicesApp, db).request("/inv-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "CANCELLED" }),
  });
const cnUpdate = (batch) => batch.find((s) => /^UPDATE consignment_notes/.test(s.sql));

// ── the release builder ─────────────────────────────────────────────────────

test("R4: release restores the recorded prior status, guarded on FULLY_SOLD + this invoice", async () => {
  const { db } = makeDb(makeState());
  const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
  assert.equal(r.conflict, null);
  const upd = r.statements.find((s) => /^UPDATE consignment_notes/.test(s.sql));
  assert.match(upd.sql, /WHERE id = \? AND status = 'FULLY_SOLD' AND convertedInvoiceId = \?$/);
  assert.deepEqual(upd.args, ["IN_TRANSIT", CONVERTED_AT, "cn-1", "inv-1"]);
  assert.match(upd.sql, /status_before_conversion = NULL, convertedInvoiceId = NULL/);
  // the guard runs first, so the batch aborts before anything is undone
  assert.match(r.statements[0].sql, /CN_RELEASE_CONFLICT/);
  assert.match(r.statements[0].sql, /FOR UPDATE$/);
  assert.equal(r.consignmentOrderId, "co-1");
});

test("R4: release reads the camelCase key the Postgres adapter returns", async () => {
  const st = makeState();
  const { db } = makeDb(st);
  st.cn.statusBeforeConversion = undefined;
  st.cn.status_before_conversion = "PARTIALLY_SOLD"; // snake key still honoured
  const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
  assert.equal(cnUpdateArgs(r)[0], "PARTIALLY_SOLD");
});
const cnUpdateArgs = (r) => r.statements.find((s) => /^UPDATE consignment_notes/.test(s.sql)).args;

test("R4: release undoes only the items and units stamped by the conversion", async () => {
  const st = makeState({ units: [
    { id: "u-1", status: "DELIVERED", deliveredAt: CONVERTED_AT, cnId: "cn-1" },
    { id: "u-2", status: "DELIVERED", deliveredAt: "2026-09-01T00:00:00.000Z", cnId: "cn-1" },
  ] });
  const { db } = makeDb(st);
  const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
  const items = r.statements.find((s) => /^UPDATE consignment_items/.test(s.sql));
  assert.deepEqual(items.args, ["cn-1", CONVERTED_AT]);
  const units = r.statements.find((s) => /^UPDATE fg_units/.test(s.sql));
  assert.deepEqual(units.args, ["cn-1", CONVERTED_AT]);
  const events = r.statements.filter((s) => /^INSERT INTO fg_stock_events/.test(s.sql));
  assert.equal(events.length, 1, "one ledger event, for the one unit the conversion delivered");
  assert.equal(events[0].args[1], "u-1");
});

test("R4: a non-CN invoice gets no release statements", async () => {
  const { db } = makeDb(makeState({ cn: { convertedInvoiceId: "other" } }));
  const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
  assert.deepEqual(r, { conflict: null, statements: [], consignmentOrderId: null });
});

for (const status of ["CLOSED", "RETURNED", "PARTIALLY_SOLD"]) {
  test(`R4: a CN that moved on to ${status} is a conflict, not a silent reopen`, async () => {
    const { db } = makeDb(makeState({ cn: { status } }));
    const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
    assert.match(r.conflict, new RegExp(`CN-0001 is ${status}`));
  });
}

test("R4: an unrecorded prior status (converted before 0244) is a conflict, never PARTIALLY_SOLD", async () => {
  for (const prior of [null, undefined, "", "BOGUS"]) {
    const { db } = makeDb(makeState({ cn: { statusBeforeConversion: prior } }));
    const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
    assert.match(r.conflict ?? "", /no recorded status/, `prior=${String(prior)}`);
  }
});

test("R4: the in-batch guard's SQL survives the Postgres translation", () => {
  const { db } = makeDb(makeState());
  return buildInvoiceDeathCnReleaseStatements(db, "inv-1").then((r) => {
    const pg = translateSql(r.statements[0].sql);
    assert.match(pg, /converted_invoice_id = \$1/);
    assert.match(pg, /CAST\('CN_RELEASE_CONFLICT ' \|\| id AS INTEGER\)/);
    assert.match(pg, /WHERE id = \$2 FOR UPDATE/);
  });
});

// ── DELETE /api/invoices/:id ────────────────────────────────────────────────

test("R4: deleting a CN-sourced DRAFT releases the CN in the same batch, before the DELETE", async () => {
  const { db, batches } = makeDb(makeState());
  const res = await del(db);
  assert.equal(res.status, 200, await res.text());
  assert.equal(batches.length, 1);
  const b = batches[0];
  const iUpd = b.findIndex((s) => /^UPDATE consignment_notes/.test(s.sql));
  const iDel = b.findIndex((s) => /^DELETE FROM invoices/.test(s.sql));
  assert.ok(iUpd > -1 && iDel > -1);
  assert.ok(iUpd < iDel, "FK is ON DELETE SET NULL — the release must run before the DELETE");
});

test("R4: deleting when the CN moved on refuses with 409 and writes nothing", async () => {
  const { db, batches } = makeDb(makeState({ cn: { status: "CLOSED" } }));
  const res = await del(db);
  assert.equal(res.status, 409);
  assert.equal(batches.length, 0);
});

test("R4: a CN that moves on between read and batch rolls the delete back with 409", async () => {
  const { db, batches } = makeDb(makeState({ moveOnBeforeBatch: { status: "RETURNED" } }));
  const res = await del(db);
  assert.equal(res.status, 409, await res.text());
  assert.equal(batches.length, 0, "the batch must not land");
});

// ── PUT /api/invoices/:id → CANCELLED (void) ────────────────────────────────

test("R4: voiding when the prior status is unknown refuses with 409 before writing", async () => {
  const { db, batches } = makeDb(makeState({ cn: { statusBeforeConversion: null }, invoice: { status: "SENT" } }));
  const res = await voidInv(db);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no recorded status/);
  assert.equal(batches.length, 0);
});

test("R4: voiding a CN-sourced invoice releases the CN in the void's own batch", async () => {
  const { db, batches } = makeDb(makeState({ invoice: { status: "SENT" } }));
  const res = await voidInv(db);
  assert.equal(res.status, 200, await res.text());
  assert.equal(batches.length, 1);
  const b = batches[0];
  assert.ok(b.some((s) => /^UPDATE invoices/.test(s.sql)), "the void itself");
  assert.deepEqual(cnUpdate(b).args.slice(0, 1), ["IN_TRANSIT"]);
});

test("R4: a CN that moves on mid-void rolls the void back with 409", async () => {
  const { db, batches } = makeDb(makeState({ invoice: { status: "SENT" }, moveOnBeforeBatch: { status: "CLOSED" } }));
  const res = await voidInv(db);
  assert.equal(res.status, 409, await res.text());
  assert.equal(batches.length, 0);
});

// ── convert-to-invoice ──────────────────────────────────────────────────────

async function convert(cnOver) {
  const st = makeState({ cn: { convertedInvoiceId: null, statusBeforeConversion: null, ...cnOver } });
  const { db, batches } = makeDb(st);
  const res = await mount(cnApp, db).request("/cn-1/convert-to-invoice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return { res, batches };
}

test("HK-0109: convert writes only columns customers really has", async () => {
  const { res, batches } = await convert({ status: "PARTIALLY_SOLD" });
  assert.equal(res.status, 201, await res.text().catch(() => ""));
  const cust = batches[0].filter((s) => /^UPDATE customers/.test(s.sql));
  assert.equal(cust.length, 1, "convert must still bump the customer's A/R");
  for (const s of cust) {
    const pg = translateSql(s.sql);
    const set = pg.slice(pg.indexOf("SET") + 3, pg.indexOf("WHERE"));
    const cols = [...set.matchAll(/([a-z_]+)\s*=/g)].map((m) => m[1]);
    for (const col of cols) {
      assert.ok(SCHEMA.customers.includes(col), `customers.${col} does not exist`);
    }
    assert.equal(s.args.length, (s.sql.match(/\?/g) ?? []).length, "binds match placeholders");
  }
});

test("R4: convert records the CN's status as it was, not a default", async () => {
  for (const status of ["ACTIVE", "PARTIALLY_SOLD", "IN_TRANSIT"]) {
    const { res, batches } = await convert({ status });
    assert.ok(res.status < 300, `convert from ${status}`);
    const upd = cnUpdate(batches[0]);
    assert.match(upd.sql, /status_before_conversion = \?/);
    assert.equal(upd.args[0], status);
  }
});

// HK-0109 class: the same phantom column sat in /return too. Every
// `UPDATE customers SET …` in src/api, after translation, may only name real
// customers columns (the fixture lacks the self-applied ones, listed here).
test("HK-0109: no route updates a customers column that does not exist", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (n.endsWith(".ts")) out.push(p);
    }
    return out;
  };
  const selfApplied = ["currency", "bank_account", "ocrpromptrules"];
  const known = new Set([...SCHEMA.customers, ...selfApplied]);
  const bad = [];
  for (const f of walk("src/api")) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/UPDATE customers\s+SET([\s\S]*?)WHERE/g)) {
      const pg = translateSql(`UPDATE customers SET${m[1]}WHERE id = ?`);
      const set = pg.slice(pg.indexOf("SET") + 3, pg.indexOf("WHERE"));
      for (const [, col] of set.matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)) {
        if (!known.has(col)) bad.push(`${f}: customers.${col}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("R4: no convert timestamp is a conflict, never a header-only undo", async () => {
  const { db } = makeDb(makeState({ invoice: { created_at: null } }));
  const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
  assert.match(r.conflict ?? "", /no creation time/);
});

test("R4: an inherited object key is not accepted as a prior status", async () => {
  const { db } = makeDb(makeState({ cn: { statusBeforeConversion: "constructor" } }));
  const r = await buildInvoiceDeathCnReleaseStatements(db, "inv-1");
  assert.match(r.conflict ?? "", /no recorded status/);
});
