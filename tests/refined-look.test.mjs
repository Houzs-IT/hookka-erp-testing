// Refined look (owner 2026-11-12, "比 Houzs ERP 更好看", palette B-lite):
// opt-in per browser while in preview. Classic must be untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (p) => readFileSync(p, "utf8");

test("the generator snaps every colour class onto the refined tokens, refined-only and screen-only", () => {
  execFileSync(process.execPath, ["scripts/gen-refined-theme.mjs"]);
  const css = read("src/styles/refined-theme.generated.css");
  assert.match(css, /^@media screen \{/m);
  const ruleLines = css.split("\n").filter((l) => l.includes("var(--hk-"));
  assert.ok(ruleLines.length > 500, "covers the app's colour classes");
  assert.ok(ruleLines.every((l) => l.includes(":root.refined:not(.dark)")), "every rule is refined-only");
  const has = (cls, decl) => ruleLines.some((l) => l.includes(cls) && l.includes(decl));
  assert.ok(has(".text-\\[\\#6B7280\\]", "color:var(--hk-ink-muted)"));
  assert.ok(has(".text-\\[\\#9A3A2D\\]", "color:var(--hk-danger)"));
  assert.ok(has(".bg-\\[\\#F0ECE9\\]", "background-color:var(--hk-bg)"));
  // Paper wrappers opt out; the phone shell (<body data-theme="light">) does not.
  assert.ok(ruleLines[0].includes(':not(:where([data-theme="light"]:not(body) *))'));
});

test("tokens are scoped to html.refined; classic variables untouched", () => {
  const t = read("src/styles/refined-tokens.css");
  assert.match(t, /^:root\.refined \{/m);
  assert.ok(!/^:root \{/m.test(t), "no unscoped :root block");
  assert.match(t, /--hk-bg: #F3EFE8;/);
  assert.match(t, /--hk-font-sans: "Inter", "Noto Sans SC"/);
  assert.match(t, /:root\.refined:not\(\.dark\) body\[data-theme="light"\] \{/, "phone light theme follows; phone dark left alone");
});

test("wiring: imported, generated on build, toggle in the user menu, applied before first paint, ?look= for phones", () => {
  assert.match(read("src/main.tsx"), /import '\.\/styles\/refined-theme\.generated\.css'/);
  assert.match(read("package.json"), /node scripts\/gen-refined-theme\.mjs && vite build/);
  assert.match(read("src/lib/theme.ts"), /export function setLookPref\(pref: LookPref\)/);
  assert.match(read("src/components/layout/topbar.tsx"), /\["refined", "Refined \(new\)"\]/);
  const html = read("index.html");
  assert.match(html, /localStorage\.getItem\("hookka-look"\) === "refined"/);
  assert.match(html, /get\("look"\)/);
});
