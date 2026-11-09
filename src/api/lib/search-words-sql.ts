// ---------------------------------------------------------------------------
// search-words-sql — the server-side twin of src/lib/grid-search.ts.
//
// Multi-word search (owner-approved 2026-11-08, item 24). List endpoints that
// take ?search= used to bind the WHOLE phrase as one `%phrase%` ILIKE, so
// "ivory 151" matched nothing. The DataGrid now requires every whitespace-
// separated word to match some column; the list endpoints a grid widens its
// search to (delivery orders, consignment notes, invoices) must apply the same
// rule or the server returns no rows for the grid to filter.
//
// `fragment` is the route's existing OR-group, written with one `?` per
// column, e.g. "(do_no ILIKE ? OR customer_name ILIKE ?)". It is a hard-coded
// string in the route — never caller input. The fragment is repeated once per
// word and joined with AND; each word is bound as `%word%` to every `?` in its
// copy. Words are bound as PARAMETERS, never interpolated.
//
// One word yields exactly the old clause and binds, so a single-word search is
// byte-identical to before. Words are capped (MAX_SEARCH_WORDS) so a pasted
// paragraph can't build an unbounded query.
// ---------------------------------------------------------------------------

export const MAX_SEARCH_WORDS = 8;

/** De-duplicated whitespace-separated words of a search term (case kept). */
export function splitSearchTerm(term: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of String(term ?? "").trim().split(/\s+/)) {
    if (!w) continue;
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= MAX_SEARCH_WORDS) break;
  }
  return out;
}

/**
 * AND-of-words clause. Returns `{ clause: "", binds: [] }` for a blank term.
 * `clause` has no leading " AND " — the caller joins it like its old fragment.
 */
export function allWordsClause(
  term: string | null | undefined,
  fragment: string,
): { clause: string; binds: string[] } {
  const words = splitSearchTerm(term);
  if (words.length === 0) return { clause: "", binds: [] };
  const perWord = (fragment.match(/\?/g) || []).length;
  const parts: string[] = [];
  const binds: string[] = [];
  for (const w of words) {
    parts.push(fragment);
    for (let i = 0; i < perWord; i++) binds.push(`%${w}%`);
  }
  return { clause: parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`, binds };
}
