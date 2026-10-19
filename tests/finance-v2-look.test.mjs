// ---------------------------------------------------------------------------
// finance-v2-look.test.mjs — the v2 look for the Finance and Forecasting pages
// (owner 2026-10-16; spec docs/superpowers/specs/2026-10-16-finance-v2-design.md,
// plan 2026-10-16-finance-v2-foundation Task 7).
//   - every rule in src/styles/finance-v2.css is scoped to [data-fin-ui], so no
//     other module changes (the owner backed away from app-wide restyles twice);
//   - the design's exact values are there (header slate, strong lines, lift,
//     34px buttons, IBM Plex Sans with tabular figures);
//   - the hooks it styles exist and change nothing on their own.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = read("src/styles/finance-v2.css");

test("every rule is scoped to the finance pages", () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^@import[^\n]*\n/gm, "");
  assert.doesNotMatch(body, /@media|@supports|@layer/, "keep the sheet flat so the scope check stays honest");
  const rules = [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
  assert.ok(rules.length > 10, "the sheet has rules");
  for (const sel of rules.flatMap((r) => r.split(",").map((s) => s.trim()))) {
    assert.ok(sel.startsWith("[data-fin-ui]") || sel.startsWith("body:has([data-fin-ui])"), `unscoped selector: ${sel}`);
  }
  for (const imp of css.match(/^@import[^\n]*$/gm) ?? []) {
    assert.match(imp, /^@import "@fontsource\/ibm-plex-sans\/latin-[4-7]00\.css";$/, `only the latin font files: ${imp}`);
  }
});

test("the design's values are in the sheet", () => {
  for (const v of [
    '"IBM Plex Sans"', "tabular-nums", "#E2E8F0", "#CBD5E1", "1.5px solid #7A6E5E", "1px solid #E7E1D8",
    "translateY(-2px)", "0 8px 18px rgba(31,29,27,.16), 0 0 0 1.5px #7A6E5E", "#F7F7F5", "height: 34px",
    "border-radius: 8px", "font-size: 13px", "#FAF8F4", "border-collapse: separate",
  ]) {
    assert.ok(css.includes(v), `missing ${v}`);
  }
});

test("the sheet loads once, after the app's own", () => {
  const main = read("src/main.tsx");
  const a = main.indexOf("import './index.css'");
  const b = main.indexOf("import './styles/finance-v2.css'");
  assert.ok(a >= 0 && b > a, "finance-v2.css imported after index.css");
  assert.match(read("package.json"), /"@fontsource\/ibm-plex-sans": "5\.3\.0"/);
});

test("the finance page roots carry data-fin-ui", () => {
  for (const p of [
    "src/pages/accounting/index.tsx", "src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx",
    "src/pages/invoices/e-invoice.tsx", "src/pages/finance-dashboard.tsx", "src/pages/forecast.tsx",
  ]) {
    assert.match(read(p), /data-fin-ui[\s>=]/, `${p} root`);
  }
});

test("the styled hooks exist on the grid, its menu and the button", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  for (const h of ['data-dg="table"', 'data-dg="th"', 'data-dg="row"', 'data-dg="foot"', 'data-dg="menu"']) {
    assert.ok(grid.includes(h), `DataGrid hook ${h}`);
  }
  const btn = read("src/components/ui/button.tsx");
  assert.match(btn, /data-variant=\{variant \?\? "default"\}/);
  assert.match(btn, /data-size=\{size \?\? "default"\}/);
});
