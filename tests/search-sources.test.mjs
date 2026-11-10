// The catalogue and SQL builder behind GET /api/search
// (src/api/lib/search-sources.ts).
//
// Two things must never go wrong here, and neither is visible by reading the
// endpoint: an identifier reaching SQL from user input, and a source losing
// its org filter so a search leaks another company's rows.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const ss = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/lib/search-sources.ts")).href
);

const colsOf = (s) =>
  new Set([s.idCol, s.labelCol, ...s.subCols, ...s.searchCols, s.orgCol].filter(Boolean));

test("every source is org-scoped — a search must not cross companies", () => {
  for (const s of ss.SEARCH_SOURCES) {
    // The two Accounting tables with no org column are read unscoped by their
    // own pages too; they are named, so a new one cannot slip in quietly.
    if (ss.UNTENANTED_SEARCH_TABLES.has(s.table)) {
      assert.equal(s.orgCol, null, `${s.kind} is listed untenanted but names an org column`);
      continue;
    }
    assert.ok(s.orgCol, `${s.kind} has no org column`);
    const { sql } = ss.buildSourceSql(s, colsOf(s), 5);
    assert.match(sql, new RegExp(`${s.orgCol} = \\?`), `${s.kind} lost its org filter`);
  }
});

test("every source declares an RBAC resource and a link prefix", () => {
  for (const s of ss.SEARCH_SOURCES) {
    assert.ok(s.resource, `${s.kind} has no resource`);
    assert.ok(s.hrefPrefix.startsWith("/"), `${s.kind} has a bad href prefix`);
    assert.ok(s.searchCols.length > 0, `${s.kind} searches no columns`);
  }
});

test("source kinds are unique", () => {
  const kinds = ss.SEARCH_SOURCES.map((s) => s.kind);
  assert.equal(new Set(kinds).size, kinds.length);
});

test("the term is bound, never interpolated", () => {
  const s = ss.SEARCH_SOURCES[0];
  const { sql, bindCount } = ss.buildSourceSql(s, colsOf(s), 10);
  assert.equal(bindCount, s.searchCols.length + 1, "one bind per search column, plus the org");
  assert.equal((sql.match(/\?/g) || []).length, bindCount);
  // The builder never receives the search term at all, so interpolating it is
  // structurally impossible. The only literals allowed are the empty-string
  // defaults inside COALESCE and the fixed regexp_replace patterns.
  for (const src of ss.SEARCH_SOURCES) {
    const built = ss.buildSourceSql(src, colsOf(src), 10, { compact: true, phone: true });
    assert.equal((built.sql.match(/\?/g) || []).length, built.bindCount, `${src.kind} bind count`);
    const lits = new Set(built.sql.match(/'[^']*'/g) || []);
    for (const l of lits) {
      assert.ok(["''", "'[^0-9a-z]'", "'[^0-9]'", "'g'", "'^60'", "'0'"].includes(l), `${src.kind}: unexpected literal ${l}`);
    }
  }
});

test("the limit is clamped and inlined as a plain integer", () => {
  const s = ss.SEARCH_SOURCES[0];
  assert.match(ss.buildSourceSql(s, colsOf(s), 999).sql, /LIMIT 50$/);
  assert.match(ss.buildSourceSql(s, colsOf(s), 0).sql, /LIMIT 1$/);
  assert.match(ss.buildSourceSql(s, colsOf(s), 7.9).sql, /LIMIT 7$/);
});

test("a missing cosmetic column is dropped, not fatal", () => {
  const s = ss.SEARCH_SOURCES[0];
  // Only what the query strictly needs — every cosmetic sub-column absent.
  const minimal = new Set([s.idCol, s.labelCol, ...s.searchCols, s.orgCol]);
  const droppable = s.subCols.filter((c) => !minimal.has(c));
  assert.ok(droppable.length > 0, "fixture needs at least one droppable sub-column");
  const { sql } = ss.buildSourceSql(s, minimal, 5);
  assert.equal((sql.match(/NULL AS sub/g) || []).length, droppable.length,
    "each absent sub-column becomes NULL rather than breaking the query");
  assert.ok(sql.includes(s.labelCol), "the label column still selects");
  for (const c of droppable) assert.ok(!sql.includes(`${c} AS sub`), `${c} must not be selected`);
});

test("a table missing a required column is not searched at all", () => {
  const s = ss.SEARCH_SOURCES[0];
  const full = new Map([[s.table, colsOf(s)]]);
  assert.equal(ss.isSourceUsable(s, full), true);

  const missingSearchCol = new Set(colsOf(s));
  missingSearchCol.delete(s.searchCols[0]);
  assert.equal(ss.isSourceUsable(s, new Map([[s.table, missingSearchCol]])), false);

  assert.equal(ss.isSourceUsable(s, new Map()), false, "absent table is never searched");
});

test("org filter admits NULL so un-tenanted legacy rows stay findable", () => {
  // Rows written before multi-tenancy carry a NULL org. Excluding them would
  // silently hide real history from search.
  const s = ss.SEARCH_SOURCES[0];
  const { sql } = ss.buildSourceSql(s, colsOf(s), 5);
  assert.match(sql, new RegExp(`${s.orgCol} IS NULL`));
});

test("search predicates are null-safe", () => {
  // Without COALESCE, a NULL column makes the whole OR chain NULL and the row
  // never matches — a customer with no email would drop out of a name search.
  for (const s of ss.SEARCH_SOURCES) {
    const { sql } = ss.buildSourceSql(s, colsOf(s), 5);
    for (const c of s.searchCols) {
      assert.ok(
        sql.includes(`COALESCE(${c}::text,'') ILIKE ?`),
        `${s.kind}.${c} is not null-safe`,
      );
    }
  }
});

test("coverage — the modules that were previously unsearchable are present", () => {
  const kinds = new Set(ss.SEARCH_SOURCES.map((s) => s.kind));
  for (const k of [
    "purchase_order", "purchase_invoice", "grn", "supplier",
    "production_order", "service_order", "service_case",
    "employee", "lead", "journal_entry",
  ]) {
    assert.ok(kinds.has(k), `${k} is missing from global search`);
  }
});

// ── review pass 2: C2-9 / H3-11 / C2-10 ────────────────────────────────────

test("phone digits: +60, spaces and dashes all fold to the same number", () => {
  assert.equal(ss.phoneDigits("+60 12-345 6789"), "0123456789");
  assert.equal(ss.phoneDigits("012-345 6789"), "0123456789");
  assert.equal(ss.phoneDigits("60123456789"), "0123456789");
  assert.equal(ss.phoneDigits("0123456789"), "0123456789");
  assert.equal(ss.phoneDigits("(03) 6156-1234"), "0361561234");
  assert.equal(ss.phoneDigits("601"), null, "too short to be a phone");
  assert.equal(ss.phoneDigits("6012"), "6012", "a short bare 60… is not re-read as 0");
  assert.equal(ss.phoneDigits("SO-2610"), null, "letters → not a phone");
});

test("document-number form ignores case, spaces, dashes and slashes", () => {
  assert.equal(ss.compactTerm("SO-2610 001"), "so2610001");
  assert.equal(ss.compactTerm("pv/2610/12"), "pv261012");
  const t = ss.searchTerms("so2610001");
  assert.equal(t.like, "%so2610001%");
  assert.equal(t.compact, "%so2610001%");
  assert.equal(t.phone, null);
  assert.equal(ss.searchTerms("--").compact, null, "nothing to match → no always-true LIKE '%%'");
  assert.equal(ss.searchTerms("ab").compact, null);
});

test("the SQL matches the stored value in the same folded form", () => {
  const so = ss.SEARCH_SOURCES.find((s) => s.kind === "sales_order");
  const plain = ss.buildSourceSql(so, colsOf(so), 5);
  assert.ok(!plain.sql.includes("regexp_replace"), "no extra forms unless asked");
  const both = ss.buildSourceSql(so, colsOf(so), 5, { compact: true, phone: true });
  for (const c of so.compactCols) {
    assert.ok(both.sql.includes(`regexp_replace(lower(COALESCE(${c}::text,'')),'[^0-9a-z]','','g') LIKE ?`), c);
  }
  const cust = ss.SEARCH_SOURCES.find((s) => s.kind === "customer");
  const ph = ss.buildSourceSql(cust, colsOf(cust), 5, { phone: true });
  assert.ok(ph.sql.includes(`regexp_replace(regexp_replace(COALESCE(phone::text,''),'[^0-9]','','g'),'^60','0') LIKE ?`));
  assert.deepEqual(ph.binds, [...cust.searchCols.map(() => "like"), "phone", "org"], "binds in SQL order, org last");
});

test("compact / phone columns are always search columns (so schema-checked)", () => {
  for (const s of ss.SEARCH_SOURCES) {
    for (const c of [...(s.compactCols ?? []), ...(s.phoneCols ?? [])]) {
      assert.ok(s.searchCols.includes(c), `${s.kind}.${c} is not a search column`);
    }
  }
});

test("every phone column that exists is searched by phone on the people sources", () => {
  const by = Object.fromEntries(ss.SEARCH_SOURCES.map((s) => [s.kind, s]));
  assert.deepEqual(by.customer.phoneCols, ["phone"]);
  assert.deepEqual(by.supplier.phoneCols, ["phone", "mobile", "phone2"]);
  assert.deepEqual(by.lead.phoneCols, ["phone"]);
});

test("the new kinds are present, each behind its own route's read permission", () => {
  const by = Object.fromEntries(ss.SEARCH_SOURCES.map((s) => [s.kind, s]));
  const want = {
    delivery_return: "delivery-returns",
    credit_note: "credit-notes",
    debit_note: "debit-notes",
    purchase_return: "purchase-returns",
    stock_adjustment: "inventory",
    payment_receipt: "payments",
    official_receipt: "accounting",
    payment_voucher: "accounting",
  };
  for (const [kind, resource] of Object.entries(want)) {
    assert.ok(by[kind], `${kind} missing`);
    assert.equal(by[kind].resource, resource, `${kind} gated on the wrong resource`);
  }
  // The route gates match: read the routes' own permission strings.
  const routeGate = {
    "credit-notes": "src/api/routes/credit-notes.ts",
    "debit-notes": "src/api/routes/debit-notes.ts",
    "delivery-returns": "src/api/routes/delivery-returns.ts",
    "purchase-returns": "src/api/routes/purchase-returns.ts",
    payments: "src/api/routes/payments.ts",
  };
  for (const [res, file] of Object.entries(routeGate)) {
    assert.ok(readFileSync(file, "utf8").includes(`requirePermission(c, "${res}", "read")`), `${file} no longer gates on ${res}`);
  }
});

test("every searched column exists in the prod schema snapshot", () => {
  // A missing search column takes the WHOLE source out of search at runtime
  // (isSourceUsable), so pin it here instead of finding out on prod.
  const schema = JSON.parse(readFileSync("tests/db-schema.json", "utf8"));
  for (const s of ss.SEARCH_SOURCES) {
    const cols = new Set(schema[s.table] ?? []);
    assert.ok(cols.size > 0, `${s.table} not in tests/db-schema.json`);
    for (const c of [s.idCol, s.labelCol, ...s.searchCols]) {
      assert.ok(cols.has(c), `${s.table}.${c} is not in the prod schema snapshot`);
    }
  }
});

test("result links: id, list filtered by the label, or the plain list", () => {
  const by = Object.fromEntries(ss.SEARCH_SOURCES.map((s) => [s.kind, s]));
  assert.equal(ss.resultHref(by.delivery_return, "dr 1", "DR-1"), "/delivery-returns/dr%201");
  assert.equal(ss.resultHref(by.credit_note, "x", "CN-2610-001"), "/invoices/credit-notes?credit-notes.q=CN-2610-001");
  assert.equal(ss.resultHref(by.payment_voucher, "x", "PV 1&2"), "/accounting?tab=payments&accounting-payments.q=PV%201%262");
  assert.equal(ss.resultHref(by.purchase_return, "x", "PR-1"), "/purchase-returns");
  // The label links point at grids that really are keyed that way.
  const gridOf = {
    credit_note: ["src/pages/invoices/credit-notes.tsx", 'gridId="credit-notes"'],
    debit_note: ["src/pages/invoices/debit-notes.tsx", 'gridId="debit-notes"'],
    payment_receipt: ["src/pages/invoices/payments.tsx", 'gridId="payments"'],
    official_receipt: ["src/pages/accounting/index.tsx", 'gridId="accounting-receipts"'],
    payment_voucher: ["src/pages/accounting/index.tsx", 'gridId="accounting-payments"'],
  };
  for (const [kind, [file, marker]] of Object.entries(gridOf)) {
    assert.equal(by[kind].hrefBy, "label");
    assert.ok(readFileSync(file, "utf8").includes(marker), `${file} lost ${marker}`);
  }
});

test("the palette maps every server kind (an unmapped kind is silently dropped)", () => {
  const ui = readFileSync("src/components/layout/global-search.tsx", "utf8");
  for (const s of ss.SEARCH_SOURCES) {
    assert.match(ui, new RegExp(`\\n\\s+${s.kind}: \\{ category:`), `${s.kind} not in SERVER_KIND_MAP`);
  }
});

test("the endpoint binds each form in the order the builder emitted", () => {
  const route = readFileSync("src/api/routes/search.ts", "utf8");
  assert.match(route, /searchTerms\(term\)/);
  assert.match(route, /bindKinds\.map\(/);
  assert.match(route, /resultHref\(s, id,/);
});
