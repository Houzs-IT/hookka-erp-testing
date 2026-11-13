// HK-0150 (switch to Cloudflare Email Routing): each copy of a mail is filed
// under the box it was delivered to, and dedup is per box, so a mail to two
// staff (or a Bcc) reaches each person's own Mail Center view.
// Runs the real ingestInboundEmail against an in-memory SQLite database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ensureMailSchema, ingestInboundEmail } from "../src/api/routes/mail-center.ts";

// Minimal D1-shaped adapter. ensureMailSchema's Postgres-only statements
// (ADD COLUMN IF NOT EXISTS) fail here and are swallowed by its own try/catch.
// It runs once per process (module flag), so later databases copy its tables.
let schema = null;
function fakeD1() {
  const sql = new DatabaseSync(":memory:");
  for (const s of schema ?? []) sql.exec(s);
  return {
    sql,
    prepare(q) {
      const stmt = sql.prepare(q);
      const bound = (args) => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => stmt.run(...args),
        all: async () => ({ results: stmt.all(...args) }),
      });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
  };
}

{
  const err = console.error;
  console.error = () => {};
  const base = fakeD1();
  await ensureMailSchema(base);
  console.error = err;
  schema = base.sql
    .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
    .all()
    .map((r) => r.sql);
}

const threads = (db) =>
  db.sql
    .prepare(
      `SELECT t.mailbox_address AS box, COUNT(m.id) AS n FROM email_threads t
         JOIN email_messages m ON m.thread_id = t.id GROUP BY t.id ORDER BY box`,
    )
    .all()
    .map((r) => `${r.box}:${r.n}`);

const quiet = (fn) => async () => {
  const err = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = err;
  }
};

const po = {
  from: "sim@houzscentury.com",
  to: ["siti@hookka.com"],
  cc: ["lim@hookka.com"],
  subject: "PO2611-188",
  text: "PO attached",
  messageId: "<po-188@houzscentury.com>",
};

test(
  "a mail to two staff gives each of them a copy; a repeat delivery is still deduped",
  quiet(async () => {
    const db = fakeD1();
    const a = await ingestInboundEmail(db, { ...po, deliveredTo: "siti@hookka.com" });
    const b = await ingestInboundEmail(db, { ...po, deliveredTo: "LIM@hookka.com" });
    const again = await ingestInboundEmail(db, { ...po, deliveredTo: "siti@hookka.com" });
    assert.equal(a.ok && b.ok && again.ok, true);
    assert.notEqual(a.threadId, b.threadId);
    assert.equal(again.deduped, true);
    assert.deepEqual(threads(db), ["lim@hookka.com:1", "siti@hookka.com:1"]);
  }),
);

test(
  "a Bcc'd mail is filed under the box it was delivered to, not the To: address",
  quiet(async () => {
    const db = fakeD1();
    await ingestInboundEmail(db, {
      ...po,
      to: ["buyer@example.com"],
      cc: [],
      deliveredTo: "siti@hookka.com",
    });
    assert.deepEqual(threads(db), ["siti@hookka.com:1"]);
  }),
);

test(
  "a reply joins the thread in its own box only",
  quiet(async () => {
    const db = fakeD1();
    await ingestInboundEmail(db, { ...po, deliveredTo: "siti@hookka.com" });
    await ingestInboundEmail(db, { ...po, deliveredTo: "lim@hookka.com" });
    const reply = {
      ...po,
      subject: "Re: PO2611-188",
      messageId: "<po-188-re@houzscentury.com>",
      inReplyTo: "<po-188@houzscentury.com>",
    };
    await ingestInboundEmail(db, { ...reply, deliveredTo: "siti@hookka.com" });
    await ingestInboundEmail(db, { ...reply, deliveredTo: "lim@hookka.com" });
    assert.deepEqual(threads(db), ["lim@hookka.com:2", "siti@hookka.com:2"]);
  }),
);

test(
  "without deliveredTo the old rule stands: first @hookka.com recipient",
  quiet(async () => {
    const db = fakeD1();
    await ingestInboundEmail(db, { ...po, to: ["buyer@example.com", "siti@hookka.com"] });
    assert.deepEqual(threads(db), ["siti@hookka.com:1"]);
  }),
);

test("both senders pass the delivered-to box; the worker deploys to the hookka.com account", () => {
  assert.match(
    readFileSync("mail-inbound-worker/src/index.ts", "utf8"),
    /deliveredTo: message\.to/,
  );
  assert.match(readFileSync("mail-sync/sync.mjs", "utf8"), /deliveredTo: sourceMailbox/);
  assert.match(
    readFileSync("mail-inbound-worker/wrangler.toml", "utf8"),
    /^account_id = "27cd35c9d93a9f81daa809d0b800b059"/m,
  );
});
