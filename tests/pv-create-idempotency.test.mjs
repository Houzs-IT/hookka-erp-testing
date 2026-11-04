// ---------------------------------------------------------------------------
// pv-create-idempotency.test.mjs — POST /api/accounting/payment-vouchers is safe to retry and refuses a duplicate bill.
//
// The gap (measured 2026-11-04, accounting.ts): the voucher create had no Idempotency-Key handling (GRN / PI create do) and no
// duplicate-bill guard, so a retry after a lost response, or a bill scanned twice, made a second voucher. Now:
//   · a request carrying an Idempotency-Key is replayed from the first answer (withIdempotency, same wrapper as GRN / PI);
//   · a live voucher with the same payee + bill number refuses a second one (409, names the voucher), ignoring case, spacing,
//     punctuation and bills merged on one voucher; a cancelled voucher does not count; no bill number = no check;
//   · an unexpected failure answers 500 (was 400), so a transient database error is NOT cached for 24 h under the key.
// The REAL route handler runs here, over an in-memory stand-in for the database that understands only the statements this path
// issues, and a stand-in for the KV cache. That proves the handler's logic and the values it binds. It does NOT prove Postgres
// accepts the SQL (the duplicate check is one plain SELECT) — nothing here touches a real database.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import accountingApp from "../src/api/routes/accounting.ts";

const lc = (s) => String(s).toLowerCase();
const col = (row, name) => { const k = Object.keys(row).find((x) => lc(x) === lc(name)); return k === undefined ? undefined : row[k]; };

class FakeDb {
  constructor() {
    this.t = { payment_vouchers: [], payment_voucher_lines: [], chart_of_accounts: [
      { code: "300-0001", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
      { code: "900-0100", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
    ] };
    this.failBatch = 0;
  }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    if (this.failBatch > 0) { this.failBatch--; throw new Error("connection reset"); }
    const snap = JSON.stringify(this.t);
    try { const out = []; for (const s of stmts) out.push(await s.run()); return out; } catch (e) { this.t = JSON.parse(snap); throw e; }
  }
}
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    const t = this.db.t; const sql = this.sql; let m;
    if (/^(alter|create|drop|comment) /i.test(sql) || /^update payment_vouchers set approval_state/i.test(sql)) return { rows: [], changes: 0 };
    if (/from chart_of_accounts/i.test(sql) && /EXISTS/i.test(sql)) return { rows: t.chart_of_accounts.map((a) => ({ ...a })), changes: 0 };
    if (/^select \* from payment_vouchers where status <> 'VOID'$/i.test(sql)) {
      return { rows: t.payment_vouchers.filter((r) => r.status !== "VOID").map((r) => ({ ...r })), changes: 0 };
    }
    if ((m = /^select (.+?) from payment_vouchers where id = \?$/i.exec(sql))) return { rows: t.payment_vouchers.filter((r) => r.id === this.p[0]), changes: 0 };
    if ((m = /^insert into (\w+) \((.+?)\) values \((.+)\)$/i.exec(sql))) {
      // VALUES mixes `?` placeholders with literals (NULL, 0): walk the tokens so each column gets its own value.
      const cols = m[2].split(",").map((s) => s.trim());
      const toks = m[3].split(",").map((s) => s.trim());
      let pi = 0;
      const row = {};
      cols.forEach((c, i) => { const tk = toks[i]; row[c] = tk === "?" ? this.p[pi++] : /^null$/i.test(tk) ? null : /^-?\d+$/.test(tk) ? Number(tk) : tk; });
      (t[lc(m[1])] ??= []).push(row);
      return { rows: [], changes: 1 };
    }
    return { rows: [], changes: 0 }; // read-only lookups (audit snapshot, actor name) answered empty
  }
  async first() { return this._exec().rows[0] ?? null; }
  async all() { return { results: this._exec().rows }; }
  async run() { const r = this._exec(); return { success: true, meta: { changes: r.changes } }; }
}
class FakeKv {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

function harness() {
  const db = new FakeDb();
  const kv = new FakeKv();
  const root = new Hono();
  root.use("*", async (c, next) => { c.set("DB", db); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "u1"); c.set("orgId", "org-1"); await next(); });
  root.route("/", accountingApp);
  const post = async (body, key) => {
    const res = await root.request("/payment-vouchers", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) }, { SESSION_CACHE: kv });
    return { status: res.status, replay: res.headers.get("idempotency-replay"), json: await res.json() };
  };
  return { db, kv, post };
}
const body = (over = {}) => ({ date: "2026-11-04", payee: "Tenaga Nasional Berhad", description: "INVOICE", billNo: "TNB-88", accrued: false, payFrom: "300-0001", saveAs: "draft", lines: [{ accountCode: "900-0100", description: "Power", amountSen: 12000 }], ...over });

test("a create with an Idempotency-Key is replayed on retry: one voucher, the same answer", async () => {
  const h = harness();
  const a = await h.post(body(), "key-1");
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const b = await h.post(body(), "key-1");
  assert.equal(b.status, 201);
  assert.equal(b.replay, "true", "answered from the cache, not by running the handler again");
  assert.equal(b.json.data.id, a.json.data.id);
  assert.equal(h.db.t.payment_vouchers.length, 1);
  assert.equal(h.db.t.payment_voucher_lines.length, 1);
});

test("a different key (a different attempt) is not a replay", async () => {
  const h = harness();
  assert.equal((await h.post(body(), "key-1")).status, 201);
  const second = await h.post(body({ billNo: "TNB-89" }), "key-2");
  assert.equal(second.status, 201);
  assert.equal(h.db.t.payment_vouchers.length, 2);
});

test("with NO key, a second voucher for the same payee + bill number is refused (409) and names the first", async () => {
  const h = harness();
  const a = await h.post(body());
  const b = await h.post(body());
  assert.equal(b.status, 409);
  assert.equal(b.json.duplicateOf, a.json.data.id);
  assert.match(b.json.error, /already on a draft voucher/);
  assert.equal(h.db.t.payment_vouchers.length, 1, "nothing was written");
});

test("the duplicate check ignores case, spacing and punctuation, and sees a bill merged with others on one voucher", async () => {
  const h = harness();
  await h.post(body({ billNo: "TNB-88, TNB-99" }));
  assert.equal((await h.post(body({ payee: "TENAGA  NASIONAL BERHAD", billNo: "tnb 99" }))).status, 409);
  assert.equal((await h.post(body({ billNo: "TNB-88" }))).status, 409);
  assert.equal((await h.post(body({ billNo: "TNB-100" }))).status, 201, "a different number is fine");
});

test("another payee with the same bill number, a cancelled voucher, or no bill number are not duplicates", async () => {
  const h = harness();
  const first = await h.post(body());
  assert.equal((await h.post(body({ payee: "Syarikat Air" }))).status, 201, "bill numbers are only unique per payee");
  h.db.t.payment_vouchers.find((r) => r.id === first.json.data.id).status = "VOID";
  assert.equal((await h.post(body())).status, 201, "a cancelled voucher does not block");
  assert.equal((await h.post(body({ billNo: "" }))).status, 201);
  assert.equal((await h.post(body({ billNo: "" }))).status, 201, "no bill number, no check");
});

test("an unexpected failure answers 500 and is NOT cached under the key: the retry runs and succeeds", async () => {
  const h = harness();
  h.db.failBatch = 1;
  const a = await h.post(body(), "key-x");
  assert.equal(a.status, 500, JSON.stringify(a.json));
  assert.equal(a.json.success, false);
  assert.equal(h.db.t.payment_vouchers.length, 0);
  const b = await h.post(body(), "key-x");
  assert.equal(b.status, 201, "a transient failure was not replayed to the retry");
  assert.equal(b.replay, null);
  assert.equal(h.db.t.payment_vouchers.length, 1);
});

test("a refused duplicate (409) under a key is replayed as the same refusal, not retried into a second voucher", async () => {
  const h = harness();
  await h.post(body());
  const a = await h.post(body(), "key-d");
  const b = await h.post(body(), "key-d");
  assert.deepEqual([a.status, b.status], [409, 409]);
  assert.equal(h.db.t.payment_vouchers.length, 1);
});

test("source: the create is wrapped in withIdempotency, the guard is on the expense path (not AP / transfer), the phone sends the key", () => {
  const src = readFileSync(new URL("../src/api/routes/accounting.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const create = src.slice(src.indexOf('app.post("/payment-vouchers", async'), src.indexOf("/** A live (not cancelled) voucher with this payee"));
  assert.match(create, /withIdempotency\(c, "payment-vouchers", idemKey/);
  assert.match(create, /if \(!isTransfer && extra\.billNo/);
  assert.ok(create.indexOf("findPvDuplicateBill") > create.indexOf("PV_KIND_AP"), "the AP branch returns before the guard");
  const sheet = readFileSync(new URL("../src/pages/m/screens/finance/ScanPvSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /"Idempotency-Key": key/);
});
