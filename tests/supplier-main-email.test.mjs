// BUG-2026-11-11-504 — owner 2026-11-11 「Supplier term 我edit 了为什么save 不到」.
// The Edit Supplier dialog would not save a supplier whose main Email held two
// addresses ("a@x.com / b@y.com"): handleSubmit returned without a word, and the
// only sign was small red text under the Email field at the top of the dialog —
// Update at the bottom just did nothing. The main Email is a LIST on purpose
// (the PO email sends every address in it To; src/lib/supplier-emails.ts), so
// the dialog now checks it with the same rule, and a refused save says why
// beside the buttons.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { poEmailRecipients, supplierMainEmailError } from "../src/lib/supplier-emails.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("main Email: blank, one address, or several split by comma / semicolon are fine", () => {
  assert.equal(supplierMainEmailError(""), null);
  assert.equal(supplierMainEmailError("   "), null);
  assert.equal(supplierMainEmailError(null), null);
  assert.equal(supplierMainEmailError("a@x.com"), null);
  assert.equal(supplierMainEmailError("a@x.com, b@y.com"), null);
  assert.equal(supplierMainEmailError("a@x.com;b@y.com"), null);
});

test("main Email: what the PO email cannot split is refused with a sentence that says how to fix it", () => {
  const slash = supplierMainEmailError("a@x.com / b@y.com");
  assert.ok(slash, "a slash is not a separator the PO email understands");
  assert.match(slash, /a@x\.com \/ b@y\.com/);
  assert.match(slash, /comma/);
  assert.match(slash, /Email 2/);
  assert.ok(supplierMainEmailError("not an email"));
  assert.ok(supplierMainEmailError("a@x.com, oops"));
});

test("whatever the check accepts, the PO email sends to every address in it", () => {
  for (const v of ["a@x.com", "a@x.com, b@y.com", "a@x.com;b@y.com"]) {
    assert.equal(supplierMainEmailError(v), null);
    const want = v.split(/[,;]/).map((s) => s.trim().toLowerCase());
    assert.deepEqual(poEmailRecipients({ email: v }).to, want);
  }
});

test("the dialog never refuses a save in silence", () => {
  const dlg = read("src/pages/procurement/supplier-form-dialog.tsx");
  assert.doesNotMatch(dlg, /if \(!isValidEmail\(email\)\) return;/);
  assert.match(dlg, /const emailError = supplierMainEmailError\(email\);/);
  // A refused Update says why, beside the buttons, and puts the cursor in the field.
  assert.match(dlg, /setSubmitError\(problem\)/);
  assert.match(dlg, /\{submitError && \(/);
  assert.match(dlg, /emailRef\.current\?\.focus\(\)/);
});
