// ---------------------------------------------------------------------------
// HK-0005: every customer's rules were packed into every PO prompt. When the
// customer is known up front, only their block goes in; otherwise only blocks
// that actually say something (empty "no special rules" stubs are dead weight).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { formatCustomerRules } from "../src/api/lib/scan-engine.ts";

const cat = {
  customers: [
    { id: "c1", code: "HOUZS", name: "Houzs Century", ocrPromptRules: "Use the PO No box." },
    { id: "c2", code: "ACME", name: "Acme Furniture", ocrPromptRules: "Size is in col 3." },
    { id: "c3", code: "EMPTY", name: "Empty Co", ocrPromptRules: null },
  ],
};

test("no hint: only customers that have rules are listed", () => {
  const t = formatCustomerRules(cat);
  assert.match(t, /code="HOUZS"/);
  assert.match(t, /code="ACME"/);
  assert.doesNotMatch(t, /code="EMPTY"/);
  assert.doesNotMatch(t, /no customer-specific rules/);
});

test("hint equal to a customer code or name: only that customer's block", () => {
  for (const hint of ["acme", "Acme Furniture"]) {
    const t = formatCustomerRules(cat, hint);
    assert.match(t, /code="ACME"/);
    assert.doesNotMatch(t, /code="HOUZS"/);
    assert.doesNotMatch(t, /Use the PO No box/);
  }
});

test("hint that matches nobody falls back to every customer with rules", () => {
  const t = formatCustomerRules(cat, "PO2608");
  assert.match(t, /code="HOUZS"/);
  assert.match(t, /code="ACME"/);
});

test("a matched customer with no rules yields the universal-rules stub, not other customers", () => {
  const t = formatCustomerRules(cat, "EMPTY");
  assert.doesNotMatch(t, /code="HOUZS"/);
  assert.match(t, /no customer-specific rules/);
});
