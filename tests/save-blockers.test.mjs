// ---------------------------------------------------------------------------
// save-blockers.test.mjs — create/edit forms report EVERY blocking problem in
// one toast instead of stopping at the first. Owner-approved item 25,
// 2026-11-08. Rules are unchanged; only the reporting is consolidated.
// Run: node --import tsx/esm --test tests/save-blockers.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SaveBlockers, summarizeSaveBlockers, reportSaveBlockers } from "../src/lib/save-blockers.ts";

function fakeToast() {
  const calls = [];
  return { calls, warning: (m) => calls.push(["warning", m]), error: (m) => calls.push(["error", m]) };
}

test("no blockers → nothing shown, save proceeds", () => {
  const t = fakeToast();
  assert.equal(reportSaveBlockers(t, new SaveBlockers()), false);
  assert.deepEqual(t.calls, []);
  assert.equal(summarizeSaveBlockers([]), null);
});

test("one blocker → exactly the old toast (same text, same tone)", () => {
  const t = fakeToast();
  assert.equal(reportSaveBlockers(t, new SaveBlockers().warn("Please select a customer")), true);
  assert.deepEqual(t.calls, [["warning", "Please select a customer"]]);
  const t2 = fakeToast();
  reportSaveBlockers(t2, new SaveBlockers().error("Add at least one item"));
  assert.deepEqual(t2.calls, [["error", "Add at least one item"]]);
});

test("several blockers → ONE toast listing all, in check order", () => {
  const b = new SaveBlockers()
    .warn("Please select a customer")
    .warn("Please select a fabric for all line items")
    .error("Sofa and Bedframe cannot be on the same Sales Order.");
  const t = fakeToast();
  assert.equal(reportSaveBlockers(t, b), true);
  assert.equal(t.calls.length, 1, "exactly one toast");
  const [level, msg] = t.calls[0];
  assert.equal(level, "error", "any error-level blocker makes the summary an error");
  assert.equal(
    msg,
    "Fix 3 problems before saving:\n" +
      "• Please select a customer\n" +
      "• Please select a fabric for all line items\n" +
      "• Sofa and Bedframe cannot be on the same Sales Order.",
  );
});

test("all-warning list stays a warning; blanks and duplicates are dropped", () => {
  const b = new SaveBlockers().warn("A").warn("").warn("A").warn("B");
  assert.equal(b.size, 2);
  assert.deepEqual(summarizeSaveBlockers(b.items), { level: "warning", message: "Fix 2 problems before saving:\n• A\n• B" });
});

test("toast renders the list on separate lines and stays longer", () => {
  const src = readFileSync("src/components/ui/toast.tsx", "utf8");
  assert.match(src, /whitespace-pre-line/);
  assert.match(src, /function toastDurationMs\(message: string\)/);
  assert.match(src, /dismissing \? null : durationMs/);
});

// Each form collects instead of returning at the first failed check.
const FORMS = {
  "src/pages/sales/create.tsx": 7,
  "src/pages/sales/edit.tsx": 7,
  "src/pages/procurement/create.tsx": 3,
  "src/pages/procurement/pi/create.tsx": 2,
  "src/pages/procurement/grn/create.tsx": 5,
};

for (const [file, minChecks] of Object.entries(FORMS)) {
  test(`${file} collects its save blockers`, () => {
    const src = readFileSync(file, "utf8");
    assert.match(src, /import \{ SaveBlockers, reportSaveBlockers \} from "@\/lib\/save-blockers";/);
    assert.match(src, /const blockers = new SaveBlockers\(\);/);
    assert.match(src, /reportSaveBlockers\(toast, blockers\)/);
    const n = (src.match(/blockers\.(warn|error)\(/g) || []).length;
    assert.ok(n >= minChecks, `${file}: expected >= ${minChecks} collected checks, found ${n}`);
  });
}

test("SO create/edit no longer stop at the first missing field", () => {
  for (const f of ["src/pages/sales/create.tsx", "src/pages/sales/edit.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /toast\.warning\("Please select a customer"\); return;/, f);
  }
});
