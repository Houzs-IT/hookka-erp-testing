// ---------------------------------------------------------------------------
// Finance motion (owner 2026-10-20 「要」 — the design's open / switch
// animation, about 150–200 ms): a finance page's content fades in when it
// opens or its tab switches, a document popup rises in over a fading
// backdrop, and nobody who asked the system for less motion gets any. No
// fill mode: nothing keeps a transform once it has arrived.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("the keyframes and the reduced-motion rule (index.css)", () => {
  const css = read("src/index.css");
  assert.match(css, /@keyframes fin-fade \{\n  from \{ opacity: 0; \}\n  to \{ opacity: 1; \}\n\}/);
  assert.match(css, /@keyframes fin-pop \{\n  from \{ opacity: 0; transform: translateY\(6px\) scale\(\.985\); \}\n  to \{ opacity: 1; transform: none; \}\n\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \[data-fin-ui\] \[data-fin-reveal\],\n  \[data-fin-ui\] \[data-fin-tab\],\n  \[data-fin-ui\] \[data-fin-backdrop\],\n  \[data-fin-ui\] \[data-fin-pop\] \{\n    animation: none;\n  \}\n\}/);
});

test("the timings, finance-scoped, without a fill mode", () => {
  const css = read("src/styles/finance-v2.css");
  assert.match(css, /\[data-fin-ui\] \[data-fin-tab\] \{\n  animation: fin-fade \.16s ease-out;\n\}/);
  assert.match(css, /\[data-fin-ui\] \[data-fin-backdrop\] \{\n  animation: fin-fade \.15s ease-out;\n\}/);
  assert.match(css, /\[data-fin-ui\] \[data-fin-pop\] \{\n  animation: fin-pop \.18s ease-out;\n\}/);
  assert.doesNotMatch(css, /animation: fin-(fade|pop)[^;]*(forwards|both)/, "no fill mode");
});

test("who moves: the accounting page's tab content (remounted per tab), both document popups", () => {
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /<div key=\{tab\} data-fin-tab="">\n\s+\{tab === "overview" && \(/);
  const modal = ui.slice(ui.indexOf("function DocDetailModal("), ui.indexOf("function DetailField("));
  assert.match(modal, /<div data-fin-backdrop="" className="fixed inset-0 z-50/);
  assert.match(modal, /<div data-fin-pop="" className=\{`flex max-h-\[90vh\]/);
  const popup = read("src/components/finance/doc-popup.tsx");
  assert.match(popup, /<div data-fin-backdrop="" className="fixed inset-0 z-50/);
  assert.match(popup, /<div data-fin-pop="" className="flex max-h-\[90vh\]/);
});
