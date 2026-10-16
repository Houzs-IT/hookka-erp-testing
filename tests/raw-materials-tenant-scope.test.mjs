// ---------------------------------------------------------------------------
// raw-materials-tenant-scope.test.mjs — the by-id raw-material routes are
// scoped to the caller's ORG, like the list beside them.
//
// GET /api/raw-materials already filtered `WHERE orgId = ?`, but GET /:id,
// GET /:id/used-in, PUT /:id and DELETE /:id looked the row up by id alone, so
// a caller in org A who knew an id from org B could read, edit or delete it.
// Each route now 404s on another org's id.
//
// The mock only honours the org when the SQL carries `AND orgId = ?`: drop the
// predicate and the foreign row comes back, so these tests fail.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));

const { default: rawMaterialsApp } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/raw-materials.ts")).href
);

const RMS = [
  { id: "rm-1", orgId: "hookka", itemCode: "HK-RM-1", description: "Ours", baseUOM: "PCS", itemGroup: "OTHERS", status: "ACTIVE", balanceQty: 0 },
  { id: "rm-9", orgId: "acme", itemCode: "AC-RM-9", description: "Theirs", baseUOM: "PCS", itemGroup: "OTHERS", status: "ACTIVE", balanceQty: 0 },
];

function makeDb() {
  const writes = [];
  function prepare(sql) {
    const s = sql.trim();
    let bound = [];
    const rows = () => {
      if (!/FROM raw_materials/i.test(s)) return [];
      if (/WHERE id = \? AND orgId = \?/i.test(s)) {
        return RMS.filter((r) => r.id === bound[0] && r.orgId === bound[1]);
      }
      if (/WHERE id = \?/i.test(s)) return RMS.filter((r) => r.id === bound[0]);
      return [];
    };
    const obj = {
      bind(...args) {
        bound = args;
        return obj;
      },
      async first() {
        return rows()[0] ?? null;
      },
      async all() {
        return { results: rows() };
      },
      async run() {
        if (/^(UPDATE|DELETE)/i.test(s)) writes.push(s);
        return { success: true, meta: { changes: 0 } };
      },
    };
    return obj;
  }
  return { db: { prepare, batch: async () => [] }, writes };
}

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", rawMaterialsApp);
  return (path, init) => parent.request(path, init, {});
}

test("GET /:id returns the caller's own raw material", async () => {
  const res = await mount(makeDb().db)("/rm-1");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.id, "rm-1");
});

test("GET /:id 404s on another org's raw material", async () => {
  const res = await mount(makeDb().db)("/rm-9");
  assert.equal(res.status, 404);
});

test("GET /:id/used-in 404s on another org's raw material", async () => {
  const res = await mount(makeDb().db)("/rm-9/used-in");
  assert.equal(res.status, 404);
});

test("PUT /:id 404s on another org's raw material and writes nothing", async () => {
  const { db, writes } = makeDb();
  const res = await mount(db)("/rm-9", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "hijacked" }),
  });
  assert.equal(res.status, 404);
  assert.deepEqual(writes.filter((w) => /raw_materials/i.test(w)), []);
});

test("DELETE /:id 404s on another org's raw material and deletes nothing", async () => {
  const { db, writes } = makeDb();
  const res = await mount(db)("/rm-9", { method: "DELETE" });
  assert.equal(res.status, 404);
  assert.deepEqual(writes.filter((w) => /raw_materials/i.test(w)), []);
});
