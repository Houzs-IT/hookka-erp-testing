// ---------------------------------------------------------------------------
// einvoice-tracking.test.mjs — the e-Invoice record (owner 2026-10-19 「1 做」,
// the design's MyInvois tracking) and BUG-2026-10-20-345.
//
// Nothing is sent to LHDN. Generate builds the XML (PENDING); Mark as
// Submitted keeps the Submission ID the owner keyed from MyInvois
// (SUBMITTED, or INVALID when the buyer has no TIN); Record Result keeps the
// UUID LHDN issued (VALID) or the reason it refused (REJECTED); Cancel marks
// a valid one cancelled. Nothing turns VALID without a keyed UUID.
//
// BUG-2026-10-20-345: Generate wrote ringgit with decimals into the integer
// amount columns, which Postgres refuses, and the catch answered "Invalid
// request body" — so no e-invoice could be made for a total with cents. The
// mock below refuses a non-integer amount the same way.
//
// Figures are made up.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));

const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const lib = await import(href("src/lib/e-invoice.ts"));
const { default: eInvoicesApp } = await import(href("src/api/routes/e-invoices.ts"));

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

test("amounts are written from sen without float drift", () => {
  assert.equal(lib.senToAmount(135027), "1350.27");
  assert.equal(lib.senToAmount(5), "0.05");
  assert.equal(lib.senToAmount(100000), "1000.00");
  assert.equal(lib.senToAmount(-150), "-1.50");
});

test("the XML escapes the buyer, carries the invoice's own tax, and never invents a TIN", () => {
  const base = { invoiceNo: "INV-2610-001", issueDate: "2026-10-08", buyerName: "A & B <Home>", buyerBrn: "", subtotalSen: 125025, taxSen: 10002, totalSen: 135027 };
  const taxed = lib.buildEInvoiceXml({ ...base, buyerTin: "C12345678901" });
  assert.match(taxed, /<cbc:RegistrationName>A &amp; B &lt;HOME&gt;<\/cbc:RegistrationName>/);
  assert.match(taxed, /<cbc:ID schemeID="TIN">C12345678901<\/cbc:ID>/);
  assert.match(taxed, /<cbc:TaxAmount currencyID="MYR">100\.02<\/cbc:TaxAmount>/);
  assert.match(taxed, /<cbc:TaxableAmount currencyID="MYR">1250\.25<\/cbc:TaxableAmount>/);
  assert.match(taxed, /<cac:TaxCategory><cbc:ID>01<\/cbc:ID><cbc:Percent>8<\/cbc:Percent><\/cac:TaxCategory>/);
  assert.match(taxed, /<cbc:PayableAmount currencyID="MYR">1350\.27<\/cbc:PayableAmount>/);
  assert.doesNotMatch(taxed, /schemeID="BRN">[^<]*<\/cbc:ID><\/cac:PartyIdentification>\n\s*<cac:PartyLegalEntity><cbc:RegistrationName>A &amp;/, "no empty buyer BRN line");
  // The prefixed elements are declared, so the document is well-formed XML.
  assert.match(taxed, /xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"/);
  assert.match(taxed, /xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"/);

  const untaxed = lib.buildEInvoiceXml({ ...base, buyerTin: "", buyerBrn: "201901000001", subtotalSen: 50000, taxSen: 0, totalSen: 50000 });
  assert.match(untaxed, /<cbc:ID schemeID="TIN">— MISSING —<\/cbc:ID>/);
  assert.doesNotMatch(untaxed, /EI00000000010/, "no general-public TIN borrowed for a missing one");
  assert.match(untaxed, /<cbc:ID schemeID="BRN">201901000001<\/cbc:ID>/);
  assert.match(untaxed, /<cac:TaxCategory><cbc:ID>06<\/cbc:ID><\/cac:TaxCategory>/);
});

test("each status has one next step, and the four cards count by Malaysia month", () => {
  assert.equal(lib.eInvoiceNextStep("PENDING"), "mark");
  assert.equal(lib.eInvoiceNextStep("INVALID"), "mark");
  assert.equal(lib.eInvoiceNextStep("REJECTED"), "mark");
  assert.equal(lib.eInvoiceNextStep("SUBMITTED"), "record");
  assert.equal(lib.eInvoiceNextStep("VALID"), "cancel");
  assert.equal(lib.eInvoiceNextStep("CANCELLED"), null);
  assert.deepEqual([...lib.E_INVOICE_STATUSES], ["PENDING", "SUBMITTED", "VALID", "INVALID", "REJECTED", "CANCELLED"]);
  // 31 Oct 17:00 UTC is 1 Nov in Malaysia.
  assert.equal(lib.mytMonth("2026-10-31T17:00:00.000Z"), "2026-11");
  const k = lib.eInvoiceKpis(
    [
      { status: "VALID", submissionId: "S1", submittedAt: "2026-10-31T17:00:00.000Z" },
      { status: "SUBMITTED", submissionId: "S2", submittedAt: "2026-11-02T01:00:00.000Z" },
      { status: "PENDING" },
      { status: "INVALID" },
      { status: "REJECTED", submissionId: "S3", submittedAt: "2026-10-30T01:00:00.000Z" },
    ],
    "2026-11",
  );
  assert.deepEqual(k, { uploadedMtd: 2, validated: 1, notSent: 1, waitingLhdn: 1, invalidRejected: 2 });
});

// ---------------------------------------------------------------------------
// The route, against an in-memory book
// ---------------------------------------------------------------------------

function makeDb() {
  const invoices = [
    { id: "inv-1", invoiceNo: "INV-2610-001", invoiceDate: "2026-10-08", customerName: "A & B Home", customerId: "cust-1", subtotalSen: 125025, taxSen: 10002, totalSen: 135027, status: "SENT", isOpening: 0, orgId: "hookka" },
    { id: "inv-2", invoiceNo: "INV-2610-002", invoiceDate: "2026-10-09", customerName: "No Tin Trading", customerId: "cust-2", subtotalSen: 50000, taxSen: 0, totalSen: 50000, status: "SENT", isOpening: 0, orgId: "hookka" },
    { id: "inv-3", invoiceNo: "INV-2610-003", invoiceDate: "2026-10-10", customerName: "Draft Co", customerId: "cust-1", subtotalSen: 1000, taxSen: 0, totalSen: 1000, status: "DRAFT", isOpening: 0, orgId: "hookka" },
    { id: "inv-9", invoiceNo: "INV-2610-009", invoiceDate: "2026-10-10", customerName: "Other Org", customerId: "cust-9", subtotalSen: 1000, taxSen: 0, totalSen: 1000, status: "SENT", isOpening: 0, orgId: "acme" },
  ];
  const kyc = new Map([["cust-1", { customer_id: "cust-1", tin_number: "C12345678901" }]]);
  const customers = new Map([["cust-1", { ssmNo: "201901000001" }]]);
  const einv = [
    { id: "einv-acme", invoiceId: "inv-9", invoiceNo: "INV-2610-009", customerName: "Other Org", status: "VALID", uuid: "ACME-UUID", orgId: "acme", totalExcludingTax: 1000, taxAmount: 0, totalIncludingTax: 1000, createdAt: "2026-10-10T00:00:00.000Z" },
  ];
  const ddl = [];
  const rowOf = (r) => ({ customerTIN: null, submissionId: null, uuid: null, submittedAt: null, validatedAt: null, errorMessage: null, xmlContent: null, ...r });

  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    let b = [];
    const one = () => {
      if (/^SELECT id, invoiceNo, invoiceDate, customerName, customerId, subtotalSen, taxSen, totalSen, status, isOpening FROM invoices WHERE id = \? AND orgId = \?$/.test(s)) {
        return invoices.find((r) => r.id === b[0] && r.orgId === b[1]) ?? null;
      }
      if (/^SELECT id FROM e_invoices WHERE invoiceId = \? AND orgId = \?$/.test(s)) {
        return einv.find((r) => r.invoiceId === b[0] && r.orgId === b[1]) ?? null;
      }
      if (/^SELECT \* FROM customer_onboarding WHERE customer_id = \?$/.test(s)) return kyc.get(b[0]) ?? null;
      if (/^SELECT ssmNo FROM customers WHERE id = \?$/.test(s)) return customers.get(b[0]) ?? null;
      if (/^SELECT \* FROM e_invoices WHERE id = \? AND orgId = \?$/.test(s)) {
        const r = einv.find((x) => x.id === b[0] && x.orgId === b[1]);
        return r ? rowOf(r) : null;
      }
      if (/^SELECT invoiceNo FROM e_invoices WHERE uuid = \? AND id <> \? AND orgId = \?$/.test(s)) {
        return einv.find((x) => x.uuid === b[0] && x.id !== b[1] && x.orgId === b[2]) ?? null;
      }
      return null;
    };
    const obj = {
      bind(...args) { b = args; return obj; },
      async first() { return one(); },
      async all() {
        if (/FROM pg_constraint/.test(s)) {
          return { results: [{ conname: "e_invoices_status_check", def: "CHECK ((status = ANY (ARRAY['PENDING'::text, 'SUBMITTED'::text, 'VALID'::text, 'INVALID'::text, 'CANCELLED'::text])))" }] };
        }
        if (/^SELECT \* FROM e_invoices WHERE orgId = \? ORDER BY created_at DESC$/.test(s)) {
          return { results: einv.filter((r) => r.orgId === b[0]).map(rowOf) };
        }
        return { results: [] };
      },
      async run() {
        if (/^ALTER TABLE e_invoices/.test(s)) { ddl.push(s); return { success: true }; }
        const ins = s.match(/^INSERT INTO e_invoices \(([^)]*)\) VALUES/);
        if (ins) {
          const cols = ins[1].split(",").map((x) => x.trim());
          const row = {};
          cols.forEach((col, i) => { row[col === "created_at" ? "createdAt" : col] = b[i]; });
          for (const k of ["totalExcludingTax", "taxAmount", "totalIncludingTax"]) {
            if (!Number.isInteger(row[k])) throw new Error(`invalid input syntax for type integer: "${row[k]}"`);
          }
          einv.push(row);
          return { success: true };
        }
        const up = s.match(/^UPDATE e_invoices SET (.*) WHERE id = \? AND orgId = \?$/);
        if (up) {
          const sets = up[1].split(",").map((x) => x.trim());
          let i = 0;
          const patch = {};
          for (const a of sets) {
            const [col, val] = a.split("=").map((x) => x.trim());
            patch[col] = val === "?" ? b[i++] : null;
          }
          for (const k of ["totalExcludingTax", "taxAmount", "totalIncludingTax"]) {
            if (k in patch && !Number.isInteger(patch[k])) throw new Error(`invalid input syntax for type integer: "${patch[k]}"`);
          }
          const row = einv.find((x) => x.id === b[i] && x.orgId === b[i + 1]);
          if (row) Object.assign(row, patch);
          return { success: true };
        }
        return { success: true }; // audit rows and the like
      },
    };
    return obj;
  }
  return { db: { prepare, batch: async () => [] }, einv, kyc, ddl };
}

function mount(db, orgId = "hookka") {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("orgId", orgId);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", eInvoicesApp);
  const call = async (method, path, body) => {
    const res = await parent.request(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, {});
    return { status: res.status, body: await res.json() };
  };
  return { call };
}

test("the first update widens the status check to all six, found in the catalogue", async () => {
  const { db, ddl } = makeDb();
  const { call } = mount(db);
  const gen = await call("POST", "/", { invoiceId: "inv-1" });
  assert.equal(gen.status, 201);
  await call("PUT", `/${gen.body.data.id}`, { action: "cancel" });
  assert.ok(ddl.includes('ALTER TABLE e_invoices DROP CONSTRAINT IF EXISTS "e_invoices_status_check"'), ddl.join("\n"));
  assert.ok(ddl.some((s) => /ADD CONSTRAINT e_invoices_status_chk_v2 CHECK \(status IN \('PENDING','SUBMITTED','VALID','INVALID','REJECTED','CANCELLED'\)\) NOT VALID/.test(s)), ddl.join("\n"));
});

test("Generate keeps the invoice's figures in sen — a total with cents saves (BUG-2026-10-20-345)", async () => {
  const { db, einv } = makeDb();
  const { call } = mount(db);
  const r = await call("POST", "/", { invoiceId: "inv-1" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.status, "PENDING");
  assert.equal(r.body.data.totalIncludingTax, 135027);
  assert.equal(r.body.data.taxAmount, 10002);
  assert.equal(r.body.data.totalExcludingTax, 125025);
  assert.equal(r.body.data.customerTIN, "C12345678901");
  assert.equal(r.body.data.errorMessage, undefined);
  assert.match(r.body.data.xmlContent, /<cbc:PayableAmount currencyID="MYR">1350\.27<\/cbc:PayableAmount>/);
  assert.match(r.body.data.xmlContent, /schemeID="BRN">201901000001</);
  assert.equal(einv.find((x) => x.id === r.body.data.id).orgId, "hookka");

  const again = await call("POST", "/", { invoiceId: "inv-1" });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "INV-2610-001 already has an e-Invoice.");
  const draft = await call("POST", "/", { invoiceId: "inv-3" });
  assert.equal(draft.status, 400);
  assert.match(draft.body.error, /INV-2610-003 is DRAFT/);
  const foreign = await call("POST", "/", { invoiceId: "inv-9" });
  assert.equal(foreign.status, 404, "another org's invoice is not found");
});

test("a buyer with no TIN: flagged at Generate, refused at Mark as Submitted, sent once the TIN is added", async () => {
  const { db, kyc } = makeDb();
  const { call } = mount(db);
  const gen = await call("POST", "/", { invoiceId: "inv-2" });
  assert.equal(gen.status, 201);
  assert.equal(gen.body.data.errorMessage, lib.MISSING_TIN_ON_GENERATE);
  assert.match(gen.body.data.xmlContent, /schemeID="TIN">— MISSING —</);
  const id = gen.body.data.id;

  const noId = await call("PUT", `/${id}`, { action: "mark-submitted", submissionId: "   " });
  assert.equal(noId.status, 400);
  assert.equal(noId.body.error, "Key the Submission ID MyInvois gave you.");

  const refused = await call("PUT", `/${id}`, { action: "mark-submitted", submissionId: "SUB-1" });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.data.status, "INVALID");
  assert.equal(refused.body.data.errorMessage, lib.MISSING_TIN_ON_MARK);
  assert.equal(refused.body.data.submissionId, undefined, "not recorded as sent");

  kyc.set("cust-2", { customer_id: "cust-2", tinNumber: "C99999999999" });
  const sent = await call("PUT", `/${id}`, { action: "mark-submitted", submissionId: " SUB-1 " });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.data.status, "SUBMITTED");
  assert.equal(sent.body.data.submissionId, "SUB-1");
  assert.ok(sent.body.data.submittedAt);
  assert.equal(sent.body.data.customerTIN, "C99999999999");
  assert.equal(sent.body.data.errorMessage, undefined);
  assert.match(sent.body.data.xmlContent, /schemeID="TIN">C99999999999</, "the XML is rebuilt with the TIN");
});

test("Record Result: Valid only with a keyed UUID; one UUID per e-invoice; Rejected keeps the reason and can be sent again", async () => {
  const { db, einv } = makeDb();
  const { call } = mount(db);
  const a = (await call("POST", "/", { invoiceId: "inv-1" })).body.data.id;
  const early = await call("PUT", `/${a}`, { action: "record-result", result: "VALID", uuid: "U-1" });
  assert.equal(early.status, 409, "a Pending one has no LHDN result to record");
  await call("PUT", `/${a}`, { action: "mark-submitted", submissionId: "SUB-7" });

  const noUuid = await call("PUT", `/${a}`, { action: "record-result", result: "VALID", uuid: "" });
  assert.equal(noUuid.status, 400);
  assert.equal(noUuid.body.error, "Key the UUID LHDN issued — nothing turns Valid without it.");
  assert.equal(einv.find((x) => x.id === a).status, "SUBMITTED");

  const valid = await call("PUT", `/${a}`, { action: "record-result", result: "VALID", uuid: " U-1 " });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.data.status, "VALID");
  assert.equal(valid.body.data.uuid, "U-1");
  assert.ok(valid.body.data.validatedAt);

  // A second e-invoice cannot take the same UUID.
  einv.push({ id: "einv-b", invoiceId: "inv-x", invoiceNo: "INV-2610-010", status: "SUBMITTED", orgId: "hookka", totalExcludingTax: 0, taxAmount: 0, totalIncludingTax: 0 });
  const clash = await call("PUT", "/einv-b", { action: "record-result", result: "VALID", uuid: "U-1" });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, "That UUID is already recorded on INV-2610-001.");

  const noReason = await call("PUT", "/einv-b", { action: "record-result", result: "REJECTED", reason: " " });
  assert.equal(noReason.status, 400);
  const rejected = await call("PUT", "/einv-b", { action: "record-result", result: "REJECTED", reason: "Buyer TIN not valid" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(rejected.body.data.errorMessage, "Buyer TIN not valid");
  assert.equal(lib.eInvoiceNextStep(rejected.body.data.status), "mark", "fix and send again");
});

test("Cancel only a Valid one; the old Submit still refuses; another org's record is not found", async () => {
  const { db, einv } = makeDb();
  const { call } = mount(db);
  const id = (await call("POST", "/", { invoiceId: "inv-1" })).body.data.id;
  await call("PUT", `/${id}`, { action: "mark-submitted", submissionId: "SUB-8" });
  const tooEarly = await call("PUT", `/${id}`, { action: "cancel" });
  assert.equal(tooEarly.status, 400);
  assert.match(tooEarly.body.error, /only a Valid e-invoice can be cancelled/);

  const submit = await call("PUT", `/${id}`, { action: "submit" });
  assert.equal(submit.status, 501);
  assert.equal(einv.find((x) => x.id === id).status, "SUBMITTED", "the refused submit changed nothing");

  await call("PUT", `/${id}`, { action: "record-result", result: "VALID", uuid: "U-9" });
  const cancelled = await call("PUT", `/${id}`, { action: "cancel" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, "CANCELLED");

  assert.equal((await call("PUT", "/einv-acme", { action: "cancel" })).status, 404);
  assert.equal((await call("GET", "/einv-acme")).status, 404);
  const list = await call("GET", "/");
  assert.ok(!list.body.data.some((r) => r.id === "einv-acme"), "the list is this org's only");
  assert.equal((await call("PUT", `/${id}`, { action: "nope" })).status, 400);
});

// ---------------------------------------------------------------------------
// What the SQL and the page promise
// ---------------------------------------------------------------------------

const api = readFileSync("src/api/routes/e-invoices.ts", "utf8").replace(/\r\n/g, "\n");
const page = readFileSync("src/pages/invoices/e-invoice.tsx", "utf8").replace(/\r\n/g, "\n");

test("the Generate list: this org's issued invoices without an e-invoice, opening balances left out, before /:id", () => {
  const cand = api.slice(api.indexOf('app.get("/candidates"'), api.indexOf('app.post("/"'));
  assert.match(cand, /WHERE i\.orgId = \?/);
  assert.match(cand, /AND i\.status NOT IN \('DRAFT','CANCELLED'\)/);
  assert.match(cand, /AND COALESCE\(i\.isOpening, 0\) = 0/);
  assert.match(cand, /AND NOT EXISTS \(SELECT 1 FROM e_invoices e WHERE e\.invoiceId = i\.id\)/);
  assert.match(cand, /LEFT JOIN customer_onboarding co ON co\.customer_id = i\.customerId/);
  assert.match(cand, /buyerTin: s\(r, "tinNumber", "tin_number"\)\.trim\(\),/);
  assert.ok(api.indexOf('app.get("/candidates"') < api.indexOf('app.get("/:id"'));
  // Every write to the record is this org's (the comments quote the old,
  // removed Submit, so they are left out).
  const code = api.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const updates = [...code.matchAll(/UPDATE e_invoices SET [\s\S]*?["`]/g)];
  assert.equal(updates.length, 5, "INVALID, SUBMITTED, VALID, REJECTED, CANCELLED");
  for (const m of updates) {
    assert.match(m[0], /WHERE id = \? AND orgId = \?/, m[0]);
  }
});

test("the page: the design's four cards, the three steps, Generate All Ready for buyers with a TIN, every refusal shown", () => {
  for (const label of ["Uploaded (MTD)", "Validated by LHDN", "Waiting", "Invalid / Rejected"]) {
    assert.ok(page.includes(`{ label: "${label}"`), label);
  }
  assert.match(page, /\{ label: "Ready to generate", value: String\(candidates\.length\)/);
  for (const t of ["Uploaded To MyInvois", "Where It Is", "Buyer TIN", "Sales Invoices Without An e-Invoice", "Copy XML", "Download"]) {
    assert.ok(page.includes(t), t);
  }
  assert.match(page, /onClick=\{\(\) => generate\(readyWithTin\.map\(\(c\) => c\.id\)\)\}/);
  assert.match(page, /const readyWithTin = useMemo\(\(\) => candidates\.filter\(\(c\) => c\.buyerTin\), \[candidates\]\);/);
  assert.match(page, /\{ action: "mark-submitted", submissionId: submissionId\.trim\(\) \}/);
  assert.match(page, /\{ action: "record-result", result, uuid: uuid\.trim\(\) \}/);
  assert.match(page, /disabled=\{busy \|\| \(result === "VALID" \? !uuid\.trim\(\) : !reason\.trim\(\)\)\}/);
  assert.doesNotMatch(page, /action: "submit"/, "the page never asks for the LHDN transmission");
  assert.doesNotMatch(page, /notify LHDN/, "cancelling here sends nothing");
  assert.match(page, /setDialogError\(json\?\.error \?\? `Not saved \(HTTP \$\{res\.status\}\)\.`\);/);
  assert.match(page, /if \(!res\.ok \|\| !json\?\.success\) failed\.push\(json\?\.error \?\? `HTTP \$\{res\.status\}`\);/);
});

test("the phone list reads the gross total and the record's six statuses", () => {
  const m = readFileSync("src/pages/m/config/modules.ts", "utf8").replace(/\r\n/g, "\n");
  const src = m.slice(m.indexOf("const eInvoiceSource: DataSource = {"), m.indexOf("// Invoice detail — single-GET"));
  assert.match(src, /meta1: \{ label: "Amount", value: money\(num\(r, "totalIncludingTax"\)\) \}/);
  assert.match(src, /resolveStatus\(str\(r, "status"\), E_INVOICE_STATUS_MAP\)/);
  assert.match(src, /\["PENDING", "SUBMITTED", "VALID", "INVALID", "REJECTED", "CANCELLED"\]/);
  assert.doesNotMatch(src, /totalSen/);
});
