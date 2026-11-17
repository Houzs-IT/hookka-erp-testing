import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Owner 2026-11-17 「这个我要能scroll fullpages的 / 空间太小了」 then
// 「cashflow 和PNL 也是」: every framed report can fill the window.
const shell = readFileSync("src/components/finance/report-shell.tsx", "utf8");
const css = readFileSync("src/styles/finance-v2.css", "utf8");

test("every ReportToolbar ends with the Full screen switch", () => {
  assert.match(shell, /\{children\}\n      <FullScreenToggle \/>/);
  assert.match(shell, /"Exit full screen" : "Full screen"/);
  assert.match(shell, /useEscapeClose\(\(\) => setFull\(false\), full\);/);
});

test("it marks the nearest container holding a report frame, and hides where none", () => {
  assert.match(shell, /while \(el && !el\.querySelector\("\[data-fin-frame\]"\)\) el = el\.parentElement;/);
  assert.match(shell, /target\.setAttribute\("data-report-full", ""\)/);
  assert.match(shell, /return \(\) => \{ target\.removeAttribute\("data-report-full"\); \};/);
  assert.match(shell, /hidden=\{!target\}/);
});

test("full screen covers the window and lifts the page's maxHeight", () => {
  assert.match(shell, /maxHeight: `var\(--fin-full-h, \$\{fill !== null \? `\$\{fill\}px` : maxHeight\}\)`/);
  assert.match(css, /\[data-fin-ui\] \[data-report-full\] \{\n  position: fixed;\n  inset: 0;/);
  assert.match(css, /--fin-full-h: none;/);
  assert.match(css, /\[data-report-full\] > \[data-fin-frame\] > \[data-fin-report-scroll\] \{\n  flex: 1 1 auto;\n  min-height: 0;/);
});

test("normal view fills the screen: box sized to the window, page scrolls first (owner 2026-11-17)", () => {
  assert.match(shell, /setFill\(Math\.max\(240, window\.innerHeight - barH\(\) - \(headRef\.current\?\.offsetHeight \?\? 0\) - 16\)\)/);
  assert.match(shell, /box\?\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(shell, /if \(!frame \|\| frame\.closest\("\[data-report-full\]"\)\) return;/, "full screen keeps its own scrolling");
  assert.match(shell, /page\.scrollTop \+ window\.innerHeight >= page\.scrollHeight - 1\) return;/, "never traps the wheel when the page cannot move");
  assert.match(shell, /window\.scrollBy\(0, Math\.min\(e\.deltaY, gap\)\);/);
});
