// ---------------------------------------------------------------------------
// cashbook-pick-list.test.mjs — Cash Book matching by pick list (finance
// backlog item 16, owner 2026-10-17 「这个可以」; the design's Cash Book).
// Each open bank line shows its suggested book entry (the single open entry
// with the same amount) and Match / Pick / Book / Ignore; Pick lists the
// entries it could have paid — one with the same amount is a plain match,
// several adding up exactly a split match; ticking bank lines offers
// "Combine & match to <ref>". Same endpoints as before; the server checks
// every match again. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const p = await import(pathToFileURL(resolve(process.cwd(), "src/lib/bank-pick.ts")).href);

const leg = (id, amountSen, day = "2026-10-01", description = `HPV-2610-0${id} · x`) => ({ id, day, description, amountSen });
const open = [leg("1", -9280, "2026-10-04"), leg("2", -6500, "2026-10-04"), leg("3", -15780, "2026-10-02"), leg("4", 32400), leg("5", -4312), leg("6", -4312, "2026-10-09"), leg("7", -20000)];

test("suggestion: the single open entry with the same amount; several → use Pick; none → Pick or Book", () => {
  assert.deepEqual(p.suggestionFor({ amountSen: 32400 }, open), { kind: "one", leg: open[3] });
  assert.deepEqual(p.suggestionFor({ amountSen: -4312 }, open), { kind: "several", n: 2 });
  assert.deepEqual(p.suggestionFor({ amountSen: -1 }, open), { kind: "none" });
  assert.deepEqual(p.suggestionFor({ amountSen: 9280 }, open), { kind: "none" }, "the direction counts");
});

test("pick list: same direction, no bigger than the line, oldest first", () => {
  assert.deepEqual(p.pickCandidates({ amountSen: -15780 }, open).map((l) => l.id), ["5", "3", "1", "2", "6"]);
  assert.deepEqual(p.pickCandidates({ amountSen: 100 }, open), [], "nothing coming in that small");
  assert.deepEqual(p.pickCandidates({ amountSen: 0 }, open), []);
});

test("pick state: exact, short or over — and which match it makes", () => {
  const line = { amountSen: -15780 };
  assert.deepEqual(p.pickState(line, []), { exact: false, diffSen: 15780 });
  assert.deepEqual(p.pickState(line, [open[0]]), { exact: false, diffSen: 6500 }, "short 65.00");
  assert.deepEqual(p.pickState(line, [open[0], open[1]]), { exact: true, diffSen: 0 });
  assert.deepEqual(p.pickState(line, [open[0], open[1], open[4]]), { exact: false, diffSen: -4312 }, "over 43.12");
  assert.deepEqual(p.pickState(line, [open[2]]), { exact: true, diffSen: 0 });
  assert.equal(p.pickAction([]), null);
  assert.equal(p.pickAction([open[2]]), "match");
  assert.equal(p.pickAction([open[0], open[1]]), "split");
  assert.equal(p.pickAction(Array.from({ length: p.PICK_MAX + 1 }, (_, i) => leg(String(i), -1))), null, "the split endpoint takes 2–20");
});

test("combine: two or more ticked bank lines offer the entries equal to their sum", () => {
  assert.deepEqual(p.comboCandidates([{ amountSen: -9280 }], open), []);
  assert.deepEqual(p.comboCandidates([{ amountSen: -9280 }, { amountSen: -6500 }], open).map((l) => l.id), ["3"]);
  assert.deepEqual(p.comboCandidates([{ amountSen: -1 }, { amountSen: -2 }], open), []);
});

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const cb = (() => { const a = ui.indexOf("function CashBookTab({ accounts }: { accounts: ChartOfAccount[] }) {"); return ui.slice(a, ui.indexOf("\n}\n", a)); })();

test("screen: the Suggested column and Match / Pick / Book / Ignore on every open bank line", () => {
  assert.match(cb, /<th className="px-3 py-2 text-left">Suggested book entry<\/th>/);
  assert.match(cb, /const sug = suggestionFor\(s, unmatchedLegs\);/);
  assert.match(cb, /None with the same amount — use Pick or Book/);
  assert.match(cb, /same-amount entries — use Pick/);
  assert.match(cb, /disabled=\{sug\.kind !== "one" \|\| busy\}\n\s*onClick=\{\(\) => \{ if \(sug\.kind === "one"\) void handleMatch\(s\.id, sug\.leg\.id\); \}\}/);
  assert.match(cb, /\{pickFor\?\.id === s\.id \? "Close" : "Pick"\}/);
  assert.match(cb, />\n\s*Book\n\s*<\/Button>/);
  assert.match(cb, /onClick=\{\(\) => handleIgnore\(s\.id, true\)\} title="Leave this line out of the reconciliation">Ignore<\/Button>/);
  assert.doesNotMatch(cb, /match to…/, "the drop-down is gone");
  assert.doesNotMatch(cb, /split across…|splitFor|handleSplitMatch/, "the split panel became the Pick list");
});

test("screen: the Pick list — tick entries, Exact ✓ / Short / Over, one = plain match, several = split", () => {
  assert.match(cb, /const cands = pickCandidates\(s, unmatchedLegs\);/);
  assert.match(cb, /Tick the book entries this bank line paid/);
  assert.match(cb, /\{ps\.exact \? "Exact ✓" : `\$\{ps\.diffSen > 0 \? "Short" : "Over"\} \$\{formatCurrency\(Math\.abs\(ps\.diffSen\)\)\}`\}/);
  assert.match(cb, /disabled=\{!ps\.exact \|\| !act \|\| busy\} onClick=\{\(\) => void handlePickMatch\(s\.id, picked\.map\(\(l\) => l\.id\)\)\}/);
  const h = cb.slice(cb.indexOf("const handlePickMatch = async"), cb.indexOf("const handleBookLine = async"));
  assert.match(h, /if \(legIds\.length === 1\) \{\n\s*if \(await handleMatch\(lineId, legIds\[0\]\)\) setPickFor\(null\);/);
  assert.match(h, /fetch\("\/api\/accounting\/bank-reco\/match-split"/);
  assert.match(cb, /placeholder="Filter by ref, name, date or amount"/);
});

test("screen: ticked bank lines combine — a button per entry of that total", () => {
  assert.match(cb, /const cands = comboCandidates\(sel, unmatchedLegs\);/);
  assert.match(cb, /Combine &amp; match to \{docNoFromDescription\(l\.description\) \?\? l\.day\}/);
  assert.match(cb, /onClick=\{\(\) => void handleGroupMatch\(l\.id\)\}/);
  assert.match(cb, /Tick another line to combine them into one book entry/);
});
