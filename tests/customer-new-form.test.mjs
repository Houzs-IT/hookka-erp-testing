// New Customer card asks for more (owner 2026-11-11 「而且我create customer 填的
// 资料这么少罢了嘛？」 → 「做」, WORK-TRACKER 138): SSM No., company address and
// salesperson go on the customer row; TIN / SST Reg. No. / e-Invoice ID go to the
// customer's Onboarding / KYC block, in the same single save as the consent tick.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EMPTY_NEW_CUSTOMER, newCustomerCreateBody, newCustomerOnboardingBody } from "../src/lib/customer-new-form.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("the empty form keeps the old defaults and adds the six new fields blank", () => {
  assert.deepEqual(EMPTY_NEW_CUSTOMER, {
    code: "", name: "", contactName: "", phone: "", email: "", creditTerms: "NET30", creditLimitSen: 0,
    ssmNo: "", companyAddress: "", salespersonUserId: "", tinNumber: "", sstRegNo: "", einvoiceId: "",
  });
});

test("create body: the customer's own fields, trimmed; the KYC ids stay out of it", () => {
  const f = {
    ...EMPTY_NEW_CUSTOMER, code: "300-Z", name: "Acme", ssmNo: " 201901012345 ", companyAddress: " 1 Jalan Test ",
    salespersonUserId: "u-1", tinNumber: "C1", sstRegNo: "S1", einvoiceId: "E1",
  };
  const b = newCustomerCreateBody(f, false);
  assert.equal(b.code, "300-Z");
  assert.equal(b.name, "Acme");
  assert.equal(b.ssmNo, "201901012345");
  assert.equal(b.companyAddress, "1 Jalan Test");
  assert.equal(b.salespersonUserId, "u-1");
  assert.equal(b.creditTerms, "NET30");
  assert.equal(b.creditLimitSen, 0);
  assert.equal(b.customerStage, "CONFIRMED");
  for (const k of ["tinNumber", "sstRegNo", "einvoiceId"]) assert.ok(!(k in b), `${k} goes to Onboarding / KYC, not the customer row`);
  assert.equal(newCustomerCreateBody(f, true).customerStage, "POTENTIAL");
});

test("onboarding body: nothing typed and no consent uploaded → no request", () => {
  assert.equal(newCustomerOnboardingBody("c1", EMPTY_NEW_CUSTOMER, false, "2026-11-11"), null);
  assert.equal(newCustomerOnboardingBody("c1", { ...EMPTY_NEW_CUSTOMER, tinNumber: "   " }, false, "2026-11-11"), null);
});

test("onboarding body: the ids and the consent tick travel in ONE request (the PUT overwrites every column)", () => {
  const f = { ...EMPTY_NEW_CUSTOMER, tinNumber: " C2584563200 ", sstRegNo: "W10-0000-00000000", einvoiceId: "" };
  assert.deepEqual(newCustomerOnboardingBody("c1", f, true, "2026-11-11"), {
    customerId: "c1", tinNumber: "C2584563200", sstRegNo: "W10-0000-00000000", einvoiceId: "", consentReceived: true, consentDate: "2026-11-11",
  });
  assert.deepEqual(newCustomerOnboardingBody("c1", f, false, "2026-11-11"), {
    customerId: "c1", tinNumber: "C2584563200", sstRegNo: "W10-0000-00000000", einvoiceId: "", consentReceived: false, consentDate: null,
  });
  // A signed form with no ids typed still records the tick.
  assert.deepEqual(newCustomerOnboardingBody("c1", EMPTY_NEW_CUSTOMER, true, "2026-11-11"), {
    customerId: "c1", tinNumber: "", sstRegNo: "", einvoiceId: "", consentReceived: true, consentDate: "2026-11-11",
  });
});

test("customers page: the New Customer card shows the six fields and saves through the helpers", () => {
  const page = read("src/pages/customers.tsx");
  for (const k of ["ssmNo", "companyAddress", "salespersonUserId", "tinNumber", "sstRegNo", "einvoiceId"]) {
    assert.match(page, new RegExp(`value=\\{addForm\\.${k}\\}`), `the card has an input for ${k}`);
  }
  assert.match(page, /JSON\.stringify\(newCustomerCreateBody\(addForm, addingPotential\)\)/);
  assert.match(page, /newCustomerOnboardingBody\(newId, addForm, consentUploaded, todayYmdMY\(\)\)/);
  // One onboarding save after the create — a second PUT would blank what the first wrote.
  const addBlock = page.slice(page.indexOf("const handleAdd = async"), page.indexOf("// ---------- Delete ----------"));
  assert.equal((addBlock.match(/\/api\/customer-crm\/onboarding/g) ?? []).length, 1);
  // A failed KYC save never undoes the customer — it says where to finish it.
  assert.match(addBlock, /Customer created, but its TIN \/ SST \/ e-Invoice or consent details did not save/);
  assert.match(page, /setAddForm\(EMPTY_NEW_CUSTOMER\)/);
});
