// ---------------------------------------------------------------------------
// Finance v2 party fields (owner 2026-10-17, 「这些都做」): TIN, SST Reg. No.,
// Currency and Bank & account no. on customers, suppliers and other parties.
//   - a customer's TIN and SST Reg. No. live in its Onboarding / KYC block
//     (customer_onboarding); currency and bank on the customer itself;
//   - suppliers already stored TIN (tax_entity_tin), SSM (registration_no)
//     and currency — they gain SST and bank, and the form finally edits all;
//   - other parties gain SST, currency and bank.
// New columns are snake_case and self-applied before the first write; reads
// are dual-keyed. Pins, on the way:
//   BUG-2026-10-17-312 — a customer's default company read snake_case only:
//     always '' on screen, and the next edit saved '' over it;
//   BUG-2026-10-17-313 — the KYC block read snake_case only: blank after every
//     reload, and the next Save wrote the blanks (and a null "docs requested").
// Made-up values only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { PARTY_CURRENCIES, partyCurrencyOptions, normalisePartyCurrency, partyText } from "../src/lib/party-finance.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? undefined : j); };

test("the shared helpers: MYR default, a stored code outside the list is kept", () => {
  assert.deepEqual([...PARTY_CURRENCIES], ["MYR", "RMB", "USD", "SGD", "EUR"]);
  assert.deepEqual(partyCurrencyOptions("JPY"), ["MYR", "RMB", "USD", "SGD", "EUR", "JPY"]);
  assert.deepEqual(partyCurrencyOptions("usd"), ["MYR", "RMB", "USD", "SGD", "EUR"]);
  assert.equal(normalisePartyCurrency(""), "MYR");
  assert.equal(normalisePartyCurrency(" rmb "), "RMB");
  assert.equal(normalisePartyCurrency(undefined), "MYR");
  assert.equal(partyText("  Maybank 1  "), "Maybank 1");
  assert.equal(partyText(null), "");
});

test("customers: currency and bank self-applied, written on create and edit, read dual-keyed", () => {
  const api = read("src/api/routes/customers.ts");
  assert.match(api, /ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MYR'/);
  assert.match(api, /ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account TEXT NOT NULL DEFAULT ''/);
  const post = between(api, 'app.post("/", async (c) => {', "\napp.");
  assert.match(post, /await ensureCustomerFinanceColumns\(c\.var\.DB\);/);
  assert.match(post, /customer_stage, salesperson_user_id, orgId, currency, bank_account\)/);
  const put = between(api, 'app.put("/:id", async (c) => {', "\napp.");
  assert.match(put, /await ensureCustomerFinanceColumns\(c\.var\.DB\);/);
  assert.match(put, /currency: body\.currency !== undefined \? normalisePartyCurrency\(body\.currency\) : normalisePartyCurrency\(existing\.currency\),/);
  assert.match(put, /bank_account: body\.bankAccount !== undefined \? partyText\(body\.bankAccount\) : \(existing\.bankAccount \?\? existing\.bank_account \?\? ""\),/);
  assert.match(put, /salesperson_user_id = \?, currency = \?, bank_account = \?\n\s*WHERE id = \?/);
  const map = between(api, "function rowToCustomer(", "\nfunction ");
  assert.match(map, /currency: normalisePartyCurrency\(row\.currency\),/);
  assert.match(map, /bankAccount: \(row\.bankAccount \?\? row\.bank_account \?\? ""\)\.trim\(\),/);
});

test("BUG-2026-10-17-312: a customer's default company is read camelCase first, on GET and on edit", () => {
  const api = read("src/api/routes/customers.ts");
  assert.match(api, /defaultCompanyCode: \(row\.defaultCompanyCode \?\? row\.default_company_code \?\? ""\)\.trim\(\)\.toUpperCase\(\),/);
  assert.match(api, /: \(existing\.defaultCompanyCode \?\? existing\.default_company_code \?\? ""\),/);
  assert.doesNotMatch(api, /defaultCompanyCode: \(row\.default_company_code \?\? ""\)/);
});

test("BUG-2026-10-17-313: the KYC block reads what the API returns and never saves blanks over it", () => {
  const ui = read("src/components/customer/KycPanel.tsx");
  assert.match(ui, /tinNumber: d\.tinNumber \?\? d\.tin_number \?\? "",/);
  assert.match(ui, /sstRegNo: d\.sstRegNo \?\? d\.sst_reg_no \?\? "",/);
  assert.match(ui, /einvoiceId: d\.einvoiceId \?\? d\.einvoice_id \?\? "",/);
  assert.match(ui, /consentReceived: !!\(d\.consentReceived \?\? d\.consent_received\),/);
  assert.match(ui, /setRequestedAt\(d\.docsRequestedAt \?\? d\.docs_requested_at \?\? null\);/);
  // A plain Save carries the stored "docs requested" date back.
  assert.match(ui, /body: JSON\.stringify\(\{ customerId, \.\.\.form, docsRequestedAt: requestedAt, \.\.\.extra \}\),/);
  assert.match(ui, /SST Reg\. No\./);
  const crm = read("src/api/routes/customer-crm.ts");
  assert.match(crm, /ALTER TABLE customer_onboarding ADD COLUMN IF NOT EXISTS sst_reg_no TEXT/);
  assert.match(crm, /sst_reg_no = excluded\.sst_reg_no,/);
});

test("suppliers: SST and bank self-applied and written in the supplier's own batch; the form edits all five", () => {
  const api = read("src/api/routes/suppliers.ts");
  assert.match(api, /ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sst_reg_no TEXT NOT NULL DEFAULT ''/);
  assert.match(api, /ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_account TEXT NOT NULL DEFAULT ''/);
  assert.match(api, /UPDATE suppliers SET sst_reg_no = \?, bank_account = \? WHERE id = \?/);
  assert.match(api, /await c\.var\.DB\.batch\(\[buildInsert\(true\), \.\.\.finance, \.\.\.matStmts\]\);/);
  assert.match(api, /const financeStmt = supplierFinanceStatement\(c\.var\.DB, id, body, existing\);\n\s*if \(financeStmt\) statements\.push\(financeStmt\);/);
  assert.match(api, /sstRegNo: \(row\.sstRegNo \?\? row\.sst_reg_no \?\? ""\)\.trim\(\),/);
  assert.match(api, /bankAccount: \(row\.bankAccount \?\? row\.bank_account \?\? ""\)\.trim\(\),/);
  const form = read("src/pages/procurement/supplier-form-dialog.tsx");
  assert.match(form, /registrationNo: registrationNo\.trim\(\), taxEntityTin: finance\.tin\.trim\(\), sstRegNo: finance\.sstRegNo\.trim\(\),/);
  assert.match(form, /<PartyFinanceFields value=\{finance\} onChange=\{setFinance\}/);
  // The dialog sends all five on every save, so both pages that open it must
  // load them first — or an edit would blank a stored TIN / SSM / currency.
  const list = read("src/pages/procurement/maintenance.tsx");
  for (const k of ["registrationNo", "taxEntityTin", "sstRegNo", "currency", "bankAccount"]) assert.match(list, new RegExp(`${k}: String\\(s\\.${k} \\?\\? `), k);
  const detail = read("src/pages/suppliers/detail.tsx");
  for (const k of ["registrationNo", "taxEntityTin", "sstRegNo", "bankAccount"]) assert.match(detail, new RegExp(`${k}: supplier\\.${k} \\?\\? "",`), k);
  assert.match(detail, /currency: supplier\.currency \|\| "MYR",/);
});

test("other parties: SST, currency and bank self-applied, written, read; the form uses the shared block", () => {
  const api = read("src/api/routes/accounting.ts");
  for (const col of ["sst_reg_no TEXT NOT NULL DEFAULT ''", "currency TEXT NOT NULL DEFAULT 'MYR'", "bank_account TEXT NOT NULL DEFAULT ''"]) {
    assert.ok(api.includes(`ALTER TABLE other_parties ADD COLUMN IF NOT EXISTS ${col}`), col);
  }
  const post = between(api, 'app.post("/other-parties"', "\napp.");
  assert.match(post, /await ensureOtherPartyFinanceColumns\(c\.var\.DB\);/);
  assert.match(post, /sst_reg_no, currency, bank_account\)/);
  const put = between(api, 'app.put("/other-parties/:id"', "\napp.");
  assert.match(put, /await ensureOtherPartyFinanceColumns\(c\.var\.DB\);/);
  assert.match(put, /sst_reg_no = \?, currency = \?, bank_account = \?/);
  const map = between(api, "function rowToOtherParty(", "\n}\n");
  assert.match(map, /bankAccount: \(r\.bankAccount \?\? r\.bank_account \?\? ""\)\.trim\(\),/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /onChange=\{\(v\) => setForm\(\{ \.\.\.form, tin: v\.tin, sstRegNo: v\.sstRegNo, currency: v\.currency, bankAccount: v\.bankAccount \}\)\}/);
});

test("the customer form edits currency and bank; its TIN / SST stay in the KYC block", () => {
  const ui = read("src/pages/customers.tsx");
  assert.match(ui, /<PartyFinanceFields\s*\n\s*taxIds=\{false\}/);
  assert.match(ui, /currency: cust\.currency \|\| "MYR",\s*\n\s*bankAccount: cust\.bankAccount \|\| "",/);
});

test("an AP payment prints the payee's bank from its master; e-Invoice reads the buyer's TIN from KYC", () => {
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /src\.partyKind === "SUPPLIER" \? "SELECT \* FROM suppliers WHERE id = \?" : "SELECT \* FROM other_parties WHERE id = \?"/);
  assert.match(api, /payeeBank = String\(\(party\?\.bankAccount \?\? party\?\.bank_account\) \?\? ""\)\.trim\(\);/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /\[\{ label: "Payee bank", value: apDetail\?\.payeeBank \?\? "" \}, paidFrom\]/);
  const lib = read("src/lib/supplier-payment-voucher.ts");
  assert.match(lib, /\{ label: "Payee bank", value: detail\?\.payeeBank \?\? "" \}/);
  const einv = read("src/api/routes/e-invoices.ts");
  assert.match(einv, /const customerTIN = String\(body\.customerTIN \?\? ""\)\.trim\(\) \|\| \(await customerKycTin\(c\.var\.DB, invoice\.customerId\)\);/);
  assert.match(einv, /return String\(\(row\?\.tinNumber \?\? row\?\.tin_number\) \?\? ""\)\.trim\(\);/);
});

test("the phone's supplier detail reads the TIN the API sends", () => {
  const m = read("src/pages/m/config/modules.ts");
  assert.match(m, /fld\("TIN", \(d\) => str\(d, "taxEntityTin"\)\),/);
  assert.doesNotMatch(m, /str\(d, "taxId"\)/);
});
