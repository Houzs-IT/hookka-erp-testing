// ---------------------------------------------------------------------------
// finance-v2-popup.test.mjs — the document popup shell in the v2 look (plan
// 2026-10-16-finance-v2-daily-b Task 4). One shell (DocDetailModal) serves
// every finance list's double-click, so the look changes in one place; its
// props and its Esc behaviour stay the same.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const shell = ui.slice(ui.indexOf("function DocDetailModal("), ui.indexOf("function DetailField("));
const field = ui.slice(ui.indexOf("function DetailField("), ui.indexOf("\n}\n", ui.indexOf("function DetailField(")));

test("same props, same Esc", () => {
  assert.match(shell, /function DocDetailModal\(\{ title, badges, onClose, children, actions, wide \}/);
  assert.match(shell, /useEscapeClose\(onClose\);/);
  assert.match(shell, /onClick=\{onClose\}/, "a click on the backdrop closes it");
  assert.match(shell, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
});

test("the design's frame: overlay, 14px corners, deep shadow, white header and action bar, grey body", () => {
  assert.match(shell, /bg-\[rgba\(31,29,27,0\.42\)\]/);
  assert.match(shell, /rounded-\[14px\]/);
  assert.match(shell, /shadow-\[0_24px_60px_rgba\(31,29,27,0\.28\)\]/);
  assert.match(shell, /bg-\[#F7F5F2\]/);
  assert.match(shell, /<h2 className="text-\[16px\] font-semibold text-\[#1F1D1B\]">\{title\}<\/h2>/);
  assert.match(shell, /data-fin-modal-body/);
  assert.match(shell, /\{actions && <div className="[^"]*bg-white[^"]*">\{actions\}<\/div>\}/, "the actions sit in a white bar at the foot");
  const css = read("src/styles/finance-v2.css");
  assert.match(css, /\[data-fin-ui\] \[data-fin-modal-body\] > \* \{/, "each block in the body is a white card");
});

test("field labels: small uppercase", () => {
  assert.match(field, /text-\[11px\] font-semibold uppercase tracking-wide text-\[#6B7280\]/);
});

test("dates in the popups and on the cash position read the v2 way (15 Oct 2026)", () => {
  const dateFields = [...ui.matchAll(/<DetailField label="([^"]*[Dd]ate[^"]*)">([^\n]*?)<\/DetailField>/g)];
  assert.ok(dateFields.length >= 7, "the popups' date fields were found");
  for (const [, label, body] of dateFields) {
    assert.match(body, /fmtDocDate\(/, `${label}: ${body}`);
  }
  const cash = ui.slice(ui.indexOf("function DailyCashTab("), ui.indexOf("\nfunction ", ui.indexOf("function DailyCashTab(") + 10));
  assert.match(cash, /whitespace-nowrap">\{fmtDocDate\(p\.day\)\}<\/td>/, "screen");
  assert.match(cash, /<tr><td>\$\{fmtDocDate\(p\.day\)\}<\/td>/, "print");
});
