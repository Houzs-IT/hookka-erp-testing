// Frontend-quality batch A (owner-approved 2026-11-08): real error reasons,
// PDF text clean-up, numeric inputs, dropdown flip, MRP frozen header,
// page-header wrap. Pure helpers are exercised directly; the wiring is pinned
// by source pattern (house style for UI).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { responseErrorMessage, bodyErrorText } from "../src/lib/response-error.ts";
import { pdfText, pdfTextOr } from "../src/lib/pdf-text.ts";
import { shouldBlurOnWheel } from "../src/lib/number-input-wheel-guard.ts";
import {
  computeDropdownPlacement,
  DROPDOWN_MIN_HEIGHT,
} from "../src/lib/dropdown-placement.ts";

const read = (p) => readFileSync(p, "utf8");

// ── 16. Real error reasons ────────────────────────────────────────────────
test("responseErrorMessage returns the server's error sentence", async () => {
  const res = new Response(JSON.stringify({ success: false, error: "Credit limit exceeded" }), { status: 400 });
  assert.equal(await responseErrorMessage(res, "Couldn't save"), "Credit limit exceeded");
  // The clone means the caller can still read the body.
  assert.equal((await res.json()).error, "Credit limit exceeded");
});

test("responseErrorMessage falls back to the caller's text plus HTTP status", async () => {
  assert.equal(
    await responseErrorMessage(new Response("<html>bad gateway</html>", { status: 502 }), "Couldn't save"),
    "Couldn't save (HTTP 502)",
  );
  assert.equal(
    await responseErrorMessage(new Response(JSON.stringify({ success: false }), { status: 500 }), "Delete failed"),
    "Delete failed (HTTP 500)",
  );
  assert.equal(bodyErrorText({ message: "Locked" }), "Locked");
  assert.equal(bodyErrorText({ error: "   " }), "");
});

test("saves that used to ignore the response now check res.ok and show the reason", () => {
  const sites = [
    ["src/components/customer/KycPanel.tsx", 1],
    ["src/components/customer/CrmPanel.tsx", 4],
    ["src/pages/inventory/stock-value.tsx", 2],
    ["src/pages/consignment/detail.tsx", 1],
    ["src/pages/delivery-returns/detail.tsx", 2],
    ["src/pages/purchase-returns/index.tsx", 1],
    ["src/pages/leads/index.tsx", 7],
    ["src/pages/consignment/note.tsx", 6],
    ["src/pages/inventory/index.tsx", 1],
  ];
  for (const [file, min] of sites) {
    const n = (read(file).match(/responseErrorMessage\(/g) ?? []).length;
    assert.ok(n >= min, `${file}: expected >= ${min} responseErrorMessage calls, found ${n}`);
  }
  // KYC: the green "Saved" tick must not flash on a refused save.
  const kyc = read("src/components/customer/KycPanel.tsx");
  assert.ok(kyc.indexOf("if (!res.ok)") < kyc.indexOf("setSavedTick(true)"));
  // Consignment order delete: no navigate-away before the ok-check.
  const co = read("src/pages/consignment/detail.tsx");
  const del = co.slice(co.indexOf("const deleteOrder"), co.indexOf('navigate("/consignment")'));
  assert.match(del, /if \(!res\.ok\)/);
});

// ── 17. PDF text clean-up ─────────────────────────────────────────────────
test("pdfText maps null-ish values and literal 'null' to empty", () => {
  for (const v of [null, undefined, "null", " undefined ", "NULL", "NaN", "[object Object]", {}, NaN]) {
    assert.equal(pdfText(v), "", JSON.stringify(v));
    assert.equal(pdfTextOr(v), "-");
  }
  assert.equal(pdfText(12), "12");
});

test("pdfText drops stray 'null' parts and tidies whitespace without touching real words", () => {
  assert.equal(pdfText("No 3, null, Kuala Lumpur"), "No 3, Kuala Lumpur");
  assert.equal(pdfText("null, KL"), "KL");
  assert.equal(pdfText("foo, undefined"), "foo");
  assert.equal(pdfText("Hello null world"), "Hello null world");
  assert.equal(pdfText("  a   b\t c  d "), "a b c d");
  assert.equal(pdfText("\r\n\r\nline1  \r\n\r\n\r\n line2 \r\n\r\n"), "line1\n\nline2");
});

test("main document PDF generators pass their free text through pdfText", () => {
  for (const f of [
    "src/lib/generate-purchase-order-pdf.ts",
    "src/lib/generate-purchase-invoice-pdf.ts",
    "src/lib/generate-credit-note-pdf.ts",
  ]) {
    const src = read(f);
    assert.match(src, /from "@\/lib\/pdf-text"/, f);
    assert.match(src, /pdfTextOr?\(/, f);
  }
  // SO / DO / Invoice share the unified renderer: both wrap helpers clean first.
  const uni = read("src/api/lib/unified-do-invoice-pdf.ts");
  assert.equal((uni.match(/winAnsi\(pdfText\(rawText\)\)/g) ?? []).length, 2);
});

// ── 18. Numeric inputs ────────────────────────────────────────────────────
test("the wheel guard blurs only a focused number input under the wheel", () => {
  const num = { tagName: "INPUT", type: "number" };
  assert.equal(shouldBlurOnWheel(num, num), true);
  assert.equal(shouldBlurOnWheel(num, {}), false); // not focused
  const txt = { tagName: "INPUT", type: "text" };
  assert.equal(shouldBlurOnWheel(txt, txt), false);
  assert.equal(shouldBlurOnWheel(null, null), false);
});

test("the wheel guard is installed once at app boot, passive", () => {
  assert.match(read("src/main.tsx"), /installNumberInputWheelGuard\(\)/);
  assert.match(read("src/lib/number-input-wheel-guard.ts"), /passive: true/);
});

test("quantity inputs on the main document editors carry an inputMode", () => {
  for (const f of [
    "src/pages/sales/create.tsx",
    "src/pages/sales/edit.tsx",
    "src/pages/procurement/create.tsx",
    "src/pages/procurement/grn/create.tsx",
    "src/pages/consignment/edit.tsx",
    "src/pages/procurement/PurchaseInvoiceDetail.tsx",
  ]) {
    const tags = read(f).match(/<(input|Input)\b[\s\S]*?\/>/g) ?? [];
    for (const t of tags.filter((x) => /type="number"/.test(x))) {
      assert.match(t, /inputMode=/, `${f}: number input without inputMode: ${t.slice(0, 120)}`);
    }
  }
});

// ── 19. Dropdown flip + max height ────────────────────────────────────────
test("computeDropdownPlacement opens below when it fits, above when it does not", () => {
  // Plenty of room below.
  assert.deepEqual(computeDropdownPlacement({ top: 100, bottom: 130 }, 900, 285), { side: "below", maxHeight: 285 });
  // Trigger near the bottom: flip up, full height.
  const up = computeDropdownPlacement({ top: 800, bottom: 830 }, 900, 285);
  assert.equal(up.side, "above");
  assert.equal(up.maxHeight, 285);
  // Capped at 60% of a short viewport.
  assert.equal(computeDropdownPlacement({ top: 10, bottom: 40 }, 400, 500).maxHeight, 240);
  // Never a sliver.
  assert.ok(computeDropdownPlacement({ top: 30, bottom: 60 }, 120, 285).maxHeight >= DROPDOWN_MIN_HEIGHT);
});

test("SearchableSelect and MaterialPicker use the shared placement", () => {
  const ss = read("src/components/ui/searchable-select.tsx");
  assert.match(ss, /useDropdownPlacement\(/);
  assert.match(ss, /bottom-full mb-1/);
  assert.match(ss, /maxHeight: placement\.maxHeight/);
  const mp = read("src/components/material-picker.tsx");
  assert.match(mp, /computeDropdownPlacement\(/);
  assert.match(mp, /maxHeight: coords\.maxHeight/);
});

// ── 20. MRP frozen header ─────────────────────────────────────────────────
test("the MRP requirements table freezes its header row and first column", () => {
  const src = read("src/pages/planning/mrp.tsx");
  assert.match(src, /max-h-\[70vh\] overflow-auto" data-testid="mrp-requirements-scroll"/);
  assert.match(src, /<thead className="sticky top-0 z-20">/);
  assert.match(src, /<th className="sticky left-0 z-10[^"]*">Material<\/th>/);
  assert.match(src, /<td className="sticky left-0 z-\[5\] bg-white/);
  // Sticky header cells must be opaque — no /alpha backgrounds left in the header.
  const head = src.slice(src.indexOf('data-testid="mrp-requirements-scroll"'), src.indexOf("</thead>", src.indexOf('data-testid="mrp-requirements-scroll"')));
  assert.doesNotMatch(head, /<th[^>]*bg-\[#[0-9A-Fa-f]{6}\]\/\d+/);
});

// ── 21. Page-header wrap ──────────────────────────────────────────────────
test("PageHeader and ObjectPageHeader wrap instead of squashing the title", () => {
  const ph = read("src/components/ui/page-header.tsx");
  assert.match(ph, /"flex flex-wrap items-start justify-between/);
  assert.doesNotMatch(ph, /className="[^"]*sm:flex-nowrap/);
  assert.doesNotMatch(ph, /<h1[^>]*\btruncate\b/);
  const oph = read("src/components/ui/object-page-header.tsx");
  assert.match(oph, /<div className="flex flex-wrap items-center/);
});
