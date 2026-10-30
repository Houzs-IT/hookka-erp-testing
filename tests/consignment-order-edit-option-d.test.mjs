// ---------------------------------------------------------------------------
// consignment-order-edit-option-d.test.mjs
//
// HK-0123 — after the CN lock was fixed, CO-2610-022 (CONFIRMED, 63 job
// cards, all WAITING) still could not be saved: "first production step is due
// 2026-10-31 (within the 2-day cutoff). An ADMIN override is required." The CO
// PUT kept the 2-day production_window lock the SO side dropped on 2026-05-06,
// and applied it to CONFIRMED orders, while GET /:id/edit-eligibility calls
// every CONFIRMED CO editable, so the detail page never offered the override.
//
// The CO now follows the SO's Option D rule: editable while every job card is
// still WAITING (or CANCELLED), hard-locked once any has moved on.
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

const { default: consignmentOrdersApp } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/consignment-orders.ts")).href
);

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// Answers each job_cards lookup by what its WHERE clause asks for, so the old
// completedDate / dueDate pair and the Option D status query each get a
// truthful answer from the same rows.
function makeDb(co, jobCards) {
  function prepare(sql) {
    const s = String(sql).replace(/\s+/g, " ");
    const rows = () => {
      if (/FROM consignment_orders WHERE id = \? AND orgId = \?/i.test(s)) return [co];
      if (/FROM job_cards/i.test(s)) {
        if (/status NOT IN \('WAITING', 'CANCELLED'\)/i.test(s)) {
          return jobCards.filter((j) => j.status !== "WAITING" && j.status !== "CANCELLED");
        }
        if (/completedDate IS NOT NULL/i.test(s)) return jobCards.filter((j) => j.completedDate);
        if (/dueDate IS NOT NULL/i.test(s)) {
          return [...jobCards].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        }
      }
      return [];
    };
    const obj = {
      bind() {
        return obj;
      },
      async first() {
        return rows()[0] ?? null;
      },
      async all() {
        return { results: rows() };
      },
    };
    return obj;
  }
  return { prepare };
}

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "OFFICE");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", consignmentOrdersApp);
  return parent;
}

const co = { id: "co-1", status: "IN_PRODUCTION", orgId: "hookka" };
const waiting = (dept) => ({
  status: "WAITING",
  departmentCode: dept,
  departmentName: dept,
  dueDate: tomorrow,
  completedDate: null,
});

test("IN_PRODUCTION CO with every job card WAITING is editable, even with the first due tomorrow", async () => {
  const res = await mount(makeDb(co, [waiting("FOAM"), waiting("WOOD_CUT")])).request(
    "/co-1/edit-eligibility",
  );
  const body = await res.json();
  assert.equal(body.editable, true, JSON.stringify(body));
});

test("a job card that has started locks the CO as production_started", async () => {
  const started = { ...waiting("FOAM"), status: "IN_PROGRESS" };
  const res = await mount(makeDb(co, [started, waiting("WOOD_CUT")])).request(
    "/co-1/edit-eligibility",
  );
  const body = await res.json();
  assert.equal(body.editable, false);
  assert.equal(body.reason, "production_started");
  assert.equal(body.startedDept, "FOAM");
});

test("the CO PUT carries no 2-day production_window gate", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/consignment-orders.ts"), "utf8");
  const put = src.slice(src.indexOf('app.put("/:id"'));
  assert.doesNotMatch(put.slice(0, put.indexOf("CO_VALID_TRANSITIONS")), /production_window/);
});
