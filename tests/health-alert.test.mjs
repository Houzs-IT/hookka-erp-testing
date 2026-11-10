// P4 (cross-system review 2026-11-10, ported from Conts#420 / #424): email
// management when System Health turns red — once per problem after two red
// checks in a row, plus a "working again" email. Nothing here sends mail: the
// sender is a recorder and the database is an in-memory kv_config.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  stepHealthAlert,
  parseRecipientList,
  runHealthAlertCheck,
  healthAlertEmail,
  HEALTH_ALERT_STATE_KEY,
  HEALTH_ALERT_RECIPIENTS_KEY,
  HEALTH_ALERT_FALLBACK_RECIPIENTS_KEY,
} from "../src/api/lib/health-alert.ts";
import { computeHealthStatus } from "../src/lib/health-status.ts";

function fakeDb(initial = {}) {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    prepare(sql) {
      return {
        bind(...v) {
          return {
            async first() {
              assert.match(sql, /SELECT value FROM kv_config WHERE key = \?/);
              return kv.has(v[0]) ? { value: kv.get(v[0]) } : null;
            },
            async run() {
              assert.match(sql, /INSERT INTO kv_config/);
              kv.set(v[0], v[1]);
            },
          };
        },
      };
    },
  };
}

const RED = { live: true, status: { tone: "red", detail: "14 server errors" } };
const GREEN = { live: true, status: { tone: "green", detail: "" } };
const AMBER = { live: true, status: { tone: "amber", detail: "3 server errors" } };

async function run(db, sequence) {
  const sent = [];
  let i = 0;
  const out = [];
  for (const m of sequence) {
    i += 1;
    out.push(
      await runHealthAlertCheck({
        db,
        measure: async () => m,
        send: async (to, mail) => sent.push({ to, subject: mail.subject, text: mail.text }),
        pageUrl: "https://erp.example/admin/health",
        now: () => `2026-11-10T0${i}:00:00.000Z`,
      }),
    );
  }
  return { sent, out };
}

test("step: first red check is quiet, the second alerts, later ones stay quiet", () => {
  const a = stepHealthAlert(null, true, "t1");
  assert.equal(a.send, null);
  const b = stepHealthAlert(a.next, true, "t2");
  assert.equal(b.send, "alert");
  assert.equal(b.next.since, "t1");
  const c = stepHealthAlert(b.next, true, "t3");
  assert.equal(c.send, null);
  const d = stepHealthAlert(c.next, false, "t4");
  assert.equal(d.send, "recovered");
  assert.equal(stepHealthAlert(d.next, false, "t5").send, null);
});

test("step: a single red blip clears without any email", () => {
  const a = stepHealthAlert(null, true, "t1");
  const b = stepHealthAlert(a.next, false, "t2");
  assert.equal(b.send, null);
});

test("red twice -> one alert to every recipient; green -> one working-again email", async () => {
  const db = fakeDb({ [HEALTH_ALERT_RECIPIENTS_KEY]: JSON.stringify(["boss@example.com", "it@example.com"]) });
  const { sent } = await run(db, [RED, RED, RED, GREEN, GREEN]);
  assert.deepEqual(
    sent.map((s) => `${s.to} ${s.subject}`),
    [
      "boss@example.com Hookka ERP: System Health is red",
      "it@example.com Hookka ERP: System Health is red",
      "boss@example.com Hookka ERP: System Health is working again",
      "it@example.com Hookka ERP: System Health is working again",
    ],
  );
  assert.match(sent[0].text, /14 server errors/);
  assert.match(sent[0].text, /since 10\/11 09:00 \(Malaysia time\)/);
  assert.equal(JSON.parse(db.kv.get(HEALTH_ALERT_STATE_KEY)).red, false);
});

test("amber is not red", async () => {
  const db = fakeDb({ [HEALTH_ALERT_RECIPIENTS_KEY]: "boss@example.com" });
  const { sent } = await run(db, [AMBER, AMBER, AMBER]);
  assert.equal(sent.length, 0);
});

test("no recipient set anywhere -> nothing is sent", async () => {
  const db = fakeDb();
  const { sent, out } = await run(db, [RED, RED]);
  assert.equal(sent.length, 0);
  assert.equal(out[1].sent, "alert");
  assert.equal(out[1].recipients, 0);
});

test("falls back to the owner-set daily-report list, never to anyone else", async () => {
  const db = fakeDb({ [HEALTH_ALERT_FALLBACK_RECIPIENTS_KEY]: JSON.stringify({ value: ["owner@example.com"] }) });
  const { sent } = await run(db, [RED, RED]);
  assert.deepEqual(sent.map((s) => s.to), ["owner@example.com"]);
});

test("no live metrics (mock / not wired) -> no state change, no email", async () => {
  const db = fakeDb({ [HEALTH_ALERT_RECIPIENTS_KEY]: "boss@example.com" });
  const { sent, out } = await run(db, [RED, { live: false, reason: "metrics are mock" }, RED]);
  assert.equal(out[1].checked, false);
  // The two reds are still consecutive checks: the unmeasured one changes nothing.
  assert.equal(sent.length, 1);
});

test("a failing measurement never throws", async () => {
  const out = await runHealthAlertCheck({
    db: fakeDb(),
    measure: async () => {
      throw new Error("boom");
    },
    send: async () => assert.fail("must not send"),
    pageUrl: "x",
  });
  assert.equal(out.checked, false);
});

test("recipient parsing accepts every stored shape and drops junk", () => {
  assert.deepEqual(parseRecipientList('["a@x.com","bad"]'), ["a@x.com"]);
  assert.deepEqual(parseRecipientList('{"value":["a@x.com"]}'), ["a@x.com"]);
  assert.deepEqual(parseRecipientList("a@x.com, b@x.com\nb@x.com"), ["a@x.com", "b@x.com"]);
  assert.deepEqual(parseRecipientList(""), []);
  assert.deepEqual(parseRecipientList(null), []);
});

test("email escapes the detail and links the page", () => {
  const m = healthAlertEmail("alert", { since: "2026-11-10T00:00:00Z", detail: "<b>x</b>" }, "2026-11-10T00:10:00Z", "https://e/admin/health");
  assert.doesNotMatch(m.html, /<b>x<\/b>/);
  assert.match(m.html, /<a href="https:\/\/e\/admin\/health">/);
});

test("the page banner and the email read the same verdict", () => {
  const base = { p50: 100, p95: 300, longTaskCount: 10, cacheHitRatio: 0.5, fiveXX: 0, feErrCount: 0 };
  assert.equal(computeHealthStatus(base).tone, "green");
  assert.equal(computeHealthStatus({ ...base, fiveXX: 3 }).tone, "amber");
  assert.equal(computeHealthStatus({ ...base, fiveXX: 11 }).tone, "red");
  assert.equal(computeHealthStatus({ ...base, p95: 2000 }).tone, "red");
  const page = readFileSync("src/pages/admin/health.tsx", "utf8");
  assert.match(page, /return computeHealthStatus\(\{/);
  assert.doesNotMatch(page, /const critical =/);
});

test("wiring: rides the outbox drain before the drain runs, via enqueueEmail", () => {
  const w = readFileSync("src/api/worker.ts", "utf8");
  const handler = w.slice(w.indexOf('app.post("/api/internal/process-email-outbox"'));
  const check = handler.indexOf("runHealthAlertCheck({");
  const drain = handler.indexOf("await processOutbox(");
  assert.ok(check > 0 && drain > check);
  assert.match(handler.slice(check, drain), /measure: \(\) => measureHealthBanner\(c\.env\)/);
  assert.match(handler.slice(check, drain), /enqueueEmail\(c, \{ to, subject: mail\.subject/);
  const ah = readFileSync("src/api/routes/admin-health.ts", "utf8");
  assert.match(ah, /export async function measureHealthBanner/);
  assert.match(ah, /if \(kpis\._mock\) return \{ live: false/);
});
