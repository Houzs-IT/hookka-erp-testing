// ---------------------------------------------------------------------------
// grid-search — the DataGrid's global-search rule, pure so it can be tested.
//
// Multi-word search (owner-approved 2026-11-08, item 24). The search box used
// to match the WHOLE phrase as one substring, so "ivory 151" found nothing on a
// row whose code is "PC151-01" and whose colour is "IVORY SAND". Now the query
// is split on whitespace and EVERY word must appear somewhere in the row — in
// any searched column, not necessarily the same one. Case-insensitive.
//
//   "ivory 151"  -> ["ivory", "151"]  -> row matches when some column holds
//                                        "ivory" AND some column holds "151".
//
// A single-word query behaves exactly as before (one substring test).
// ---------------------------------------------------------------------------

/** Lower-cased, de-duplicated words of a search query; [] for a blank query. */
export function searchWords(query: string | null | undefined): string[] {
  const out: string[] = [];
  for (const w of String(query ?? "").toLowerCase().split(/\s+/)) {
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * True when every word is a substring of at least one of the (already
 * lower-cased) cell texts. An empty word list matches everything.
 */
export function cellsMatchAllWords(lowerCells: readonly string[], words: readonly string[]): boolean {
  for (const w of words) {
    let hit = false;
    for (const cell of lowerCells) {
      if (cell.includes(w)) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}

/**
 * Row-level helper used by the grid: reads each searched key through `get`,
 * stringifies + lower-cases it once, then applies the all-words rule.
 */
export function rowMatchesSearch<T>(
  row: T,
  keys: Iterable<string>,
  words: readonly string[],
  get: (row: T, key: string) => unknown,
): boolean {
  if (words.length === 0) return true;
  // Walk the columns once and stop as soon as every word has been seen, so a
  // one-word query costs what the old single-substring loop did (early exit
  // on the first hit) — the search pass is on the typing path.
  let remaining = words.slice();
  for (const k of keys) {
    const cell = String(get(row, k) ?? "").toLowerCase();
    if (!cell) continue;
    remaining = remaining.filter((w) => !cell.includes(w));
    if (remaining.length === 0) return true;
  }
  return false;
}

/**
 * Non-overlapping [start, end) ranges where any of `words` occurs in `text`,
 * sorted and merged — used to <mark> every matched word in a cell.
 */
export function matchRanges(text: string, words: readonly string[]): Array<[number, number]> {
  if (!text || words.length === 0) return [];
  const lower = text.toLowerCase();
  const raw: Array<[number, number]> = [];
  for (const w of words) {
    let i = lower.indexOf(w);
    while (i !== -1) {
      raw.push([i, i + w.length]);
      i = lower.indexOf(w, i + w.length);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
