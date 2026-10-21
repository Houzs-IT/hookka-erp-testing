// T-006 R10 — idempotency on the six create/convert routes (DO, GRN, PI,
// CN convert, purchase return, delivery return), plus the two gaps the
// staging port had: keys were not scoped per org (BUG-2026-10-20-370) and
// the same key with a different body replayed the old response
// (BUG-2026-10-20-371).
//
// The behaviour tests run the REAL `idempotent()` middleware in a real Hono
// app against an in-memory KV. The wiring tests are source-static.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  /* native type-strip on newer Node */
}

const { Hono } = await import("hono");
const { idempotent } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/lib/idempotency.ts")).href
);

function makeKv() {
  const m = new Map();
  return {
    m,
    async get(k) {
      return m.has(k) ? JSON.parse(m.get(k)) : null;
    },
    async put(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

// One app per test. `status` lets a test make the handler answer 403/500.
function makeApp({ status = 201 } = {}) {
  const kv = makeKv();
  let runs = 0;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgId", c.req.header("x-org") ?? "org-a");
    await next();
  });
  app.post("/api/grn", idempotent(), async (c) => {
    const body = await c.req.json();
    runs += 1;
    return c.json({ success: true, data: { id: `GRN-${runs}`, poId: body.poId } }, status);
  });
  app.post("/api/consignment-notes/:id/convert-to-invoice", idempotent(), async (c) => {
    runs += 1;
    return c.json({ success: true, data: { id: `INV-${runs}`, cn: c.req.param("id") } }, 201);
  });
  const send = (path, body, headers = {}) =>
    app.request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
      { SESSION_CACHE: kv },
    );
  return { send, kv, runs: () => runs };
}

test("R10: a retry with the same key and body replays, the handler runs once", async () => {
  const { send, runs } = makeApp();
  const h = { "idempotency-key": "k1" };
  const a = await send("/api/grn", { poId: "PO-1" }, h);
  const b = await send("/api/grn", { poId: "PO-1" }, h);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotency-replay"), "true");
  assert.deepEqual(await b.json(), await a.json());
  assert.equal(runs(), 1);
});

test("R10: no Idempotency-Key header is a no-op", async () => {
  const { send, runs } = makeApp();
  await send("/api/grn", { poId: "PO-1" });
  await send("/api/grn", { poId: "PO-1" });
  assert.equal(runs(), 2);
});

test("BUG-370: two orgs sending the same key do not collide", async () => {
  const { send, runs } = makeApp();
  const a = await send("/api/grn", { poId: "PO-1" }, { "idempotency-key": "k1", "x-org": "org-a" });
  const b = await send("/api/grn", { poId: "PO-1" }, { "idempotency-key": "k1", "x-org": "org-b" });
  assert.equal(runs(), 2);
  assert.equal(b.headers.get("idempotency-replay"), null);
  assert.notEqual((await a.json()).data.id, (await b.json()).data.id);
});

test("BUG-371: the same key with a different body is 422, not the old response", async () => {
  const { send, runs } = makeApp();
  const h = { "idempotency-key": "k1" };
  await send("/api/grn", { poId: "PO-1" }, h);
  const b = await send("/api/grn", { poId: "PO-2" }, h);
  assert.equal(b.status, 422);
  assert.equal((await b.json()).success, false);
  assert.equal(runs(), 1);
});

test("R10: the path id is part of the key (same key, different CN)", async () => {
  const { send, runs } = makeApp();
  const h = { "idempotency-key": "k1" };
  const a = await send("/api/consignment-notes/CN-1/convert-to-invoice", {}, h);
  const b = await send("/api/consignment-notes/CN-2/convert-to-invoice", {}, h);
  assert.equal(runs(), 2);
  assert.equal((await a.json()).data.cn, "CN-1");
  assert.equal((await b.json()).data.cn, "CN-2");
});

test("R10: 403 and 5xx are not cached, so a retry runs again", async () => {
  for (const status of [403, 500]) {
    const { send, runs, kv } = makeApp({ status });
    const h = { "idempotency-key": "k1" };
    await send("/api/grn", { poId: "PO-1" }, h);
    await send("/api/grn", { poId: "PO-1" }, h);
    assert.equal(runs(), 2, `status ${status}`);
    assert.equal(kv.m.size, 0, `status ${status}`);
  }
});

const TARGETS = [
  ["src/api/routes/delivery-orders.ts", 'app.post("/", idempotent(), async (c) => {'],
  ["src/api/routes/grn.ts", 'app.post("/", idempotent(), async (c) => {'],
  ["src/api/routes/purchase-invoices.ts", 'app.post("/", idempotent(), async (c) => {'],
  ["src/api/routes/consignment-notes.ts", 'app.post("/:id/convert-to-invoice", idempotent(), async (c) => {'],
  ["src/api/routes/purchase-returns.ts", 'app.post("/", idempotent(), async (c) => {'],
  ["src/api/routes/delivery-returns.ts", 'app.post("/", idempotent(), async (c) => {'],
];

for (const [file, route] of TARGETS) {
  test(`R10 wiring: ${file} create route carries idempotent()`, () => {
    const src = readFileSync(file, "utf8");
    assert.ok(src.includes(route), `expected: ${route}`);
    assert.match(src, /import \{ idempotent \} from "\.\.\/lib\/idempotency";/);
  });
}

test("R10: a retry while the first attempt runs gets the in-flight 409", async () => {
  const kv = makeKv();
  let release;
  const gate = new Promise((r) => (release = r));
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("orgId", "org-a");
    await next();
  });
  app.post("/api/grn", idempotent(), async (c) => {
    await gate;
    return c.json({ success: true }, 201);
  });
  const send = () =>
    app.request(
      "/api/grn",
      { method: "POST", headers: { "idempotency-key": "k1" }, body: "{}" },
      { SESSION_CACHE: kv },
    );
  const first = send();
  await new Promise((r) => setTimeout(r, 10));
  const second = await send();
  assert.equal(second.status, 409);
  assert.equal(second.headers.get("idempotency-in-flight"), "true");
  assert.equal((await second.json()).inFlight, true);
  release();
  assert.equal((await first).status, 201);
});

test("R10: a thrown handler (app.onError → 500) clears the marker", async () => {
  const kv = makeKv();
  let runs = 0;
  const app = new Hono();
  app.onError((_e, c) => c.json({ success: false }, 500));
  app.post("/api/grn", idempotent(), async () => {
    runs += 1;
    throw new Error("boom");
  });
  const send = () =>
    app.request(
      "/api/grn",
      { method: "POST", headers: { "idempotency-key": "k1" }, body: "{}" },
      { SESSION_CACHE: kv },
    );
  assert.equal((await send()).status, 500);
  assert.equal((await send()).status, 500);
  assert.equal(runs, 2);
  assert.equal(kv.m.size, 0);
});

// Client half: when the key must survive (the attempt is unresolved).
const { serverAnswered, resultAnswered } = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/idempotency-key.ts")).href
);
const { FetchJsonError } = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/fetch-json.ts")).href
);

test("R10 client: no answer, 5xx and the in-flight 409 keep the key", () => {
  assert.equal(serverAnswered(new FetchJsonError("t", 0, "/api/grn")), false);
  assert.equal(serverAnswered(new FetchJsonError("t", 502, "/api/grn")), false);
  assert.equal(serverAnswered(new FetchJsonError("t", 409, "/api/grn", { inFlight: true })), false);
  assert.equal(serverAnswered(new TypeError("Failed to fetch")), false);
  assert.equal(resultAnswered({ ok: false, status: 0, body: null }), false);
  assert.equal(resultAnswered({ ok: false, status: 409, body: { inFlight: true } }), false);
  assert.equal(
    resultAnswered(new Response("{}", { status: 409, headers: { "idempotency-in-flight": "true" } })),
    false,
  );
  assert.equal(resultAnswered(new Response("{}", { status: 524 })), false);
});

test("R10 client: success and real 4xx answers drop the key", () => {
  assert.equal(serverAnswered(new FetchJsonError("v", 400, "/api/grn")), true);
  assert.equal(serverAnswered(new FetchJsonError("cap", 409, "/api/grn", { error: "over-return" })), true);
  assert.equal(serverAnswered(new FetchJsonError("m", 422, "/api/grn")), true);
  assert.equal(resultAnswered(new Response("{}", { status: 201 })), true);
  assert.equal(resultAnswered(new Response("{}", { status: 409 })), true);
  assert.equal(resultAnswered({ ok: true, status: 201, body: {} }), true);
  assert.equal(resultAnswered({ success: true, data: { id: "DO-1" } }), true);
});

test("R10 client: the PI scan uploads its source PDF once per card", () => {
  const src = readFileSync("src/components/scan-supplier-modal.tsx", "utf8");
  assert.match(src, /let fileId = piSourceFileIds\.current\.get\(card\.id\);/);
});
