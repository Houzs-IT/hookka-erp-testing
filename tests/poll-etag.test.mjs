// P3 (cross-system review 2026-11-10, ported from Houzs#5484, itself from
// Hookka#888): ETag / 304 on every GET list a screen polls. The middleware is
// exercised on a real Hono app; the worker wiring is pinned by source pattern.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import {
  pollEtag,
  pollEtagFor,
  ifNoneMatchHits,
  isPolledListPath,
  POLLED_LIST_PATHS,
} from "../src/api/lib/poll-etag.ts";

const LIST = { success: true, data: Array.from({ length: 200 }, (_, i) => ({ id: `n-${i}`, title: `Row ${i}` })) };

function makeApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("X-Test-User") ?? "u1");
    c.set("orgId", c.req.header("X-Test-Org") ?? "hookka");
    await next();
  });
  app.use("/api/*", pollEtag);
  app.get("/api/notifications", (c) => c.json(LIST));
  app.post("/api/notifications", (c) => c.json(LIST));
  app.get("/api/it-support/tickets/:code", (c) => c.json({ success: false, error: "No" }, 403));
  app.get("/api/presence", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ success: true, data: [] });
  });
  app.get("/api/customers", (c) => c.json(LIST));
  return app;
}

test("first poll: 200 with the unchanged body plus an ETag", async () => {
  const res = await makeApp().request("/api/notifications");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("ETag") ?? "", /^"[0-9a-f]{40}"$/);
  assert.match(res.headers.get("Vary") ?? "", /Authorization/);
  assert.equal(await res.text(), JSON.stringify(LIST));
});

test("unchanged poll with the tag: empty 304 (weak and list forms accepted)", async () => {
  const app = makeApp();
  const tag = (await app.request("/api/notifications")).headers.get("ETag");
  for (const inm of [tag, `W/${tag}`, `"other", ${tag}`]) {
    const res = await app.request("/api/notifications", { headers: { "If-None-Match": inm } });
    assert.equal(res.status, 304, inm);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("ETag"), tag);
  }
  const full = (await app.request("/api/notifications")).headers.get("ETag");
  const bytes = JSON.stringify(LIST).length;
  console.log(`[poll-etag] 200-row list, unchanged poll: body ${bytes} bytes -> 0 (tag ${full.length} bytes)`);
});

test("another user or another org never matches, even with an identical body", async () => {
  const app = makeApp();
  const tag = (await app.request("/api/notifications")).headers.get("ETag");
  const otherUser = await app.request("/api/notifications", { headers: { "If-None-Match": tag, "X-Test-User": "u2" } });
  assert.equal(otherUser.status, 200);
  const otherOrg = await app.request("/api/notifications", { headers: { "If-None-Match": tag, "X-Test-Org": "other" } });
  assert.equal(otherOrg.status, 200);
  assert.equal(await otherOrg.text(), JSON.stringify(LIST));
});

test("left alone: POST, errors, a route's own Cache-Control, paths nobody polls", async () => {
  const app = makeApp();
  const post = await app.request("/api/notifications", { method: "POST" });
  assert.equal(post.headers.get("ETag"), null);
  const err = await app.request("/api/it-support/tickets/IT-1");
  assert.equal(err.status, 403);
  assert.equal(err.headers.get("ETag"), null);
  const own = await app.request("/api/presence");
  assert.equal(own.headers.get("ETag"), null);
  assert.equal(own.headers.get("Cache-Control"), "no-store");
  const other = await app.request("/api/customers");
  assert.equal(other.headers.get("ETag"), null);
});

test("pure helpers", async () => {
  assert.notEqual(await pollEtagFor("[]", "u1|o"), await pollEtagFor("[]", "u2|o"));
  assert.equal(await pollEtagFor("[]", "u1|o"), await pollEtagFor("[]", "u1|o"));
  assert.equal(ifNoneMatchHits(undefined, '"a"'), false);
  assert.equal(ifNoneMatchHits('W/"a"', '"a"'), true);
  assert.equal(ifNoneMatchHits('"b"', '"a"'), false);
  for (const p of [
    "/api/notifications",
    "/api/it-support/unread-count",
    "/api/it-support/tickets",
    "/api/it-support/tickets/IT-0001",
    "/api/presence",
    "/api/scan-queue/batch/b-1",
    "/api/dashboard/prototype",
  ]) assert.ok(isPolledListPath(p), p);
  assert.equal(isPolledListPath("/api/notifications/read-all"), false);
  assert.equal(isPolledListPath("/api/production-orders"), false); // has its own (#888)
});

test("wiring: mounted after auth + tenant, before the first route; every listed path has a GET handler", () => {
  const w = readFileSync("src/api/worker.ts", "utf8");
  const at = w.indexOf('app.use("/api/*", pollEtag);');
  assert.ok(at > 0);
  assert.ok(at > w.indexOf('app.use("/api/*", authMiddleware);'));
  assert.ok(at > w.indexOf('app.use("/api/*", tenantMiddleware);'));
  assert.ok(at < w.indexOf('app.route("/api/notifications", notifications);'));
  assert.ok(at < w.indexOf('app.route("/api/presence", presence);'));
  const handlers = {
    "src/api/routes/notifications.ts": ['app.get("/",'],
    "src/api/routes/it-support.ts": ['app.get("/tickets",', 'app.get("/unread-count",', 'app.get("/tickets/:code",'],
    "src/api/routes/presence.ts": ['app.get("/",'],
    "src/api/routes/scan-queue.ts": ['app.get("/batch/:batchId",'],
    "src/api/routes/dashboard-prototype.ts": ['app.get("/",'],
  };
  for (const [f, needles] of Object.entries(handlers)) {
    const src = readFileSync(f, "utf8");
    for (const n of needles) assert.ok(src.includes(n), `${f} ${n}`);
  }
  assert.equal(POLLED_LIST_PATHS.length, 7);
});
