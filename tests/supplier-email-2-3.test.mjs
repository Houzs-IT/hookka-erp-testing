// P6 (cross-system review 2026-11-10, ported from Houzs#5435): the PO email
// goes To the supplier's main Email and Cc's their Email 2 and Email 3.
// Pure helpers directly; the column self-apply, form and composer wiring by
// source pattern (house style).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { poEmailRecipients, supplierExtraEmailError, isOneEmailAddress } from "../src/lib/supplier-emails.ts";
import { buildPoEmailDraft } from "../src/lib/po-email-draft.ts";

const read = (p) => readFileSync(p, "utf8");

test("To = main Email (all its addresses), Cc = Email 2 and Email 3", () => {
  assert.deepEqual(
    poEmailRecipients({ email: "sales@acme.my, acc@acme.my", email2: "boss@acme.my", email3: "ops@acme.my" }),
    { to: ["sales@acme.my", "acc@acme.my"], cc: ["boss@acme.my", "ops@acme.my"] },
  );
});

test("Cc never repeats a To address or itself (any case), and skips blanks / junk", () => {
  assert.deepEqual(
    poEmailRecipients({ email: "sales@acme.my", email2: "SALES@acme.my", email3: "Boss@Acme.my" }),
    { to: ["sales@acme.my"], cc: ["Boss@Acme.my"] },
  );
  assert.deepEqual(poEmailRecipients({ email: "a@x.my", email2: "", email3: "not-an-email" }), { to: ["a@x.my"], cc: [] });
  assert.deepEqual(poEmailRecipients({ email: "a@x.my", email2: "b@x.my", email3: "b@x.my" }), { to: ["a@x.my"], cc: ["b@x.my"] });
});

test("with the main Email blank, Email 2 moves up to To", () => {
  assert.deepEqual(poEmailRecipients({ email: "", email2: "b@x.my", email3: "c@x.my" }), { to: ["b@x.my"], cc: ["c@x.my"] });
  assert.deepEqual(poEmailRecipients({ email: "", email2: "", email3: "" }), { to: [], cc: [] });
});

test("the PO draft carries the Cc; a supplier with no address at all has no draft", () => {
  const d = buildPoEmailDraft({
    poNo: "PO-2611-001",
    supplierName: "Acme",
    supplierEmail: "sales@acme.my",
    supplierEmail2: "boss@acme.my",
    supplierEmail3: null,
    companyName: "HOOKKA",
    pdfBase64: "AAAA",
  });
  assert.deepEqual(d.to, ["sales@acme.my"]);
  assert.deepEqual(d.cc, ["boss@acme.my"]);
  assert.equal(
    buildPoEmailDraft({ poNo: "P", supplierName: "A", supplierEmail: "", companyName: "H", pdfBase64: "AAAA" }),
    null,
  );
});

test("Email 2 / Email 3 hold one valid address each; blank clears", () => {
  assert.equal(supplierExtraEmailError({ email2: "b@x.my", email3: "" }), null);
  assert.equal(supplierExtraEmailError({}), null);
  assert.match(supplierExtraEmailError({ email2: "a@x.my, b@x.my" }), /Email 2 \(a@x\.my, b@x\.my\) is not a valid email address/);
  assert.match(supplierExtraEmailError({ email3: "nope" }), /Email 3/);
  assert.match(supplierExtraEmailError({ email2: 5 }), /must be text/);
  assert.equal(isOneEmailAddress(" a@x.my "), true);
});

test("server: snake_case columns self-applied before the first write, dual-keyed read, validated", () => {
  const src = read("src/api/routes/suppliers.ts");
  assert.match(src, /ADD COLUMN IF NOT EXISTS email_2 TEXT NOT NULL DEFAULT ''/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS email_3 TEXT NOT NULL DEFAULT ''/);
  assert.equal((src.match(/await ensureSupplierEmailColumns\(c\.var\.DB\);/g) ?? []).length, 2);
  assert.match(src, /email2: \(row\.email2 \?\? row\.email_2 \?\? ""\)\.trim\(\)/);
  assert.match(src, /UPDATE suppliers SET email_2 = \?, email_3 = \? WHERE id = \?/);
  assert.equal((src.match(/supplierExtraEmailError\(body\)/g) ?? []).length, 2);
  // POST + PUT: the self-apply runs before the handler's first statement.
  for (const route of ['app.post("/", async (c) => {', 'app.put("/:id", async (c) => {']) {
    const at = src.indexOf(route);
    const body = src.slice(at, at + 600);
    assert.ok(body.indexOf("ensureSupplierEmailColumns") > 0, route);
    assert.ok(body.indexOf("ensureSupplierEmailColumns") < body.indexOf("c.req.json()"), route);
  }
});

test("form, detail, maintenance and composer carry Email 2 / Email 3 and the Cc", () => {
  const form = read("src/pages/procurement/supplier-form-dialog.tsx");
  assert.match(form, />Email 2</);
  assert.match(form, />Email 3</);
  assert.match(form, /email2: email2\.trim\(\), email3: email3\.trim\(\)/);
  const detail = read("src/pages/suppliers/detail.tsx");
  assert.match(detail, /email2: supplier\.email2,\n\s+email3: supplier\.email3,/);
  const maint = read("src/pages/procurement/maintenance.tsx");
  assert.match(maint, /email2: String\(s\.email2 \?\? ""\),/);
  const po = read("src/pages/procurement/detail.tsx");
  assert.match(po, /supplierEmail2: sup\?\.email2,\n\s+supplierEmail3: sup\?\.email3,/);
  const compose = read("src/pages/mail-center/compose.tsx");
  assert.match(compose, /cc\?: string\[\];/);
  assert.match(compose, /const seedCc = seed \? seed\.cc \?\? \[\] : draftCc;/);
});
