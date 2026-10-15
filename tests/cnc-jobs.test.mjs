// HK-0036 - CNC fabric-cutting job feed + result report (src/api/routes/cnc-jobs.ts).
// In-memory DB stub, no network. Pins: report validation, FAB_CUT-only guard,
// upsert (a re-report replaces, never duplicates), feed shape/scope.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // native type stripping
}

function makeDb({ cards = {} } = {}) {
  const results = new Map();
  const seen = [];
  const prepare = (sql) => {
    let args = [];
    const o = {
      bind(...a) {
        args = a;
        return o;
      },
      async first() {
        seen.push(sql);
        if (/FROM job_cards WHERE id = \?/i.test(sql)) {
          const c = cards[args[0]];
          return c && c.org === args[1] && c.dept === "FAB_CUT" ? { id: args[0] } : null;
        }
        return null;
      },
      async all() {
        seen.push(sql);
        return { results: [{ jobCardId: "jc1", poNo: "PO-1" }] };
      },
      async run() {
        seen.push(sql);
        if (/INSERT INTO cnc_cut_results/i.test(sql)) {
          results.set(args[0], { status: args[2], cutQty: args[3] });
        }
        return { success: true };
      },
    };
    return o;
  };
  return { db: { prepare }, results, seen };
}

async function appFor(db) {
  const mod = await import("../src/api/routes/cnc-jobs.ts");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", "ADMIN");
    c.set("userId", "u1");
    c.set("orgId", "hookka");
    await next();
  });
  app.route("/api/cnc-jobs", mod.default);
  return app;
}

const post = (app, id, body) =>
  app.request(`/api/cnc-jobs/${id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("parseCncReport accepts CUTTING/DONE with integer qty, rejects the rest", async () => {
  const { parseCncReport } = await import("../src/api/routes/cnc-jobs.ts");
  assert.deepEqual(parseCncReport({ status: "done", cutQty: 4 }), { status: "DONE", cutQty: 4 });
  assert.equal(typeof parseCncReport({ status: "COMPLETED", cutQty: 1 }), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: -1 }), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: 1.5 }), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: "3" }), "string");
  assert.equal(typeof parseCncReport(null), "string");
});

test("POST result records the report and a re-report replaces it", async () => {
  const { db, results } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
  const app = await appFor(db);
  assert.equal((await post(app, "jc1", { status: "CUTTING", cutQty: 2 })).status, 200);
  assert.equal((await post(app, "jc1", { status: "DONE", cutQty: 5 })).status, 200);
  assert.equal(results.size, 1);
  assert.deepEqual(results.get("jc1"), { status: "DONE", cutQty: 5 });
});

test("upsert never lets a late CUTTING report undo DONE (stub cannot run SQL, so pin the guard)", async () => {
  const { db, seen } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
  const app = await appFor(db);
  await post(app, "jc1", { status: "CUTTING", cutQty: 1 });
  const sql = seen.find((s) => /INSERT INTO cnc_cut_results/.test(s));
  assert.match(sql, /WHERE cnc_cut_results\.status <> 'DONE' OR excluded\.status = 'DONE'/);
});

test("POST result: bad body 400, non-FAB_CUT or unknown card 404, nothing written", async () => {
  const { db, results } = makeDb({
    cards: { sew1: { org: "hookka", dept: "FAB_SEW" } },
  });
  const app = await appFor(db);
  assert.equal((await post(app, "sew1", { status: "DONE" })).status, 400);
  assert.equal((await post(app, "sew1", { status: "DONE", cutQty: 1 })).status, 404);
  assert.equal((await post(app, "nope", { status: "DONE", cutQty: 1 })).status, 404);
  assert.equal(results.size, 0);
});

test("GET feed returns rows and scopes to FAB_CUT open cards", async () => {
  const { db, seen } = makeDb();
  const app = await appFor(db);
  const res = await app.request("/api/cnc-jobs");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data[0].poNo, "PO-1");
  const sql = seen.find((s) => /FROM job_cards jc/.test(s));
  assert.match(sql, /department_code = 'FAB_CUT'/);
  assert.match(sql, /NOT IN \('COMPLETED','TRANSFERRED'\)/);
});
