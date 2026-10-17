// ---------------------------------------------------------------------------
// _ledger-mock.mjs — an in-memory database that reads the SQL the finance
// edit / void / unvoid routes send (official receipts, payment vouchers), so
// tests can run the REAL routes and look at the books afterwards. It enforces
// the real ledger uniqueness (orgId, sourceType, sourceId, legNo) and runs a
// batch all-or-nothing. Unknown SQL throws, naming the statement — a route
// that starts sending something new fails loudly instead of passing over it.
// Shared by tests/official-receipt-edit-flow.test.mjs and
// tests/edit-keeps-bank-match-flow.test.mjs.
// ---------------------------------------------------------------------------
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
export const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));
export const { bankMatchedEditError } = await import(src("src/lib/bank-leg-carry.ts"));

export const ORG = "hookka";

export const DEFAULT_COA = [
  { code: "310-0001", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
  { code: "310-0002", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
  { code: "520-0001", type: "INCOME", specialAccountType: null, isPostable: 1 },
  { code: "520-0002", type: "INCOME", specialAccountType: null, isPostable: 1 },
  { code: "900-0001", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
  { code: "900-0002", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
];

export function makeLedgerDb({ coa = DEFAULT_COA, aliases = [] } = {}) {
  const st = {
    coa, aliases,
    receipts: [], lines: [], vouchers: [], pvLines: [],
    legs: [], lifecycle: [], stmt: [], splits: [], ticks: [], counter: 1, seq: 0,
  };
  const like = (v, pat) => String(v).startsWith(String(pat).replace(/%$/, ""));
  const exec = (rawSql, a, mode) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    let m;
    // ── setup / reference data
    if (/^(ALTER TABLE|CREATE (TABLE|INDEX)|UPDATE payment_vouchers SET approval_state = 'APPROVED' WHERE approval_state IS NULL)/.test(sql)) return null;
    if (/^SELECT code, type, specialAccountType, .* FROM chart_of_accounts$/.test(sql)) return st.coa;
    if (/^SELECT oldCode, newCode FROM account_aliases$/.test(sql)) return st.aliases;
    if (/FROM kv_config/.test(sql)) return mode === "all" ? [] : null;
    if (/^INSERT INTO doc_no_counters/.test(sql)) { st.counter += 1; return { next_no: st.counter }; }
    if (/^INSERT INTO audit_events/.test(sql) || /^SELECT displayName FROM users/.test(sql)) return null;
    // ── ledger
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
    if ((m = /^SELECT id, accountCode, debitSen, creditSen FROM ledger_journal_entries WHERE sourceId = \? AND orgId = \? AND hidden = 0 AND sourceType LIKE '([^']+)'$/.exec(sql))) {
      return st.legs.filter((l) => l.sourceId === a[0] && l.orgId === a[1] && l.hidden === 0 && like(l.sourceType, m[1]));
    }
    if (/^SELECT sourceType, MIN\(postedAt\) AS first_at FROM ledger_journal_entries WHERE sourceId = \? AND orgId = \? AND sourceType LIKE \? GROUP BY sourceType$/.test(sql)) {
      const fams = new Map();
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && like(l.sourceType, a[2])) if (!fams.has(l.sourceType) || l.postedAt < fams.get(l.sourceType)) fams.set(l.sourceType, l.postedAt);
      return [...fams].map(([sourceType, first_at]) => ({ sourceType, firstAt: first_at }));
    }
    if ((m = /^UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE ('([^']+)'|\?)( AND sourceType <> \?)?$/.exec(sql))) {
      const pat = m[1] === "?" ? a[2] : m[2];
      const not = m[3] ? a[m[1] === "?" ? 3 : 2] : null;
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && like(l.sourceType, pat) && (not === null || l.sourceType !== not)) l.hidden = 1;
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
    if (/^SELECT id FROM ledger_journal_entries WHERE orgId = \? AND sourceType = \? AND sourceId = \? LIMIT 1$/.test(sql)) {
      return st.legs.find((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]) ?? null;
    }
    if (/^SELECT accountCode, debitSen, creditSen, legNo FROM ledger_journal_entries WHERE sourceType IN \(.*\) AND sourceId = \? AND orgId = \? ORDER BY legNo$/.test(sql)) {
      const types = a.slice(0, -2), [sid, org] = a.slice(-2);
      return st.legs.filter((l) => types.includes(l.sourceType) && l.sourceId === sid && l.orgId === org).sort((x, y) => x.legNo - y.legNo);
    }
    // ── document lifecycle
    if (/^SELECT state FROM document_lifecycle WHERE orgId = \? AND sourceType = \? AND sourceId = \?$/.test(sql)) {
      const row = st.lifecycle.find((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]);
      return row ? { state: row.state } : null;
    }
    if (/^INSERT INTO document_lifecycle/.test(sql)) {
      const [, sourceType, sourceId, state, , , orgId] = a;
      const row = st.lifecycle.find((l) => l.orgId === orgId && l.sourceType === sourceType && l.sourceId === sourceId);
      if (row) row.state = state; else st.lifecycle.push({ orgId, sourceType, sourceId, state });
      return null;
    }
    // ── bank side
    if (/^SELECT matchedLegId FROM bank_statement_lines WHERE matchedLegId IN \(/.test(sql)) return st.stmt.filter((s) => a.includes(s.matchedLegId)).map((s) => ({ matchedLegId: s.matchedLegId }));
    if (/^SELECT leg_id FROM bank_line_leg_splits WHERE leg_id IN \(/.test(sql)) return st.splits.filter((s) => a.includes(s.leg_id)).map((s) => ({ legId: s.leg_id }));
    if (/^SELECT leg_id FROM bank_board_cleared WHERE leg_id IN \(/.test(sql)) return st.ticks.filter((s) => a.includes(s.leg_id)).map((s) => ({ legId: s.leg_id }));
    if (/^UPDATE bank_statement_lines SET matchedLegId = \? WHERE matchedLegId = \?$/.test(sql)) { for (const s of st.stmt) if (s.matchedLegId === a[1]) s.matchedLegId = a[0]; return null; }
    if (/^UPDATE bank_line_leg_splits SET leg_id = \? WHERE leg_id = \?$/.test(sql)) { for (const s of st.splits) if (s.leg_id === a[1]) s.leg_id = a[0]; return null; }
    if (/^UPDATE bank_board_cleared SET leg_id = \? WHERE leg_id = \?$/.test(sql)) { for (const s of st.ticks) if (s.leg_id === a[1]) s.leg_id = a[0]; return null; }
    // ── official receipts
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
    if (/^UPDATE official_receipts SET date = \?, receivedFrom = \?, description = \?, payTo = \?, totalSen = \?, updated_at = \? WHERE id = \?$/.test(sql)) {
      Object.assign(st.receipts.find((x) => x.id === a[6]), { date: a[0], receivedFrom: a[1], description: a[2], payTo: a[3], totalSen: a[4] });
      return null;
    }
    if (/^UPDATE official_receipts SET status = \?, updated_at = \? WHERE id = \?$/.test(sql)) { st.receipts.find((x) => x.id === a[2]).status = a[0]; return null; }
    if (/^DELETE FROM official_receipt_lines WHERE receiptId = \?$/.test(sql)) { st.lines = st.lines.filter((l) => l.receiptId !== a[0]); return null; }
    if (/^SELECT accountCode, description, amountSen FROM official_receipt_lines WHERE receiptId = \? ORDER BY lineOrder$/.test(sql)) return st.lines.filter((l) => l.receiptId === a[0]);
    if (/^SELECT official_receipts\.\*, dl\.state AS lifecycleState FROM official_receipts LEFT JOIN document_lifecycle dl/.test(sql)) {
      return st.receipts.map((r) => ({ ...r, lifecycleState: st.lifecycle.find((l) => l.sourceType === "official_receipt" && l.sourceId === r.id)?.state ?? null }));
    }
    if (/^SELECT \* FROM official_receipt_lines ORDER BY lineOrder$/.test(sql)) return [...st.lines].sort((x, y) => x.lineOrder - y.lineOrder);
    // ── payment vouchers
    if (/^SELECT id, pvNo, status, approval_state, pv_kind(, party_kind)? FROM payment_vouchers WHERE id = \?$/.test(sql)) {
      const v = st.vouchers.find((x) => x.id === a[0]);
      return v ? { id: v.id, pvNo: v.pvNo, status: v.status, approvalState: v.approvalState, pvKind: v.pvKind ?? null, partyKind: null } : null;
    }
    if (/^UPDATE payment_vouchers SET date = \?, payee = \?, description = \?, payFrom = \?, accrued = \?, accrualAccount = \?, settledAt = NULL, productLine = \?, totalSen = \?, notes = \?, bill_no = \?, bill_date = \?, status = 'POSTED', updated_at = \? WHERE id = \?$/.test(sql)) {
      Object.assign(st.vouchers.find((x) => x.id === a[12]), { date: a[0], payee: a[1], description: a[2], payFrom: a[3], totalSen: a[7] });
      return null;
    }
    if (/^UPDATE payment_vouchers SET status = \? WHERE id = \?$/.test(sql)) { st.vouchers.find((x) => x.id === a[1]).status = a[0]; return null; }
    if (/^DELETE FROM payment_voucher_lines WHERE voucherId = \?$/.test(sql)) { st.pvLines = st.pvLines.filter((l) => l.voucherId !== a[0]); return null; }
    if (/^INSERT INTO payment_voucher_lines \(id, voucherId, accountCode, description, amountSen, lineOrder\) VALUES/.test(sql)) {
      const [id, voucherId, accountCode, description, amountSen, lineOrder] = a;
      st.pvLines.push({ id, voucherId, accountCode, description, amountSen, lineOrder });
      return null;
    }
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
  const batch = async (stmts) => {
    const snap = structuredClone(st);
    try { for (const s of stmts) exec(s.sql, s.args, "run"); } catch (e) { Object.assign(st, snap); throw e; }
    return stmts.map(() => ({ success: true }));
  };
  // Seed a posted document's legs the way its poster writes them.
  const seedLegs = (sourceType, sourceId, legs) => {
    legs.forEach((l, i) => st.legs.push({ id: l.id ?? `lje-seed-${sourceId}-${i + 1}`, sourceType, sourceId, legNo: i + 1, accountCode: l.accountCode, debitSen: l.debitSen ?? 0, creditSen: l.creditSen ?? 0, description: "", prevHash: "", rowHash: `h${++st.seq}`, actorUserId: null, orgId: ORG, hidden: 0, postedAt: String(st.seq).padStart(6, "0") }));
  };
  return { st, prepare, batch, seedLegs };
}

export function mountAccounting(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => { c.set("DB", db); c.set("orgId", ORG); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "user-1"); await next(); });
  parent.route("/", accountingApp);
  return parent;
}

export const post = (app, path, body) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// The books as the reports read them: visible legs only, per account.
export const visible = (st, id) => st.legs.filter((l) => l.sourceId === id && l.hidden === 0);
export const balances = (st, id) => {
  const b = {};
  for (const l of visible(st, id)) b[l.accountCode] = (b[l.accountCode] ?? 0) + l.debitSen - l.creditSen;
  for (const k of Object.keys(b)) if (b[k] === 0) delete b[k];
  return b;
};
