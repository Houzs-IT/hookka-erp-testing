// ---------------------------------------------------------------------------
// it-support.test.mjs — /api/it-support is a proxy to the Houzs IT Hub.
//
// What must hold (behaviour, driven through the real route with the hub and
// the users table faked):
//   1. The reporter is the SESSION's user. Nothing in the request can change
//      whose tickets are read or who a new ticket is filed as.
//   2. The hub key goes to the hub and nowhere else.
//   3. "Could not ask the hub" is never reported as "you have no tickets".
//      This system has had failures answer `{success: true, data: []}` before
//      (RBAC-REMEDIATION.md, the loop, step 3); every failure here is asserted
//      by STATUS, not by emptiness.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";

const { default: itSupport } = await import("../src/api/routes/it-support.ts");

const ENV = { IT_HUB_URL: "https://hub.example/", IT_HUB_API_KEY: "hub_hk_test-key" };
const USERS = {
  "user-aina": { email: "aina@hookka.test", displayName: "Aina", department: "Sales" },
  "user-noname": { email: "noname@hookka.test", displayName: null, department: null },
};

/** A D1-shaped users table. `withDepartment: false` models a database where
 *  the users.department self-apply has never run. */
function makeDb({ withDepartment = true } = {}) {
  return {
    prepare(sql) {
      if (!withDepartment && /department/.test(sql)) throw new Error('column "department" does not exist');
      return { bind: (id) => ({ first: async () => USERS[id] ?? null }) };
    },
  };
}

/** Mounts the route the way worker.ts does, behind a stand-in for authMiddleware. */
function appAs(userId, { env = ENV, db = makeDb() } = {}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    c.set("DB", db);
    await next();
  });
  app.route("/api/it-support", itSupport);
  return { request: (path, init) => app.request(path, init, env) };
}

/** Replaces global fetch for one test and records what the hub was asked. */
function fakeHub(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), method: init.method ?? "GET", headers, body: init.body });
    return answer(String(url), init);
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("my tickets: asks the hub as the session's user, with the key", async (t) => {
  const calls = fakeHub(t, () => json({ tickets: [{ code: "HK-0001", unread: true }] }));
  const res = await appAs("user-aina").request("/api/it-support/tickets?status=open,bogus,resolved");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, data: { tickets: [{ code: "HK-0001", unread: true }] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hub.example/api/v1/sys/tickets?status=open,resolved");
  assert.equal(calls[0].headers.get("Authorization"), "Bearer hub_hk_test-key");
  assert.equal(calls[0].headers.get("X-Reporter-Id"), "user-aina");
});

test("the reporter cannot be chosen by the request", async (t) => {
  const calls = fakeHub(t, () => json({ tickets: [] }));
  await appAs("user-aina").request("/api/it-support/tickets?userId=user-boss&reporter_id=user-boss", {
    headers: { "X-Reporter-Id": "user-boss" },
  });
  assert.equal(calls[0].headers.get("X-Reporter-Id"), "user-aina");
  assert.doesNotMatch(calls[0].url, /user-boss/);
});

test("no session: 401 and the hub is never called", async (t) => {
  const calls = fakeHub(t, () => json({}));
  const app = appAs(null);
  for (const [path, method] of [
    ["/api/it-support/tickets", "GET"],
    ["/api/it-support/unread-count", "GET"],
    ["/api/it-support/tickets/HK-0001", "GET"],
    ["/api/it-support/tickets", "POST"],
    ["/api/it-support/tickets/HK-0001/replies", "POST"],
    ["/api/it-support/tickets/HK-0001/confirm", "POST"],
    ["/api/it-support/attachments/1", "GET"],
  ]) {
    const res = await app.request(path, { method });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  assert.equal(calls.length, 0);
});

test("not connected: 503, not an empty list", async (t) => {
  const calls = fakeHub(t, () => json({ tickets: [] }));
  for (const env of [{}, { IT_HUB_URL: "https://hub.example" }, { IT_HUB_API_KEY: "k" }, { IT_HUB_URL: " ", IT_HUB_API_KEY: "k" }]) {
    const res = await appAs("user-aina", { env }).request("/api/it-support/tickets");
    assert.equal(res.status, 503);
    assert.equal((await res.json()).success, false);
  }
  assert.equal(calls.length, 0);
});

test("hub down, or refusing our key: 502, never 401 and never success", async (t) => {
  let mode = "throw";
  fakeHub(t, () => {
    if (mode === "throw") throw new Error("connect ETIMEDOUT");
    if (mode === "badkey") return json({ error: "Invalid API key" }, 401);
    if (mode === "html") return new Response("<html>502</html>", { status: 502 });
    return json({ error: "boom" }, 500);
  });
  const app = appAs("user-aina");
  for (mode of ["throw", "badkey", "html", "500"]) {
    for (const path of ["/api/it-support/tickets", "/api/it-support/unread-count"]) {
      const res = await app.request(path);
      assert.equal(res.status, 502, `${mode} ${path}`);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.doesNotMatch(JSON.stringify(body), /Invalid API key|boom|ETIMEDOUT/);
    }
  }
});

test("the hub's own refusals reach the reporter with their wording", async (t) => {
  fakeHub(t, (url) =>
    url.endsWith("/confirm")
      ? json({ error: "Only a resolved ticket can be confirmed" }, 409)
      : json({ error: "Not found" }, 404));
  const app = appAs("user-aina");
  const confirm = await app.request("/api/it-support/tickets/HK-0002/confirm", { method: "POST" });
  assert.equal(confirm.status, 409);
  assert.equal((await confirm.json()).error, "Only a resolved ticket can be confirmed");
  const missing = await app.request("/api/it-support/tickets/HK-0999");
  assert.equal(missing.status, 404);
});

test("report an issue: reporter fields come from the users table, not the form", async (t) => {
  const calls = fakeHub(t, () => json({ code: "HK-0007", status: "open", created_at: "2026-10-12T08:00:00.000Z" }, 201));
  const form = new FormData();
  form.set("title", "  Sales order page is blank  ");
  form.set("description", "After saving");
  form.set("type", "bug");
  form.set("priority", "high");
  form.set("page_url", "https://erp.hookka.com/sales");
  form.set("reporter_name", "The Boss");
  form.set("reporter_email", "boss@hookka.test");
  form.set("reporter_department", "Board");
  form.set("user_agent", "forged");
  form.set("legacy_code", "DEV-1");
  form.append("files", new File(["png-bytes"], "shot.png", { type: "image/png" }));
  form.append("files", new File([], "empty.png", { type: "image/png" }));

  const res = await appAs("user-aina").request("/api/it-support/tickets", {
    method: "POST", body: form, headers: { "User-Agent": "Mozilla/Test" },
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).data.code, "HK-0007");

  const sent = calls[0].body;
  assert.ok(sent instanceof FormData);
  assert.equal(calls[0].url, "https://hub.example/api/v1/sys/tickets");
  assert.equal(calls[0].headers.get("X-Reporter-Id"), "user-aina");
  assert.equal(sent.get("title"), "Sales order page is blank");
  assert.equal(sent.get("priority"), "high");
  assert.equal(sent.get("page_url"), "https://erp.hookka.com/sales");
  assert.equal(sent.get("reporter_name"), "Aina");
  assert.equal(sent.get("reporter_email"), "aina@hookka.test");
  assert.equal(sent.get("reporter_department"), "Sales");
  assert.equal(sent.get("user_agent"), "Mozilla/Test");
  assert.equal(sent.get("legacy_code"), null, "only the listed fields are forwarded");
  const files = sent.getAll("files");
  assert.equal(files.length, 1, "an empty file part is dropped");
  assert.equal(files[0].name, "shot.png");
  assert.equal(await files[0].text(), "png-bytes");
});

test("report an issue: JSON body works, a blank title is refused before the hub", async (t) => {
  const calls = fakeHub(t, () => json({ code: "HK-0008", status: "open" }, 201));
  const app = appAs("user-aina");
  const blank = await app.request("/api/it-support/tickets", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "   " }),
  });
  assert.equal(blank.status, 400);
  const garbage = await app.request("/api/it-support/tickets", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json",
  });
  assert.equal(garbage.status, 400);
  assert.equal(calls.length, 0);

  const ok = await app.request("/api/it-support/tickets", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Printer" }),
  });
  assert.equal(ok.status, 201);
  assert.equal(calls[0].body.get("title"), "Printer");
});

test("reporter name falls back to the email, and survives a users table without department", async (t) => {
  const calls = fakeHub(t, () => json({ code: "HK-0009", status: "open" }, 201));
  const send = (userId, db) =>
    appAs(userId, { db }).request("/api/it-support/tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x" }),
    });
  assert.equal((await send("user-noname", makeDb())).status, 201);
  assert.equal(calls[0].body.get("reporter_name"), "noname@hookka.test");
  assert.equal(calls[0].body.get("reporter_department"), null);

  assert.equal((await send("user-aina", makeDb({ withDepartment: false }))).status, 201);
  assert.equal(calls[1].body.get("reporter_name"), "Aina");
});

test("reply: needs text or a file; forwards both", async (t) => {
  const calls = fakeHub(t, () => json({ ok: true, status: "in_progress" }, 201));
  const app = appAs("user-aina");
  const empty = await app.request("/api/it-support/tickets/HK-0001/replies", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "  " }),
  });
  assert.equal(empty.status, 400);
  assert.equal(calls.length, 0);

  const form = new FormData();
  form.set("body", "Still broken");
  form.append("files", new File(["x"], "again.png", { type: "image/png" }));
  const res = await app.request("/api/it-support/tickets/HK-0001/replies", { method: "POST", body: form });
  assert.equal(res.status, 201);
  assert.equal(calls[0].url, "https://hub.example/api/v1/sys/tickets/HK-0001/replies");
  assert.equal(calls[0].body.get("body"), "Still broken");
  assert.equal(calls[0].body.getAll("files").length, 1);
});

test("a ticket code or attachment id that is not one never reaches the hub", async (t) => {
  const calls = fakeHub(t, () => json({}));
  const app = appAs("user-aina");
  for (const [path, method] of [
    ["/api/it-support/tickets/..%2F..%2Fdev%2Ftickets", "GET"],
    ["/api/it-support/tickets/hk-0001", "GET"],
    ["/api/it-support/tickets/HK-0001%3Fx=1/confirm", "POST"],
    ["/api/it-support/tickets/unread-count/replies", "POST"],
    ["/api/it-support/attachments/1%2F..%2F2", "GET"],
    ["/api/it-support/attachments/abc", "GET"],
  ]) {
    const res = await app.request(path, { method });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  assert.equal(calls.length, 0);
});

test("attachment: bytes and type pass through, a hub failure does not", async (t) => {
  let mode = "ok";
  const calls = fakeHub(t, () => {
    if (mode === "ok") {
      return new Response("png-bytes", {
        headers: { "Content-Type": "image/png", "Content-Disposition": 'inline; filename="shot.png"', "Set-Cookie": "x=1" },
      });
    }
    if (mode === "404") return json({ error: "Not found" }, 404);
    return json({ error: "Invalid API key" }, 401);
  });
  const app = appAs("user-aina");
  const ok = await app.request("/api/it-support/attachments/12");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "image/png");
  assert.equal(ok.headers.get("Content-Disposition"), 'inline; filename="shot.png"');
  assert.equal(ok.headers.get("Set-Cookie"), null);
  assert.equal(await ok.text(), "png-bytes");
  assert.equal(calls[0].headers.get("X-Reporter-Id"), "user-aina");

  mode = "404";
  assert.equal((await app.request("/api/it-support/attachments/12")).status, 404);
  mode = "badkey";
  assert.equal((await app.request("/api/it-support/attachments/12")).status, 502);
});

test("the hub key is read from the environment and appears in no response", async (t) => {
  fakeHub(t, () => json({ error: "nope", echoed: "hub_hk_test-key" }, 500));
  const res = await appAs("user-aina").request("/api/it-support/tickets");
  assert.doesNotMatch(await res.text(), /hub_hk_test-key/);

  const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");
  const src = read("src/api/routes/it-support.ts");
  assert.match(src, /c\.env\.IT_HUB_API_KEY/);
  assert.doesNotMatch(src, /hub_[a-z0-9]+_[A-Za-z0-9_-]{20,}/, "no key literal in the route");
  // The page talks to /api/it-support only; it never learns the hub's address.
  const page = read("src/pages/it-support/index.tsx");
  assert.doesNotMatch(page, /IT_HUB|houzscentury|api\/v1\/sys/);
});

test("every handler takes the reporter from the session", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/it-support.ts"), "utf8");
  const handlers = [...src.matchAll(/^app\.(get|post|put|patch|delete)\("([^"]+)"/gm)];
  assert.equal(handlers.length, 7);
  for (let i = 0; i < handlers.length; i++) {
    const body = src.slice(handlers[i].index, handlers[i + 1]?.index ?? src.length);
    assert.match(body, /const hub = hubFor\(c\);\s*if \(hub instanceof Response\) return hub;/, `${handlers[i][1]} ${handlers[i][2]}`);
  }
  assert.doesNotMatch(src, /c\.req\.(query|param|header)\("(userId|reporterId|X-Reporter-Id)"\)/i);
});
