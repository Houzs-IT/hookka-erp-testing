// ---------------------------------------------------------------------------
// meetings.test.mjs — /api/meetings is a proxy to the Houzs IT Hub's meeting rooms.
//
// What must hold, driven through the real route with the hub and users faked:
//   1. The person is the SESSION's user, described from the users table; nothing
//      in the request changes who books.
//   2. "May change rooms" is decided here (meeting-rooms:update) and refused here.
//   3. A booking conflict (409) reaches the page with its body intact.
//   4. A guest reaches only the hub's /public routes and can send only five fields.
//   5. Not connected / hub down are statuses, never an empty calendar.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

const { default: meetings, publicMeetings, directoryPeople } = await import("../src/api/routes/meetings.ts");

const ENV = { IT_HUB_URL: "https://hub.example/", IT_HUB_API_KEY: "hub_hk_test-key" };
const USERS = { "user-aina": { email: "aina@hookka.test", displayName: "Aina", department: "Sales" } };

const db = { prepare: () => ({ bind: (id) => ({ first: async () => USERS[id] ?? null }) }) };

function appAs(userId, role = "SALES", env = ENV) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    c.set("userRole", role);
    c.set("DB", db);
    await next();
  });
  app.route("/api/meetings", meetings);
  app.route("/api/public/meetings", publicMeetings);
  return { request: (path, init) => app.request(path, init, env) };
}

function fakeHub(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body });
    return answer(String(url), init);
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("the calendar is asked as the session's user, described from the users table", async (t) => {
  const calls = fakeHub(t, () => json({ meetings: [] }));
  const res = await appAs("user-aina").request("/api/meetings/calendar?from=2026-11-23T00:00:00Z&to=2026-11-30T00:00:00Z&reporter=user-boss");
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, "https://hub.example/api/v1/sys/meetings/calendar?from=2026-11-23T00%3A00%3A00Z&to=2026-11-30T00%3A00%3A00Z");
  assert.equal(calls[0].headers.get("Authorization"), "Bearer hub_hk_test-key");
  assert.equal(calls[0].headers.get("X-Reporter-Id"), "user-aina");
  assert.equal(calls[0].headers.get("X-Person-Name"), "Aina");
  assert.equal(calls[0].headers.get("X-Person-Email"), "aina@hookka.test");
  assert.equal(calls[0].headers.get("X-Person-Company"), "Hookka");
  assert.equal(calls[0].headers.get("X-Person-Department"), "Sales");
});

test("an admin may change rooms; a salesperson is refused here, before the hub", async (t) => {
  const calls = fakeHub(t, () => json({ ok: true, id: 1 }, 201));
  const refused = await appAs("user-aina", "SALES").request("/api/meetings/rooms", { method: "POST", body: JSON.stringify({ name: "Boardroom", seats: 12 }), headers: { "Content-Type": "application/json" } });
  assert.equal(refused.status, 403);
  assert.equal(calls.length, 0);
  const ok = await appAs("user-aina", "ADMIN").request("/api/meetings/rooms", { method: "POST", body: JSON.stringify({ name: "Boardroom", seats: 12 }), headers: { "Content-Type": "application/json" } });
  assert.equal(ok.status, 201);
  assert.equal(calls[0].headers.get("X-Can-Manage-Rooms"), "1");
});

test("a booking conflict reaches the page with its whole body", async (t) => {
  const conflict = { error: "conflict", conflict: { room: null, people: [{ key: "ivy@hookka.test", meeting: { id: 3, title: "Supplier call", start: 1, end: 2 } }], rules: [] }, suggestTime: "2026-11-24T07:00:00.000Z", suggestRooms: [] };
  fakeHub(t, () => json(conflict, 409));
  const res = await appAs("user-aina").request("/api/meetings/meetings", { method: "POST", body: JSON.stringify({ title: "x" }), headers: { "Content-Type": "application/json" } });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), conflict);
});

test("a guest sends only the five booking fields, as a guest", async (t) => {
  const calls = fakeHub(t, () => json({ ok: true, token: "a".repeat(64) }, 201));
  const res = await appAs(null).request("/api/public/meetings/links/hk-0123456789/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start: "2026-11-24T02:00:00Z", name: "Mr Lee", phone: "012", email: "lee@example.com", company: "Lee", roomId: 9, host: "boss" }),
  });
  assert.equal(res.status, 201);
  assert.equal(calls[0].url, "https://hub.example/api/v1/sys/meetings/public/links/hk-0123456789/book");
  assert.equal(calls[0].headers.get("X-Reporter-Id"), "guest");
  assert.deepEqual(Object.keys(JSON.parse(calls[0].body)).sort(), ["company", "email", "name", "phone", "start"]);
});

test("a malformed link code never reaches the hub", async (t) => {
  const calls = fakeHub(t, () => json({}));
  const res = await appAs(null).request("/api/public/meetings/links/..%2Fcalendar");
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test("not connected and hub down are statuses, not an empty calendar", async (t) => {
  const off = await appAs("user-aina", "SALES", {}).request("/api/meetings/bootstrap");
  assert.equal(off.status, 503);
  fakeHub(t, () => { throw new Error("connect timeout"); });
  const down = await appAs("user-aina").request("/api/meetings/mine");
  assert.equal(down.status, 502);
});

test("the hub refusing our key is not passed on as the user's session expiring", async (t) => {
  fakeHub(t, () => json({ error: "Invalid API key" }, 401));
  const res = await appAs("user-aina").request("/api/meetings/mine");
  assert.equal(res.status, 502);
});

test("the staff list keeps active users, named, as Hookka", () => {
  const people = directoryPeople([
    { id: "u1", email: "a@hookka.test", displayName: "Aina", department: "Sales", isActive: 1 },
    { id: "u2", email: "b@hookka.test", displayName: null, department: null, isActive: 1 },
    { id: "u3", email: "gone@hookka.test", displayName: "Gone", isActive: 0 },
  ]);
  assert.deepEqual(people, [
    { id: "u1", name: "Aina", email: "a@hookka.test", company: "Hookka", department: "Sales" },
    { id: "u2", name: "b@hookka.test", email: "b@hookka.test", company: "Hookka", department: "" },
  ]);
});
