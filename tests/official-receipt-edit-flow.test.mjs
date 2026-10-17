// ---------------------------------------------------------------------------
// official-receipt-edit-flow.test.mjs — the official-receipt edit as
// BEHAVIOUR: the real routes (post, edit, void, unvoid) run against an
// in-memory ledger that reads their SQL. What the books must show after each
// step: exactly one live set of legs (the newest edit), the bank match and
// the daily tick on the re-posted bank leg, a matched receipt refusing a new
// bank account / amount, and an unvoid restoring the EDITED legs, never the
// pre-edit ones (class C5). The in-memory ledger enforces the real
// (orgId, sourceType, sourceId, legNo) uniqueness. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));
const { OR_MATCHED_EDIT_ERR } = await import(src("src/lib/official-receipt-edit.ts"));

const ORG = "hookka";

function makeDb() {
  const st = {
    coa: [
      { code: "310-0001", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
      { code: "310-0002", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
      { code: "520-0001", type: "INCOME", specialAccountType: null, isPostable: 1 },
      { code: "520-0002", type: "INCOME", specialAccountType: null, isPostable: 1 },
    ],
    receipts: [], lines: [], legs: [], lifecycle: [], stmt: [], splits: [], ticks: [], counter: 1, seq: 0,
  };
  const like = (v, pat) => String(v).startsWith(pat.replace(/%$/, ""));
  const exec = (rawSql, a, mode) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    let m;
    if (/^SELECT code, type, specialAccountType, .* FROM chart_of_accounts$/.test(sql)) return st.coa;
    if (/FROM kv_config/.test(sql)) return mode === "all" ? [] : null;
    if (/^INSERT INTO doc_no_counters/.test(sql)) { st.counter += 1; return { next_no: st.counter }; }
    if (/^SELECT rowHash FROM ledger_journal_entries WHERE orgId = \? ORDER BY postedAt DESC, id DESC LIMIT 1$/.test(sql)) return st.legs.length ? { rowHash: st.legs[st.legs.length - 1].rowHash } : null;
    if (/^SELECT pg_advisory_xact_lock/.test(sql)) return null;
    if (/^INSERT INTO ledger_journal_entries \(/.test(sql)) {
      const [id, sourceType, sourceId, legNo, accountCode, debitSen, creditSen, description, prevHash, rowHash, actorUserId, orgId] = a;
      if (st.legs.some((l) => l.orgId === orgId && l.sourceType === sourceType && l.sourceId === sourceId && l.legNo === legNo)) {
        throw new Error(`duplicate ledger leg ${sourceType}/${sourceId}/${legNo}`);
      }
      st.legs.push({ id, sourceType, sourceId, legNo, accountCode, debitSen, creditSen, description, prevHash, rowHash, actorUserId, orgId, hidden: 0, postedAt: String(++st.seq).padStart(6, "0") });
      return null;
    }
    if (/^INSERT INTO official_receipts \(/.test(sql)) {
      const [id, orNo, date, receivedFrom, description, payTo, totalSen] = a;
      st.receipts.push({ id, orNo, date, receivedFrom, description, payTo, totalSen, status: "POSTED" });
      return null;
    }
    if (/^INSERT INTO official_receipt_lines \(/.test(sql)) {
      const [id, receiptId, accountCode, description, amountSen, lineOrder] = a;
      st.lines.push({ id, receiptId, accountCode, description, amountSen, lineOrder });
      return null;
    }
    if (/^SELECT \* FROM official_receipts WHERE id = \?$/.test(sql) || /^SELECT id, orNo, status FROM official_receipts WHERE id = \?$/.test(sql)) {
      return st.receipts.find((r) => r.id === a[0]) ?? null;
    }
    if (/^SELECT state FROM document_lifecycle WHERE orgId = \? AND sourceType = \? AND sourceId = \?$/.test(sql)) {
      const row = st.lifecycle.find((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]);
      return row ? { state: row.state } : null;
    }
    if (/^SELECT id, accountCode, debitSen, creditSen FROM ledger_journal_entries WHERE sourceId = \? AND orgId = \? AND hidden = 0 AND sourceType LIKE 'official_receipt%'$/.test(sql)) {
      return st.legs.filter((l) => l.sourceId === a[0] && l.orgId === a[1] && l.hidden === 0 && like(l.sourceType, "official_receipt%"));
    }
    if (/^SELECT matchedLegId FROM bank_statement_lines WHERE matchedLegId IN \(/.test(sql)) return st.stmt.filter((s) => a.includes(s.matchedLegId)).map((s) => ({ matchedLegId: s.matchedLegId }));
    if (/^SELECT leg_id FROM bank_line_leg_splits WHERE leg_id IN \(/.test(sql)) return st.splits.filter((s) => a.includes(s.leg_id)).map((s) => ({ legId: s.leg_id }));
    if (/^SELECT leg_id FROM bank_board_cleared WHERE leg_id IN \(/.test(sql)) return st.ticks.filter((s) => a.includes(s.leg_id)).map((s) => ({ legId: s.leg_id }));
    if ((m = /^UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE '([^']+)'( AND sourceType <> \?)?$/.exec(sql))) {
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && like(l.sourceType, m[1]) && (!m[2] || l.sourceType !== a[2])) l.hidden = 1;
      return null;
    }
    if (/^UPDATE ledger_journal_entries SET hidden = 0 WHERE sourceId = \? AND orgId = \? AND sourceType = \?$/.test(sql)) {
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && l.sourceType === a[2]) l.hidden = 0;
      return null;
    }
    if (/^UPDATE ledger_journal_entries SET hidden = \? WHERE sourceType = \? AND sourceId = \? AND orgId = \?$/.test(sql)) {
      for (const l of st.legs) if (l.sourceType === a[1] && l.sourceId === a[2] && l.orgId === a[3]) l.hidden = a[0];
      return null;
    }
    if (/^UPDATE bank_statement_lines SET matchedLegId = \? WHERE matchedLegId = \?$/.test(sql)) { for (const s of st.stmt) if (s.matchedLegId === a[1]) s.matchedLegId = a[0]; return null; }
    if (/^UPDATE bank_line_leg_splits SET leg_id = \? WHERE leg_id = \?$/.test(sql)) { for (const s of st.splits) if (s.leg_id === a[1]) s.leg_id = a[0]; return null; }
    if (/^UPDATE bank_board_cleared SET leg_id = \? WHERE leg_id = \?$/.test(sql)) { for (const s of st.ticks) if (s.leg_id === a[1]) s.leg_id = a[0]; return null; }
    if (/^UPDATE official_receipts SET date = \?, receivedFrom = \?, description = \?, payTo = \?, totalSen = \?, updated_at = \? WHERE id = \?$/.test(sql)) {
      const r = st.receipts.find((x) => x.id === a[6]);
      Object.assign(r, { date: a[0], receivedFrom: a[1], description: a[2], payTo: a[3], totalSen: a[4] });
      return null;
    }
    if (/^UPDATE official_receipts SET status = \?, updated_at = \? WHERE id = \?$/.test(sql)) { st.receipts.find((x) => x.id === a[2]).status = a[0]; return null; }
    if (/^DELETE FROM official_receipt_lines WHERE receiptId = \?$/.test(sql)) { st.lines = st.lines.filter((l) => l.receiptId !== a[0]); return null; }
    if (/^SELECT accountCode, description, amountSen FROM official_receipt_lines WHERE receiptId = \? ORDER BY lineOrder$/.test(sql)) return st.lines.filter((l) => l.receiptId === a[0]);
    if (/^SELECT id FROM ledger_journal_entries WHERE orgId = \? AND sourceType = \? AND sourceId = \? LIMIT 1$/.test(sql)) {
      return st.legs.find((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]) ?? null;
    }
    if (/^SELECT accountCode, debitSen, creditSen, legNo FROM ledger_journal_entries WHERE sourceType IN \(.*\) AND sourceId = \? AND orgId = \? ORDER BY legNo$/.test(sql)) {
      const types = a.slice(0, -2), [sid, org] = a.slice(-2);
      return st.legs.filter((l) => types.includes(l.sourceType) && l.sourceId === sid && l.orgId === org).sort((x, y) => x.legNo - y.legNo);
    }
    if (/^INSERT INTO document_lifecycle/.test(sql)) {
      const [, sourceType, sourceId, state, , , orgId] = a;
      const row = st.lifecycle.find((l) => l.orgId === orgId && l.sourceType === sourceType && l.sourceId === sourceId);
      if (row) row.state = state; else st.lifecycle.push({ orgId, sourceType, sourceId, state });
      return null;
    }
    if (/^SELECT DISTINCT sourceType FROM ledger_journal_entries WHERE sourceId = \? AND orgId = \? AND sourceType LIKE '([^']+)'$/.test(sql)) {
      const pat = /LIKE '([^']+)'/.exec(sql)[1];
      return [...new Set(st.legs.filter((l) => l.sourceId === a[0] && l.orgId === a[1] && like(l.sourceType, pat)).map((l) => l.sourceType))].map((sourceType) => ({ sourceType }));
    }
    if (/^INSERT INTO audit_events/.test(sql) || /^SELECT displayName FROM users/.test(sql)) return null;
    throw new Error(`unmocked SQL: ${sql}`);
  };
  const prepare = (sql) => {
    const mk = (args) => ({
      sql, args,
      bind: (...b) => mk(b),
      first: async () => exec(sql, args, "first"),
      all: async () => ({ results: exec(sql, args, "all") ?? [] }),
      run: async () => { exec(sql, args, "run"); return { success: true }; },
    });
    return mk([]);
  };
  // All-or-nothing, like the real batch.
  const batch = async (stmts) => {
    const snap = structuredClone(st);
    try { for (const s of stmts) exec(s.sql, s.args, "run"); } catch (e) { Object.assign(st, snap); throw e; }
    return stmts.map(() => ({ success: true }));
  };
  return { st, prepare, batch };
}

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => { c.set("DB", db); c.set("orgId", ORG); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "user-1"); await next(); });
  parent.route("/", accountingApp);
  return parent;
}
const post = (app, path, body) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
// The books as reports read them: only visible legs, per account.
const visible = (st, id) => st.legs.filter((l) => l.sourceId === id && l.hidden === 0);
const balances = (st, id) => {
  const b = {};
  for (const l of visible(st, id)) b[l.accountCode] = (b[l.accountCode] ?? 0) + l.debitSen - l.creditSen;
  for (const k of Object.keys(b)) if (b[k] === 0) delete b[k];
  return b;
};
const receipt = (lines, payTo = "310-0001") => ({ date: "2026-07-05", receivedFrom: "A buyer", description: "Scrap sale", payTo, lines });

test("post → match → edit keeps the bank match → refused change → unmatch → edit → void → unvoid", async () => {
  const db = makeDb();
  const app = mount(db);

  // 1. Post.
  const created = await post(app, "/official-receipts", receipt([{ accountCode: "520-0001", description: "scrap", amountSen: 50000 }]));
  assert.equal(created.status, 201, await created.clone().text());
  const { id, orNo } = (await created.json()).data;
  assert.deepEqual(balances(db.st, id), { "310-0001": 50000, "520-0001": -50000 });
  const bankLeg = visible(db.st, id).find((l) => l.accountCode === "310-0001");
  // Cash Book matched it, the board ticked it.
  db.st.stmt.push({ id: "bsl-1", accountCode: "310-0001", txnDate: "2026-07-05", amountSen: 50000, matchedLegId: bankLeg.id });
  db.st.ticks.push({ leg_id: bankLeg.id, account_code: "310-0001", cleared_on: "2026-07-05" });

  // 2. Edit the income account and the text — bank side unchanged.
  const e1 = await post(app, `/official-receipts/${id}/restate`, { ...receipt([{ accountCode: "520-0002", description: "scrap metal", amountSen: 50000 }]), receivedFrom: "A buyer Sdn Bhd" });
  assert.equal(e1.status, 200, await e1.clone().text());
  assert.equal((await e1.json()).data.bankMatchMoved, true);
  assert.deepEqual(balances(db.st, id), { "310-0001": 50000, "520-0002": -50000 }, "the books show the edit only");
  const live1 = visible(db.st, id);
  assert.ok(live1.every((l) => l.sourceType.startsWith("official_receipt_restate_post:")), "exactly one live family");
  const newBank = live1.find((l) => l.accountCode === "310-0001");
  assert.notEqual(newBank.id, bankLeg.id);
  assert.equal(db.st.stmt[0].matchedLegId, newBank.id, "the statement line follows the re-posted bank leg");
  assert.equal(db.st.ticks[0].leg_id, newBank.id, "so does the daily tick");
  const r = db.st.receipts.find((x) => x.id === id);
  assert.equal(r.orNo, orNo, "same OR number");
  assert.equal(r.receivedFrom, "A buyer Sdn Bhd");
  assert.deepEqual(db.st.lines.filter((l) => l.receiptId === id).map((l) => [l.accountCode, l.amountSen]), [["520-0002", 50000]]);

  // 3. While matched, the amount can't change — nothing is written.
  const legsBefore = db.st.legs.length;
  const e2 = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0002", description: "scrap", amountSen: 40000 }]));
  assert.equal(e2.status, 409);
  assert.equal((await e2.json()).error, OR_MATCHED_EDIT_ERR);
  assert.equal(db.st.legs.length, legsBefore);
  assert.deepEqual(balances(db.st, id), { "310-0001": 50000, "520-0002": -50000 });

  // 4. Unmatched in Cash Book → the bank account and amount can change.
  db.st.stmt[0].matchedLegId = null;
  const e3 = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0002", description: "scrap", amountSen: 40000 }], "310-0002"));
  assert.equal(e3.status, 200, await e3.clone().text());
  assert.equal((await e3.json()).data.bankMatchMoved, false);
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0002": -40000 });

  // 5. Void → nothing left in the books.
  const v = await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.equal(v.status, 200, await v.clone().text());
  assert.deepEqual(balances(db.st, id), {});
  assert.equal(visible(db.st, id).length, 0);

  // 6. Unvoid → the EDITED receipt comes back, not the original (C5).
  const u = await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.equal(u.status, 200, await u.clone().text());
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0002": -40000 });
  const latest = visible(db.st, id).map((l) => l.sourceType);
  assert.equal(new Set(latest).size, 1, "one live family after the unvoid");

  // 7. Void and unvoid again — same answer; then the restored receipt edits normally.
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.deepEqual(balances(db.st, id), {});
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0002": -40000 });
  const e4 = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0001", description: "scrap", amountSen: 40000 }], "310-0002"));
  assert.equal(e4.status, 200, await e4.clone().text());
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0001": -40000 });
});

test("a cancelled receipt can't be edited; an unreadable edit writes nothing", async () => {
  const db = makeDb();
  const app = mount(db);
  const created = await post(app, "/official-receipts", receipt([{ accountCode: "520-0001", description: "", amountSen: 12345 }]));
  const { id } = (await created.json()).data;
  const bad = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0001", description: "", amountSen: 0 }]));
  assert.equal(bad.status, 400);
  assert.deepEqual(balances(db.st, id), { "310-0001": 12345, "520-0001": -12345 });
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  const r = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0002", description: "", amountSen: 12345 }]));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /cancelled — restore it before editing/);
  assert.deepEqual(balances(db.st, id), {});
});

test("a never-edited receipt voids and unvoids exactly as before", async () => {
  const db = makeDb();
  const app = mount(db);
  const created = await post(app, "/official-receipts", receipt([{ accountCode: "520-0001", description: "", amountSen: 777 }]));
  const { id } = (await created.json()).data;
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.deepEqual(balances(db.st, id), {});
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.deepEqual(balances(db.st, id), { "310-0001": 777, "520-0001": -777 });
  assert.ok(visible(db.st, id).every((l) => l.sourceType === "official_receipt"), "the original legs are the live set");
});
