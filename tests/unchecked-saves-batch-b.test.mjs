// BUG-2026-11-09-435 follow-up (batch B): the saves outside the main pages
// that sent a request and carried on as if it worked. Pinned by source pattern
// (house style for UI wiring), same as tests/fe-quality-batch-a.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

test("batch-B saves check the response and show the server's reason", () => {
  const sites = [
    ["src/pages/accounting/cash-flow.tsx", 2], // reconcile match, add transaction
    ["src/pages/employees.tsx", 8], // add worker, pay-rule save/delete, undo + 2 regenerates, leave add/approve
    ["src/pages/procurement/detail.tsx", 1], // mark emailed
    ["src/pages/settings/organisations.tsx", 2], // deactivate, inter-company config
    ["src/components/assistant/AssistantSlideOver.tsx", 2], // pin, delete
  ];
  for (const [file, min] of sites) {
    const n = (read(file).match(/responseErrorMessage\(/g) ?? []).length;
    assert.ok(n >= min, `${file}: expected >= ${min} responseErrorMessage calls, found ${n}`);
  }
});

test("refused saves no longer run the success path", () => {
  // Organisations: "saved" banner only after the ok-check.
  const org = read("src/pages/settings/organisations.tsx");
  assert.ok(org.indexOf("Could not save the inter-company config") < org.indexOf('flash("Inter-company config saved")'));
  assert.ok(org.indexOf("Could not deactivate the organisation") < org.indexOf('flash("Organisation deactivated")'));

  // Employees: add-worker form stays open on a refusal.
  const emp = read("src/pages/employees.tsx");
  const add = emp.indexOf("Could not add the employee");
  assert.ok(add > 0);
  assert.ok(emp.indexOf("return;", add) < emp.indexOf("setShowAddForm(false);", add), "refusal must return before closing the form");
  assert.ok(!/^\s*await fetch\("\/api\/workers", \{\s*method: "POST"/m.test(emp), "worker create must keep its response");
  assert.ok(!/^\s*await fetch\("\/api\/payslips", \{/m.test(emp), "payslip regenerate must keep its response");
  assert.ok(!/^\s*await fetch\("\/api\/leaves", \{/m.test(emp), "leave writes must keep their response");

  // Cash flow: no bare awaited POST left.
  assert.ok(!/^\s*await fetch\("\/api\/cash-flow", \{/m.test(read("src/pages/accounting/cash-flow.tsx")));
});

test("BOM master migration keeps the local copy when the upload is refused", () => {
  const bom = read("src/pages/bom.tsx");
  const put = bom.indexOf('"/api/bom-master-templates", {\n      method: "PUT"');
  assert.ok(put > 0, "migration PUT not found");
  const guard = bom.indexOf("if (!res.ok) return templates;", put);
  const clear = bom.indexOf("localStorage.removeItem(MASTER_TPL_INDEX_KEY)", put);
  assert.ok(guard > put && guard < clear, "the ok-check must come before the legacy keys are removed");
});
