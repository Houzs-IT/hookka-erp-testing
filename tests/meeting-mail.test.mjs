// ---------------------------------------------------------------------------
// meeting-mail.test.mjs — meeting emails go out through Hookka's Mail Center
// (lib/meeting-mail.ts): collect from the hub with Hookka's key, send each one
// with sendMail, report each result. The hub and the mail provider are faked.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

const { collectAndSend, sendMeetingMail } = await import("../src/api/lib/meeting-mail.ts");
const { default: meetings } = await import("../src/api/routes/meetings.ts");

const MAIL = { id: 7, from: "Hookka Meetings <hello@hookka.com>", to: ["ivy@example.com"], subject: "Invitation: Weekly", html: "<table></table>", text: "Weekly" };

function fake(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const h = new Headers(init.headers);
    calls.push({ url: String(url), auth: h.get("Authorization"), reporter: h.get("X-Reporter-Id"), body: init.body ? JSON.parse(String(init.body)) : null });
    return answer(String(url), init);
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hubWith = (mail, claimStatus = 200) => (url) => (url.endsWith("/mail/claim") ? json({ mail }, claimStatus) : json({ ok: true, updated: 1 }));

test("collects with the hub key, sends each, and reports sent", async (t) => {
  const calls = fake(t, hubWith([MAIL]));
  const sent = [];
  const r = await collectAndSend("https://hub.example", "hub_hk_key", async (m) => (sent.push(m), null));
  assert.deepEqual(r, { sent: 1, failed: 0 });
  assert.deepEqual(sent, [MAIL]);
  assert.deepEqual(calls.map((c) => c.url), ["https://hub.example/api/v1/sys/meetings/mail/claim", "https://hub.example/api/v1/sys/meetings/mail/results"]);
  assert.equal(calls[0].auth, "Bearer hub_hk_key");
  assert.equal(calls[0].reporter, "mail");
  assert.deepEqual(calls[1].body, { results: [{ id: 7, error: null }] });
});

test("a send that fails or throws is reported with its reason, and the rest still go", async (t) => {
  const calls = fake(t, hubWith([MAIL, { ...MAIL, id: 8 }, { ...MAIL, id: 9 }]));
  const r = await collectAndSend("https://hub.example", "k", async (m) => {
    if (m.id === 7) return "sender not verified";
    if (m.id === 8) throw new Error("Brevo answered 401");
    return null;
  });
  assert.deepEqual(r, { sent: 1, failed: 2 });
  assert.deepEqual(calls[1].body, { results: [{ id: 7, error: "sender not verified" }, { id: 8, error: "Brevo answered 401" }, { id: 9, error: null }] });
});

test("the hub refusing the claim is an error, not a silent zero", async (t) => {
  fake(t, hubWith([], 401));
  await assert.rejects(collectAndSend("https://hub.example", "k", async () => null), /401/);
});

test("sends through Hookka's own provider, from the address the hub chose", async (t) => {
  const calls = fake(t, (url) => (url.includes("hub.example") ? hubWith([MAIL])(url) : json({ messageId: "m1" }, 201)));
  const r = await sendMeetingMail({ IT_HUB_URL: "https://hub.example/", IT_HUB_API_KEY: "hub_hk_key", BREVO_API_KEY: "brevo_test" });
  assert.deepEqual(r, { sent: 1, failed: 0 });
  const provider = calls.find((c) => c.url.includes("brevo.com"));
  assert.ok(provider, "the email went to Hookka's provider");
  assert.match(JSON.stringify(provider.body), /hello@hookka\.com/);
  assert.match(JSON.stringify(provider.body), /ivy@example\.com/);
  const none = fake(t, () => json({}));
  assert.deepEqual(await sendMeetingMail({ IT_HUB_API_KEY: "k" }), { sent: 0, failed: 0 });
  assert.equal(none.length, 0);
});

test("a booking made here then sends its emails; a refused one does not", async (t) => {
  const users = { prepare: () => ({ bind: () => ({ first: async () => ({ email: "aina@hookka.test", displayName: "Aina" }) }) }) };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("userId", "user-aina"); c.set("userRole", "SUPER_ADMIN"); c.set("DB", users); await next(); });
  app.route("/api/meetings", meetings);
  const ENV = { IT_HUB_URL: "https://hub.example/", IT_HUB_API_KEY: "hub_hk_key" };
  const post = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Weekly" }) };
  const calls = fake(t, (url) => (url.endsWith("/mail/claim") ? json({ mail: [] }) : json({ ok: true, ids: [5] }, 201)));
  const res = await app.request("/api/meetings/meetings", post, ENV);
  assert.equal(res.status, 201);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.some((c) => c.url.endsWith("/mail/claim")), "the booking collected Hookka's emails");
  const refused = fake(t, () => json({ error: "Room is busy" }, 409));
  await app.request("/api/meetings/meetings", post, ENV);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!refused.some((c) => c.url.endsWith("/mail/claim")), "a refused booking sends nothing");
});
