// ---------------------------------------------------------------------------
// finance-v2-month-shell.test.mjs — the two shared pieces of the v2 Monthly
// pages (plan 2026-10-16-finance-v2-monthly Task 1): KPI cards and the status
// banner, with the design's exact sizes and colours.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const shell = readFileSync("src/components/finance/report-shell.tsx", "utf8").replace(/\r\n/g, "\n");
const part = (name) => {
  const a = shell.indexOf(`export function ${name}(`);
  const b = shell.indexOf("\nexport function ", a + 10);
  return shell.slice(a, b < 0 ? undefined : b);
};

test("KPI cards: auto-fit grid of white cards — small uppercase label, 20px value, faint note", () => {
  const k = part("KpiCards");
  assert.match(k, /grid gap-2\.5 \[grid-template-columns:repeat\(auto-fit,minmax\(180px,1fr\)\)\]/);
  assert.match(k, /rounded-\[10px\] border border-\[#E2DDD8\] bg-white px-3\.5 py-3/);
  assert.match(k, /text-\[11px\] font-semibold uppercase tracking-\[\.5px\] text-\[#6B7280\]/);
  assert.match(k, /mt-1 text-\[20px\] font-bold/);
  assert.match(k, /text-\[11px\] text-\[#9CA3AF\]/);
  for (const [tone, c] of [["ink", "#1F1D1B"], ["ok", "#27500A"], ["warn", "#7A5B12"], ["err", "#9A3A2D"]]) {
    assert.ok(shell.includes(`${tone}: "text-[${c}]"`), `${tone} ${c}`);
  }
});

test("status banner: done green, to-do amber; bold title and a grey sub-line", () => {
  const b = part("StatusBanner");
  assert.match(b, /done \? "border-\[#C9DBBE\] bg-\[#F1F6EE\]" : "border-\[#E9D9B4\] bg-\[#FBF6EC\]"/);
  assert.match(b, /done \? "text-\[#27500A\]" : "text-\[#7A5B12\]"/);
  assert.match(b, /min-h-10 flex-wrap items-center gap-2\.5 rounded-\[10px\] border px-3\.5 py-2\.5/);
  assert.match(b, /text-\[13px\] font-bold/);
  assert.match(b, /text-\[12px\] text-\[#4B5563\]/);
});
