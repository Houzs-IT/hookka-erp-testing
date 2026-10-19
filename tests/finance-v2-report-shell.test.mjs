// ---------------------------------------------------------------------------
// finance-v2-report-shell.test.mjs — the v2 report frame (plan
// 2026-10-16-finance-v2-reports Task 2): one toolbar (period stepper, Edit
// Layout, DETAIL levels, one download icon), the check strip, the framed report
// with its centred head, and the report table's look keyed by data-row /
// data-cell — with the layers set so a lifted line passes over the frozen
// first column and under the sticky header.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const shell = read("src/components/finance/report-shell.tsx");
const css = read("src/styles/finance-v2.css");
const part = (name) => {
  const a = shell.indexOf(`export function ${name}(`);
  const b = shell.indexOf("\nexport function ", a + 10);
  return shell.slice(a, b < 0 ? undefined : b);
};

test("the shell's pieces", () => {
  for (const n of ["PeriodStepper", "DetailLevels", "EditLayoutToggle", "DownloadMenu", "ReportToolbar", "ToolbarDivider", "CheckStrip", "ReportFrame", "EditLayoutBanner"]) {
    assert.match(shell, new RegExp(`export function ${n}\\(`), n);
  }
});

test("popovers close on Esc and on a click outside", () => {
  const pop = shell.slice(shell.indexOf("function usePopover("), shell.indexOf("const CTRL"));
  assert.match(pop, /useEscapeClose\(\(\) => setOpen\(false\), open\);/);
  assert.match(pop, /document\.addEventListener\("mousedown", away\);/);
  assert.match(pop, /return \(\) => document\.removeEventListener\("mousedown", away\);/);
  assert.match(part("PeriodStepper"), /usePopover\(\)/);
  assert.match(part("DownloadMenu"), /usePopover\(\)/);
});

test("the stepper steps only to periods the report offers; a closed end fades to .35", () => {
  const s = part("PeriodStepper");
  assert.match(s, /const canPrev = options\.includes\(prev\);/);
  assert.match(s, /const canNext = options\.includes\(next\);/);
  assert.match(s, /onClick=\{\(\) => canPrev && onChange\(prev\)\}/);
  assert.match(s, /onClick=\{\(\) => canNext && onChange\(next\)\}/);
  assert.match(s, /opacity-\[\.35\]/);
  assert.match(s, /\{periodLabel\(value, now\)\}/, "the label reads Oct 2026 · so far");
  assert.match(s, /const now = today \?\? todayYmdMY\(\);/, "today is Malaysia's today");
  assert.match(s, /kinds\.length > 1 &&/, "the Month / Quarter / Full Year tabs only where a report reads more than months");
});

test("controls: 32px, #D9D3CA border, radius 8, 12.5px/600; the active level is ink", () => {
  assert.match(shell, /const CTRL = "h-8 rounded-lg border border-\[#D9D3CA\] bg-white text-\[12\.5px\] font-semibold text-\[#1F1D1B\]";/);
  const lv = part("DetailLevels");
  assert.match(lv, /text-\[11px\] font-bold tracking-\[\.04em\] text-\[#9CA3AF\]">DETAIL</);
  assert.match(lv, /value === L \? "bg-\[#1F1D1B\] text-white"/);
  assert.match(shell, /className="mx-0\.5 h-\[22px\] w-px bg-\[#E2DDD8\]"/, "the 1×22 divider");
});

test("one download icon; its menu lists the report's exports", () => {
  const d = part("DownloadMenu");
  assert.match(d, /aria-label="Export \/ print"/);
  assert.match(d, /<Download className="h-4 w-4" \/>/);
  assert.match(d, /onClick=\{\(\) => \{ setOpen\(false\); it\.onSelect\(\); \}\}/);
});

test("check strip: green when it balances, red when not", () => {
  const c = part("CheckStrip");
  assert.match(c, /ok \? "bg-\[#EEF5E9\]" : "bg-\[#FBEDEC\]"/);
  assert.match(c, /ok \? "text-\[#27500A\]" : "text-\[#9A3A2D\]"/);
});

test("the frame: 1.5px strong line, radius 10, centred company / report / note", () => {
  const f = part("ReportFrame");
  assert.match(f, /rounded-\[10px\] border-\[1\.5px\] border-\[#7A6E5E\] bg-white/);
  assert.match(f, /text-\[15px\] font-bold tracking-\[\.02em\] text-\[#1F1D1B\]">\{company\}/);
  assert.match(f, /text-\[13px\] text-\[#4B5563\]">\{title\}/);
  assert.match(f, /text-\[12px\] text-\[#9CA3AF\]">\{note\}/);
  assert.match(f, /style=\{maxHeight \? \{ maxHeight \} : undefined\}/, "a long report scrolls inside the frame so its header stays");
});

// The z-index a rule sets, by its exact selector.
const zOf = (sel) => {
  const i = css.indexOf(`${sel} {`);
  assert.ok(i >= 0, `rule ${sel}`);
  const body = css.slice(i, css.indexOf("}", i));
  const m = /z-index: (\d+);/.exec(body);
  assert.ok(m, `z-index in ${sel}`);
  return Number(m[1]);
};

test("layers: frozen first cell < lifted line < header < header's frozen cell", () => {
  const stick = zOf('[data-fin-ui] table[data-fin-report] [data-cell~="stick"]');
  const lift = zOf('[data-fin-ui] table[data-fin-report] > tbody > tr[data-row="line"]:hover');
  const head = zOf("[data-fin-ui] table[data-fin-report] > thead > tr > th");
  const headStick = zOf('[data-fin-ui] table[data-fin-report] > thead > tr > th[data-cell~="stick"]');
  assert.ok(stick < lift && lift < head && head < headStick, `${stick} < ${lift} < ${head} < ${headStick}`);
});

test("row kinds carry the design's colours", () => {
  for (const [row, v] of [
    ["sub", "#F1EEE8"], ["res", "#E9E3D8"], ["det", "#F4F6F8"], ["detsum", "#E8EDF2"],
  ]) {
    const i = css.indexOf(`tr[data-row="${row}"] > td {`);
    assert.ok(i >= 0, row);
    assert.ok(css.slice(i, css.indexOf("}", i)).includes(v), `${row} ${v}`);
  }
  const fin = css.slice(css.indexOf('tr[data-row="fin"] > td {'));
  assert.match(fin.slice(0, fin.indexOf("}")), /border-bottom: 3px double #1F1D1B;/);
  // An estimate and a negative win over the row's own colour (they come after).
  assert.ok(css.indexOf('td[data-cell~="est"]') > css.indexOf('tr[data-row="detsum"]'));
  assert.ok(css.indexOf("td[data-neg]") > css.indexOf('tr[data-row="detsum"]'));
  assert.match(css, /td\[data-neg\] \{\n  color: #9A3A2D;/);
});
