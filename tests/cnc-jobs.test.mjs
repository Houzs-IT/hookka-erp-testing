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
  const binds = [];
  const auditBinds = [];
  const prepare = (sql) => {
    let args = [];
    const o = {
      bind(...a) {
        args = a;
        if (/INSERT INTO audit_events/i.test(sql)) auditBinds.push(a);
        return o;
      },
      async first() {
        seen.push(sql);
        // The upsert behaves like the real guard: a late CUTTING after DONE
        // writes nothing and RETURNING yields no row.
        if (/INSERT INTO cnc_cut_results/i.test(sql)) {
          const cur = results.get(args[0]);
          if (cur && cur.status === "DONE" && args[2] !== "DONE") return null;
          results.set(args[0], { status: args[2], cutQty: args[3] });
          return { job_card_id: args[0] };
        }
        if (/FROM job_cards WHERE id = \?/i.test(sql)) {
          const c = cards[args[0]];
          return c && c.org === args[1] && c.dept === "FAB_CUT" ? { id: args[0] } : null;
        }
        return null;
      },
      async all() {
        seen.push(sql);
        binds.push(args);
        return { results: [{ jobCardId: "jc1", poNo: "PO-1" }] };
      },
      async run() {
        seen.push(sql);
        return { success: true };
      },
    };
    return o;
  };
  return { db: { prepare }, results, seen, binds, auditBinds };
}

async function appFor(db, role = "ADMIN") {
  const mod = await import("../src/api/routes/cnc-jobs.ts");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", role);
    c.set("userId", "u1");
    c.set("orgId", "hookka");
    await next();
  });
  app.route("/api/cnc-jobs", mod.default);
  return app;
}

// {} = Worker env, so rbac resolves code-defined roles through role-policy.ts.
const post = (app, id, body) =>
  app.request(
    `/api/cnc-jobs/${id}/result`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    {},
  );

test("parseCncReport accepts CUTTING/DONE with integer qty, rejects the rest", async () => {
  const { parseCncReport } = await import("../src/api/routes/cnc-jobs.ts");
  assert.deepEqual(parseCncReport({ status: "done", cutQty: 4 }), { status: "DONE", cutQty: 4 });
  assert.equal(typeof parseCncReport({ status: "COMPLETED", cutQty: 1 }), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: -1 }), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: 1.5 }), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: "3" }), "string");
  assert.equal(typeof parseCncReport(null), "string");
  assert.equal(typeof parseCncReport({ status: "DONE", cutQty: 100001 }), "string", "upper bound");
  assert.deepEqual(parseCncReport({ status: "DONE", cutQty: 100000 }), { status: "DONE", cutQty: 100000 });
});

test("POST result records the report and a re-report replaces it", async () => {
  const { db, results } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
  const app = await appFor(db);
  assert.equal((await post(app, "jc1", { status: "CUTTING", cutQty: 2 })).status, 200);
  assert.equal((await post(app, "jc1", { status: "DONE", cutQty: 5 })).status, 200);
  assert.equal(results.size, 1);
  assert.deepEqual(results.get("jc1"), { status: "DONE", cutQty: 5 });
});

test("a late CUTTING report after DONE is ignored: not stored, not audited, says so", async () => {
  const { db, results, auditBinds } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
  const app = await appFor(db);
  assert.equal((await post(app, "jc1", { status: "DONE", cutQty: 5 })).status, 200);
  const auditsBefore = auditBinds.length;
  const res = await post(app, "jc1", { status: "CUTTING", cutQty: 1 });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ignored, true);
  assert.equal(body.data.status, undefined, "must not echo a status that was not stored");
  assert.deepEqual(results.get("jc1"), { status: "DONE", cutQty: 5 });
  assert.equal(auditBinds.length, auditsBefore, "no audit for a skipped write");
});

test("a real write is audited under the cnc-jobs resource, not cnc-templates", async () => {
  const { db, auditBinds } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
  const app = await appFor(db);
  const body = await (await post(app, "jc1", { status: "CUTTING", cutQty: 1 })).json();
  assert.equal(body.ignored, undefined);
  assert.equal(body.data.status, "CUTTING");
  assert.equal(auditBinds.length, 1);
  assert.ok(auditBinds[0].includes("cnc-jobs"));
  assert.ok(!auditBinds[0].includes("cnc-templates"));
});

test("permissions: the feed is not open to every role (QA/R&D/Sales denied), Office and admin pass", async () => {
  for (const role of ["QA", "R_AND_D", "SALES", "HR"]) {
    const { db } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
    const app = await appFor(db, role);
    assert.equal((await app.request("/api/cnc-jobs", {}, {})).status, 403, `${role} feed`);
    assert.equal((await post(app, "jc1", { status: "DONE", cutQty: 1 })).status, 403, `${role} report`);
  }
  for (const role of ["OFFICE", "ADMIN"]) {
    const { db } = makeDb({ cards: { jc1: { org: "hookka", dept: "FAB_CUT" } } });
    const app = await appFor(db, role);
    assert.equal((await app.request("/api/cnc-jobs", {}, {})).status, 200, `${role} feed`);
    assert.equal((await post(app, "jc1", { status: "DONE", cutQty: 1 })).status, 200, `${role} report`);
  }
});

test("feed is paginated: default 200, clamped to 500, offset passed", async () => {
  const { db, binds } = makeDb();
  const app = await appFor(db);
  let body = await (await app.request("/api/cnc-jobs", {}, {})).json();
  assert.deepEqual([body.limit, body.offset], [200, 0]);
  body = await (await app.request("/api/cnc-jobs?limit=99999&offset=40", {}, {})).json();
  assert.deepEqual([body.limit, body.offset], [500, 40]);
  assert.deepEqual(binds.at(-1), ["hookka", 500, 40]);
  body = await (await app.request("/api/cnc-jobs?limit=abc&offset=-5", {}, {})).json();
  assert.deepEqual([body.limit, body.offset], [200, 0]);
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
  const res = await app.request("/api/cnc-jobs", {}, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data[0].poNo, "PO-1");
  const sql = seen.find((s) => /FROM job_cards jc/.test(s));
  assert.match(sql, /department_code = 'FAB_CUT'/);
  assert.match(sql, /NOT IN \('COMPLETED','TRANSFERRED'\)/);
});
