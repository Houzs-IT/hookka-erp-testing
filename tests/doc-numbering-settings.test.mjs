// ---------------------------------------------------------------------------
// doc-numbering-settings.test.mjs — Settings › Document Numbering (owner
// 2026-10-20 「可以」): the design's table with every document's next number;
// payment / receipt prefixes stay per bank; the self-numbering documents
// (journal, credit / debit note, purchase invoice, supplier credit note,
// other-party bills) take theirs from here; the sales invoice is shown, not
// changed. A changed prefix applies from the next document. No document type
// shares a prefix with another or with a bank's payments / receipts.
//
// Made-up figures and numbers.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const m = await import(href("src/lib/doc-number.ts"));
const svc = await import(href("src/api/lib/doc-number-service.ts"));
const { default: accountingApp } = await import(href("src/api/routes/accounting.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test("a keyed prefix: trimmed, upper-case, trailing dash dropped; 1–8 letters or digits", () => {
  assert.equal(m.normalisePrefix(" hpv- "), "HPV");
  assert.equal(m.normalisePrefix(undefined), "");
  assert.equal(m.prefixProblem("HPV"), null);
  assert.equal(m.prefixProblem("JV2"), null);
  assert.match(m.prefixProblem("") ?? "", /cannot be empty/);
  assert.match(m.prefixProblem("HK-PV") ?? "", /1 to 8 letters or digits/);
  assert.match(m.prefixProblem("ABCDEFGHI") ?? "", /1 to 8 letters or digits/);
});

test("the document types: configured prefix wins; the sales invoice never changes", () => {
  assert.deepEqual(m.DOC_TYPES.map((d) => [d.key, d.defaultPrefix, d.editable]), [
    ["JE", "JE", true], ["CN", "CN", true], ["DN", "DN", true], ["PI", "PI", true],
    ["PCN", "PCN", true], ["OCB", "OCB", true], ["ODB", "ODB", true], ["INV", "INV", false],
  ]);
  assert.equal(m.resolveTypePrefix({ CN: "CRN" }, "CN"), "CRN");
  assert.equal(m.resolveTypePrefix({}, "JE"), "JE");
  assert.equal(m.resolveTypePrefix({ INV: "XINV" }, "INV"), "INV");
});

test("no document type shares a prefix with another type or with a bank's book", () => {
  const banks = { "310-0010": { out: "HPV", in: "HOR" }, "320-0000": { out: "HPV", in: "COR" } };
  assert.equal(m.findPrefixClash(banks, { CN: "CRN" }), null, "two banks sharing a payment book is fine");
  assert.match(m.findPrefixClash(banks, { CN: "HPV" }) ?? "", /Credit Note cannot use HPV — a bank's payments or receipts number with it/);
  assert.match(m.findPrefixClash(banks, { JE: "OR" }) ?? "", /Journal Voucher cannot use OR/, "the receipt default is taken too");
  assert.match(m.findPrefixClash(banks, { CN: "DN" }) ?? "", /Debit Note cannot use DN — Credit Note already numbers with it/);
  assert.match(m.findPrefixClash(banks, { PI: "INV" }) ?? "", /cannot use INV/);
});

test("the run: highest + 1, padded; the month the documents always took (UTC)", () => {
  assert.equal(m.nextAfter("CN", "2610", null), "CN-2610-001");
  assert.equal(m.nextAfter("CN", "2610", "CN-2610-041"), "CN-2610-042");
  assert.equal(m.nextAfter("JE", "2610", null, 4), "JE-2610-0001");
  assert.equal(m.nextAfter("INV", "2610", "INV-2610-999"), "INV-2610-1000");
  assert.equal(m.utcYymm(new Date("2026-10-31T17:00:00.000Z")), "2610");
});

// ---------------------------------------------------------------------------
// The numbers, against an in-memory book
// ---------------------------------------------------------------------------

function makeDb({ kv = {}, tables = {}, counters = [] } = {}) {
  const store = { kv: new Map(Object.entries(kv).map(([k, v]) => [k, JSON.stringify(v)])), audits: [] };
  const like = (pattern) => (s) => String(s).startsWith(pattern.replace(/%$/, ""));
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    let b = [];
    const obj = {
      bind(...a) { b = a; return obj; },
      async first() {
        let mm = s.match(/^SELECT value FROM kv_config WHERE key = '(\w+)'$/);
        if (mm) return store.kv.has(mm[1]) ? { value: store.kv.get(mm[1]) } : null;
        mm = s.match(/^SELECT COUNT\(\*\) AS c FROM (\w+) WHERE (\w+) LIKE \?$/);
        if (mm) return { c: (tables[mm[1]] ?? []).filter(like(b[0])).length };
        mm = s.match(/^SELECT (\w+) AS seqno FROM (\w+) WHERE \1 LIKE \? ORDER BY \1 DESC LIMIT 1$/);
        if (mm) {
          const rows = (tables[mm[2]] ?? []).filter(like(b[0])).sort();
          return rows.length ? { seqno: rows[rows.length - 1] } : null;
        }
        return null;
      },
      async all() {
        if (/^SELECT prefix, next_no FROM doc_no_counters WHERE ym = \?$/.test(s)) {
          return { results: counters.filter((r) => r.ym === b[0]).map((r) => ({ prefix: r.prefix, next_no: r.next_no })) };
        }
        const mm = s.match(/^SELECT key, value FROM kv_config WHERE key IN \(/);
        if (mm) return { results: b.filter((k) => store.kv.has(k)).map((k) => ({ key: k, value: store.kv.get(k) })) };
        return { results: [] };
      },
      async run() {
        if (/^INSERT INTO kv_config \(key, value, updated_at\) VALUES \(\?, \?, \?\)/.test(s)) { store.kv.set(b[0], b[1]); return { success: true }; }
        if (/INSERT INTO audit_events/.test(s)) store.audits.push(b);
        return { success: true };
      },
    };
    return obj;
  }
  return { db: { prepare, batch: async () => [] }, store };
}

test("each document's next number reads the configured prefix; the journal still counts its month", async () => {
  const { db } = makeDb({
    kv: { doc_type_prefixes: { CN: "CRN", JE: "JV", INV: "XINV" } },
    tables: {
      credit_notes: ["CN-2610-005", "CRN-2610-002"],
      journal_entries: ["JE-2610-0007", "JV-2610-0001", "JV-2610-0002"],
      invoices: ["INV-2610-074"],
      debit_notes: [],
    },
  });
  assert.equal(await svc.nextSelfNumber(db, "CN", { yymm: "2610" }), "CRN-2610-003");
  assert.equal(await svc.nextSelfNumber(db, "JE", { yymm: "2610" }), "JV-2610-0003");
  assert.equal(await svc.nextSelfNumber(db, "INV", { yymm: "2610" }), "INV-2610-075", "the sales invoice keeps INV");
  assert.equal(await svc.nextSelfNumber(db, "DN", { yymm: "2610" }), "DN-2610-001");
  assert.equal(await svc.docTypePrefix(db, "OCB"), "OCB");
});

test("the preview: bank counters for this Malaysia month, every document's next number", async () => {
  const ym = m.ymFromDate(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  const { db } = makeDb({ counters: [{ prefix: "HPV", ym, next_no: 41 }, { prefix: "OCB", ym, next_no: 7 }, { prefix: "HPV", ym: "0001", next_no: 99 }] });
  const p = await svc.docNumberPreview(db);
  assert.equal(p.ym, ym);
  assert.deepEqual(p.counters, { HPV: 41, OCB: 7 });
  const by = Object.fromEntries(p.types.map((t) => [t.key, t]));
  assert.equal(by.OCB.next, `OCB-${ym}-007`);
  assert.equal(by.ODB.next, `ODB-${ym}-001`);
  assert.equal(by.INV.editable, false);
  assert.match(by.JE.next, /^JE-\d{4}-0001$/);
});

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/api/accounting", accountingApp);
  return async (method, body) => {
    const res = await parent.request("/api/accounting/doc-number-prefixes", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, {});
    return { status: res.status, body: await res.json() };
  };
}

test("Save: a type's prefix is stored upper-case, a default or the sales invoice is not stored, and the audit names it", async () => {
  const { db, store } = makeDb({ kv: { doc_number_prefixes: { "310-0010": { out: "HPV", in: "HOR" } } } });
  const call = mount(db);
  const r = await call("PUT", { types: { CN: "crn-", DN: "DN", INV: "XINV" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(JSON.parse(store.kv.get("doc_type_prefixes")), { CN: "CRN" });
  assert.deepEqual(JSON.parse(store.kv.get("doc_number_prefixes")), { "310-0010": { out: "HPV", in: "HOR" } }, "the bank prefixes untouched");
  assert.ok(store.audits.some((a) => a.includes("doc_type_prefixes")), "audited");
  const got = await call("GET");
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.data.types, { CN: "CRN" });
  assert.equal(got.body.data.preview.types.find((t) => t.key === "CN").prefix, "CRN");
});

test("Save refuses a clash and a bad prefix, and stores nothing", async () => {
  const { db, store } = makeDb({ kv: { doc_number_prefixes: { "310-0010": { out: "HPV", in: "HOR" } } } });
  const call = mount(db);
  const clash = await call("PUT", { types: { CN: "HPV" } });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /Credit Note cannot use HPV/);
  const bad = await call("PUT", { map: { "310-0010": { out: "H-PV", in: "HOR" } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /310-0010: "H-PV" — use 1 to 8 letters or digits/);
  const bankClash = await call("PUT", { map: { "310-0010": { out: "CN", in: "HOR" } } });
  assert.equal(bankClash.status, 400, "a bank cannot take a document type's prefix either");
  assert.equal(store.kv.has("doc_type_prefixes"), false);
  assert.deepEqual(JSON.parse(store.kv.get("doc_number_prefixes")), { "310-0010": { out: "HPV", in: "HOR" } });
});

// ---------------------------------------------------------------------------
// Every generator goes through the one rule
// ---------------------------------------------------------------------------

test("every self-numbering generator reads the configured prefix", () => {
  const acc = read("src/api/routes/accounting.ts");
  assert.match(acc, /async function nextJeNo\(db: D1Database\): Promise<string> \{\n  return nextSelfNumber\(db, "JE"\);\n\}/);
  assert.match(acc, /async function nextPcnNo\(db: Env\["Variables"\]\["DB"\]\): Promise<string> \{\n  return nextSelfNumber\(db, "PCN"\);\n\}/);
  assert.match(acc, /await docTypePrefix\(c\.var\.DB, prefixForPartyType\(partyType\) === "OCB" \? "OCB" : "ODB"\),/);
  assert.match(read("src/api/routes/credit-notes.ts"), /return nextSelfNumber\(db, "CN"\);/);
  assert.match(read("src/api/routes/debit-notes.ts"), /return nextSelfNumber\(db, "DN"\);/);
  assert.match(read("src/api/routes/purchase-invoices.ts"), /return nextSelfNumber\(db, "PI"\);/);
  assert.match(read("src/api/routes/invoices.ts"), /return nextSelfNumber\(db, "INV"\);/);
  for (const [f, lit] of [["src/api/routes/credit-notes.ts", "`CN-${yymm}-`"], ["src/api/routes/debit-notes.ts", "`DN-${yymm}-`"], ["src/api/routes/purchase-invoices.ts", "`PI-${yymm}-`"], ["src/api/routes/invoices.ts", "`INV-${yymm}-`"]]) {
    assert.ok(!read(f).includes(lit), `${f}: no hard-coded ${lit} left`);
  }
});

test("the Settings card: the design's columns, banks then documents, the sales invoice fixed", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const card = ui.slice(ui.indexOf("function DocNumberingCard("), ui.indexOf("// Operator-configurable GST/SST rate"));
  for (const h of ["Document", "Prefix", "Middle", "Restart", "Next Number Looks Like"]) assert.ok(card.includes(`>${h}</td>`), h);
  assert.match(card, /body: JSON\.stringify\(\{ map, types: keyedTypes \}\)/);
  assert.match(card, /disabled=\{saving \|\| !loaded \|\| !!problem\}/);
  assert.match(card, /\(fixed\)/);
  assert.match(card, /A changed prefix applies from the next document; numbers already issued never change\./);
});
