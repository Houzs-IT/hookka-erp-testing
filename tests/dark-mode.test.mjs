// Dark mode for the office ERP (owner 2026-11-11). Light stays the default and
// is untouched; dark is a generated per-class override layer (see
// scripts/gen-dark-theme.mjs) plus a small hand-written base.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { resolveTheme } from "../src/lib/theme.ts";

// Line endings normalised, so the patterns hold on a Windows (CRLF) checkout too.
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("resolveTheme: light / dark as chosen, system follows the OS", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("the generator covers the app's colour classes, dark-only and screen-only", () => {
  execFileSync(process.execPath, ["scripts/gen-dark-theme.mjs"], { stdio: "pipe" });
  const css = read("src/styles/dark-theme.generated.css");
  // Everything sits under @media screen, so print / PDFs keep the light look.
  assert.ok(!/^\.dark/m.test(css), "no rule outside a media block");
  for (const block of css.split(/^@media /m).slice(1)) assert.match(block, /^screen/);
  // The most used hard-coded colours get a dark counterpart by role.
  assert.match(css, /\.dark \.text-\\\[\\#6B7280\\\]:not\(/);
  assert.match(css, /\.dark \.border-\\\[\\#E2DDD8\\\]:not\(/);
  assert.match(css, /\.dark \.bg-white:not\(/);
  assert.match(css, /\.dark \.hover\\:bg-\\\[\\#F0ECE9\\\]:hover:not\(/);
  // Dark text goes light; a light surface goes dark.
  assert.match(css, /\.text-\\\[\\#1F1D1B\\\]:not\([^)]*\)\) \{ color:#ECE7E2; \}/);
  assert.match(css, /\.bg-white:not\([^)]*\)\) \{ background-color:#1C1A18; \}/);
  // text-white is never touched (white text on dark buttons stays white).
  assert.doesNotMatch(css, /\.text-white[: {]/);
  // Paper pages opt out.
  assert.match(css, /:not\(:where\(\[data-theme="light"\], \[data-theme="light"\] \*\)\)/);
  // Inline style colours (TONE tables etc.) are matched by the attribute the browser writes.
  assert.match(css, /\.dark \[style\^="color: rgb\(185, 28, 28\)"\]/);
  assert.match(css, /\[style\*="background: rgb\(255, 255, 255\)"\]/);
  // Areas already dark in light mode, and paper pages, get Tailwind's palette back.
  assert.match(css, /:root\.dark \[data-theme="light"\] \{\n\s+--color-red-50:/);
  // Tailwind's own palette flips under .dark.
  assert.match(css, /:root\.dark \{\n\s+--color-red-50:/);
});

test("wiring: build regenerates, first paint applies the choice, menu offers it, paper stays light", () => {
  const pkg = JSON.parse(read("package.json"));
  // The refined-look generator (owner 2026-11-12) runs next to it before vite.
  assert.match(pkg.scripts.build, /^node scripts\/gen-dark-theme\.mjs && .*vite build/);
  const html = read("index.html");
  assert.match(html, /localStorage\.getItem\("hookka-theme"\)/);
  assert.match(html, /classList\.add\("dark"\)/);
  const main = read("src/main.tsx");
  assert.match(main, /import '\.\/styles\/dark-base\.css'/);
  assert.match(main, /import '\.\/styles\/dark-theme\.generated\.css'/);
  const top = read("src/components/layout/topbar.tsx");
  assert.match(top, /setThemePref\(p\)/);
  for (const v of ['"light", "Light"', '"dark", "Dark"', '"system", "System"']) assert.ok(top.includes(v), v);
  assert.match(read("src/components/layout/sidebar.tsx"), /<aside\n\s+\/\/[^\n]*\n\s+data-theme="light"/);
  assert.match(read("src/pages/board-report/index.tsx"), /className="brp-root" data-theme="light"/);
  // Default is light, so nobody's screen changes until they pick dark.
  assert.match(read("src/lib/theme.ts"), /: "light";\n/);
});
