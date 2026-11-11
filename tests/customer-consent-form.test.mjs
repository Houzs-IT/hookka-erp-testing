// Customer consent form (owner 2026-11-11, WORK-TRACKER 134: 「加新的customer
// 时可以下载consent form 给顾客填，填了后upload 会上去」; sample:
// Consent-Form_CCRIS_V2_0_19042019-SME-Score.docx — the CTOS / CCRIS consent
// letter). The blank form ships as PDF and Word; the signed copy is a file on
// the customer (resourceType CUSTOMER_CONSENT), gated like the customer: it
// carries IC numbers and phone numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

import { flowFileResource } from "../src/lib/flow-files.ts";
import { CONSENT_FORM_DOCX, CONSENT_FORM_PDF, CUSTOMER_CONSENT_TYPE } from "../src/lib/customer-consent.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("a signed consent form is a customer file: viewing needs customers:read, uploading customers:update", () => {
  assert.equal(CUSTOMER_CONSENT_TYPE, "CUSTOMER_CONSENT");
  assert.equal(flowFileResource(CUSTOMER_CONSENT_TYPE), "customers");
});

test("the blank form ships as PDF and Word, from the owner's sample", () => {
  assert.equal(CONSENT_FORM_PDF, "/forms/hookka-ctos-consent-form.pdf");
  assert.equal(CONSENT_FORM_DOCX, "/forms/hookka-ctos-consent-form.docx");
  const pdf = readFileSync("public" + CONSENT_FORM_PDF);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 10_000);
  const docx = readFileSync("public" + CONSENT_FORM_DOCX);
  assert.equal(docx.subarray(0, 2).toString(), "PK", "a Word file is a zip");
  assert.ok(statSync("public" + CONSENT_FORM_DOCX).size > 10_000);
  // The service worker leaves /forms/ to the network: a replaced form is never served stale.
  assert.match(read("public/sw.js"), /if \(url\.pathname\.startsWith\('\/forms\/'\)\) return;/);
});

test("customers page: the new-customer card offers the blank form and uploads a signed copy once the customer exists", () => {
  const page = read("src/pages/customers.tsx");
  assert.match(page, /href=\{CONSENT_FORM_PDF\}/);
  assert.match(page, /href=\{CONSENT_FORM_DOCX\}/);
  assert.match(page, /await uploadConsentForm\(json\.data\.id, addConsentFile\)/);
  // An upload that fails never undoes the customer: it says so and points to the customer.
  assert.match(page, /Customer created, but the consent form did not upload/);
  // A successful upload ticks "Consent letter received" with today's date.
  assert.match(page, /consentReceived: true, consentDate: todayYmdMY\(\)/);
  // The open customer's Onboarding / KYC panel offers the blank form and lists,
  // adds and removes the signed copies through the shared attachments card.
  assert.match(page, /<KycPanel customerId=\{cust\.id\} \/>/);
  const kyc = read("src/components/customer/KycPanel.tsx");
  assert.match(kyc, /<FlowFilesCard\s+resourceType=\{CUSTOMER_CONSENT_TYPE\}\s+resourceId=\{customerId\}/);
  assert.match(kyc, /href=\{CONSENT_FORM_PDF\}/);
});
