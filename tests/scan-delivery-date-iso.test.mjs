// HK-0080 — a scanned PO's "Delivery Date" must reach sales_orders as ISO
// YYYY-MM-DD. The overdue SQL compares the text column with `< today`, so a
// DD/MM/YYYY string ("15/10/2026" < "2026-10-15") reads as overdue forever.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toIsoDate } from "../src/api/lib/iso-date.ts";

test("ISO passes through, time part dropped", () => {
  assert.equal(toIsoDate("2026-10-15"), "2026-10-15");
  assert.equal(toIsoDate("2026-10-15T08:00:00.000Z"), "2026-10-15");
});
test("Malaysian DD/MM/YYYY, DD.MM.YYYY, DD-MM-YY convert (day first)", () => {
  assert.equal(toIsoDate("03/06/2026"), "2026-06-03");
  assert.equal(toIsoDate("3.6.2026"), "2026-06-03");
  assert.equal(toIsoDate("15-10-26"), "2026-10-15");
});
test("garbage and impossible dates become null, never a guess", () => {
  assert.equal(toIsoDate("31/02/2026"), null);
  assert.equal(toIsoDate("next week"), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate(null), null);
});
test("normaliseBodyDates: converts in place, 400s unreadable, leaves blank alone", async () => {
  const { normaliseBodyDates } = await import("../src/api/lib/iso-date.ts");
  const b = { customerDeliveryDate: "03/06/2026", hookkaExpectedDD: "" };
  assert.equal(normaliseBodyDates(b, ["customerDeliveryDate", "hookkaExpectedDD"]), null);
  assert.equal(b.customerDeliveryDate, "2026-06-03");
  assert.equal(b.hookkaExpectedDD, "", "blank is a legitimate clear");
  const bad = { customerDeliveryDate: "31/02/2026" };
  const msg = normaliseBodyDates(bad, ["customerDeliveryDate"]);
  assert.match(msg, /customerDeliveryDate "31\/02\/2026" is not a valid date/);
  assert.equal(bad.customerDeliveryDate, "31/02/2026", "not rewritten");
  assert.equal(normaliseBodyDates({}, ["customerDeliveryDate"]), null);
});

// Behavioural: POST /api/sales-orders answers 400 before touching the DB.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const { default: soApp } = await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/sales-orders.ts")).href);

function mountSo(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db); c.set("orgId", "hookka"); c.set("userRole", "ADMIN"); c.set("userId", "u1");
    await next();
  });
  parent.route("/", soApp);
  return parent;
}
const calls = [];
const stubDb = {
  prepare(sql) {
    calls.push(sql);
    const o = { bind: () => o, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) };
    return o;
  },
  batch: async () => [],
};

test("SO create: an unreadable customerDeliveryDate is 400, not a silent blank", async () => {
  const res = await mountSo(stubDb).request("/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerId: "c1", customerDeliveryDate: "next week", items: [] }),
  }, {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /customerDeliveryDate "next week" is not a valid date/);
  assert.ok(!calls.some((q) => /INSERT INTO sales_orders/i.test(q)));
});

test("SO create: a readable DD/MM/YYYY passes the date gate (reaches the customer lookup)", async () => {
  const res = await mountSo(stubDb).request("/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerId: "c1", customerDeliveryDate: "03/06/2026", items: [] }),
  }, {});
  const body = await res.json();
  assert.equal(body.error, "Customer not found", "got past the date gate to the next check");
});
