// ---------------------------------------------------------------------------
// grid-multi-word-search.test.mjs — search splits on whitespace and requires
// EVERY word to match (any column). Owner-approved item 24, 2026-11-08.
//
// Before: "ivory 151" was one substring and found nothing on a row holding
// "PC151-01" in one column and "IVORY SAND" in another. Covers the DataGrid's
// client filter (src/lib/grid-search.ts) and the server twin used by the list
// endpoints a grid widens its search to (src/api/lib/search-words-sql.ts).
// Run: node --import tsx/esm --test tests/grid-multi-word-search.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchWords, rowMatchesSearch, matchRanges, cellsMatchAllWords } from "../src/lib/grid-search.ts";
import { allWordsClause, splitSearchTerm, MAX_SEARCH_WORDS } from "../src/api/lib/search-words-sql.ts";

const get = (row, key) => row[key];
const ROW = { code: "PC151-01", colour: "IVORY SAND", qty: 12 };
const KEYS = ["code", "colour", "qty"];

test("searchWords splits on any whitespace, lower-cases, de-dupes", () => {
  assert.deepEqual(searchWords("  Ivory\t151  ivory "), ["ivory", "151"]);
  assert.deepEqual(searchWords(""), []);
  assert.deepEqual(searchWords("   "), []);
  assert.deepEqual(searchWords(undefined), []);
});

test('"ivory 151" finds "PC151-01 IVORY SAND" across two columns', () => {
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("ivory 151"), get), true);
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("151 sand"), get), true);
});

test("every word must match — one missing word rejects the row", () => {
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("ivory 152"), get), false);
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("black"), get), false);
});

test("single word behaves like the old substring rule; blank matches all", () => {
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("c151"), get), true);
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("12"), get), true);
  assert.equal(rowMatchesSearch(ROW, KEYS, [], get), true);
  // The old whole-phrase rule still works when the phrase sits in one cell.
  assert.equal(rowMatchesSearch(ROW, KEYS, searchWords("ivory sand"), get), true);
});

test("only the searched keys count", () => {
  assert.equal(rowMatchesSearch(ROW, ["code"], searchWords("ivory 151"), get), false);
});

test("cellsMatchAllWords", () => {
  assert.equal(cellsMatchAllWords(["abc", "def"], ["a", "f"]), true);
  assert.equal(cellsMatchAllWords(["abc", "def"], ["a", "z"]), false);
  assert.equal(cellsMatchAllWords([], []), true);
});

test("matchRanges marks every word, merged and ordered", () => {
  assert.deepEqual(matchRanges("PC151-01 IVORY SAND", ["ivory", "151"]), [[2, 5], [9, 14]]);
  assert.deepEqual(matchRanges("aaaa", ["aa", "a"]), [[0, 4]]);
  assert.deepEqual(matchRanges("abc", []), []);
  assert.deepEqual(matchRanges("", ["a"]), []);
});

test("DataGrid's filter + highlighter use the shared helper", () => {
  const src = readFileSync("src/components/ui/data-grid.tsx", "utf8");
  assert.match(src, /from "@\/lib\/grid-search"/);
  assert.match(src, /rowMatchesSearch\(row, searchKeys, words, getNestedValue\)/);
  assert.match(src, /matchRanges\(text, searchWords\(query\)\)/);
  assert.doesNotMatch(src, /deferredSearch\.toLowerCase\(\)/, "the old whole-phrase filter is back");
});

// ── server twin ────────────────────────────────────────────────────────────
const FRAG = "(a ILIKE ? OR b ILIKE ?)";

test("allWordsClause: blank term → no clause", () => {
  assert.deepEqual(allWordsClause("", FRAG), { clause: "", binds: [] });
  assert.deepEqual(allWordsClause("   ", FRAG), { clause: "", binds: [] });
});

test("allWordsClause: one word is byte-identical to the old single-phrase clause", () => {
  assert.deepEqual(allWordsClause("  8585 ", FRAG), { clause: FRAG, binds: ["%8585%", "%8585%"] });
});

test("allWordsClause: n words → n AND-joined copies, binds per placeholder", () => {
  const r = allWordsClause("ivory 151", FRAG);
  assert.equal(r.clause, `(${FRAG} AND ${FRAG})`);
  assert.deepEqual(r.binds, ["%ivory%", "%ivory%", "%151%", "%151%"]);
  assert.equal((r.clause.match(/\?/g) || []).length, r.binds.length, "placeholder count must equal bind count");
});

test("allWordsClause: words are bound, never interpolated; capped", () => {
  const r = allWordsClause("x'; DROP TABLE t; --", FRAG);
  assert.doesNotMatch(r.clause, /DROP|x'/);
  const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  assert.equal(splitSearchTerm(many).length, MAX_SEARCH_WORDS);
  assert.deepEqual(splitSearchTerm("Ivory ivory IVORY"), ["Ivory"]);
});

test("DO / CN / Invoice list routes build their search via allWordsClause", () => {
  for (const f of ["delivery-orders", "consignment-notes", "invoices"]) {
    const src = readFileSync(`src/api/routes/${f}.ts`, "utf8");
    assert.match(src, /import \{ allWordsClause \} from "\.\.\/lib\/search-words-sql";/, f);
    assert.match(src, /allWordsClause\(\s*(dq|q),/, f);
  }
});
