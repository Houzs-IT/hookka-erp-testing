// ---------------------------------------------------------------------------
// finance-v2-daily-shell.test.mjs — shared pieces for the v2 Daily pages (plan
// 2026-10-16-finance-v2-daily-a Task 2): status pills in the design's tones,
// segmented chips, the title-row slot tabs put their buttons in, ink primary
// buttons, and the v2 look on row menus that open on <body>.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("status pills use the design's tones", () => {
  const p = read("src/components/finance/pill.tsx");
  for (const [tone, cls] of [
    ["ok", "bg-[#E7F0E3] text-[#27500A]"], ["warn", "bg-[#FBF3E4] text-[#7A5B12]"], ["err", "bg-[#F3E8E5] text-[#9A3A2D]"],
    ["neutral", "bg-[#EEF1F4] text-[#4B5563]"], ["info", "bg-[#EEF2FB] text-[#2C4170]"], ["faint", "bg-[#F4F4F2] text-[#9CA3AF]"],
  ]) {
    assert.ok(p.includes(`${tone}: "${cls}"`), `${tone} tone`);
  }
  assert.match(p, /export function FinPill\(\{ tone, title, children \}/);
  assert.match(p, /rounded-full[^"]*text-\[11px\] font-semibold/);
});

test("segmented chips: 34px, gold when on, a quiet count", () => {
  const c = read("src/components/finance/segmented-chips.tsx");
  assert.match(c, /export function SegmentedChips<K extends string>/);
  assert.match(c, /h-\[34px\]/);
  assert.match(c, /on \? "bg-\[#6B5C32\] text-white"/);
  assert.match(c, /\{o\.count \? <span className="ml-1\.5 text-\[11px\] tabular-nums opacity-70">\{o\.count\}<\/span> : null\}/);
  assert.match(c, /aria-selected=\{on\}/);
});

test("tabs put their buttons on the title row through one slot", () => {
  assert.match(read("src/components/finance/title-slot.ts"), /export const FinanceTitleSlotContext = createContext<HTMLElement \| null>\(null\);/);
  const t = read("src/components/finance/title-actions.tsx");
  assert.match(t, /if \(slot\) return createPortal\(children, slot\);/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /<FinancePageTitle \{\.\.\.financePage\(tab\)\} actions=\{<div ref=\{setTitleSlot\} className="flex flex-wrap items-center gap-2" \/>\} \/>/);
  assert.match(ui, /<FinanceTitleSlotContext\.Provider value=\{titleSlot\}>/);
  const jv = ui.slice(ui.indexOf("function JournalsTab("), ui.indexOf("function JournalEntryForm("));
  // [\s\S] — the button's onClick holds an arrow (=>), which [^>] cannot cross.
  assert.match(jv, /<FinanceTitleActions>\s*<Button variant="primary" size="sm"[\s\S]{0,160}?>\s*<FileText className="h-4 w-4" \/> New Journal Entry/);
});

test("ink primary buttons, the info and faint tokens, menus on <body>, rows that do not lift", () => {
  const css = read("src/styles/finance-v2.css");
  assert.match(css, /\[data-fin-ui\] button\[data-variant="primary"\] \{\s*background-color: #1F1D1B;\s*color: #FFFFFF;\s*\}/);
  assert.match(css, /--fin-info-fg: #2C4170;/);
  assert.match(css, /--fin-info-bg: #EEF2FB;/);
  assert.match(css, /--fin-faint-bg: #F4F4F2;/);
  assert.match(css, /body:has\(\[data-fin-ui\]\) \[data-dg="menu"\] \{/, "row menus portal to <body>, outside the page root");
  assert.match(css, /table\[data-fin-list\] > tbody > tr:not\(\[data-fin-nolift\]\):hover/);
});
