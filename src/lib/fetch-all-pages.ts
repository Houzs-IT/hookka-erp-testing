// ---------------------------------------------------------------------------
// fetch-all-pages — every row of a server-paged list, for the grid Export.
//
// A paged list page holds only the page on screen, so its Export wrote only
// that page (BUG-2026-10-12-281). This walks the SAME scoped list route the
// page already uses, page by page, and refuses rather than return a short set:
// a failed page, a total above EXPORT_ROW_CAP, or a list that shrank mid-walk
// all throw, so no file is written.
// ---------------------------------------------------------------------------

export const EXPORT_ROW_CAP = 20000;
const PAGE_LIMIT = 500; // the list routes clamp limit to 500

type PageBody<T> = { success?: boolean; data?: T[]; total?: number; limit?: number };

export async function fetchAllPages<T extends { id?: string }>(
  urlForPage: (page: number, limit: number) => string,
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  const get = async (page: number): Promise<PageBody<T> & { data: T[] }> => {
    const r = await fetchImpl(urlForPage(page, PAGE_LIMIT));
    const body = (r.ok ? await r.json() : null) as PageBody<T> | null;
    if (!body?.success || !Array.isArray(body.data)) {
      throw new Error(`Export stopped: page ${page} of the list did not load. Nothing was downloaded, try again.`);
    }
    return body as PageBody<T> & { data: T[] };
  };

  const first = await get(1);
  const total = Number(first.total ?? first.data.length);
  if (total > EXPORT_ROW_CAP) {
    throw new Error(`${total} rows match, the export takes up to ${EXPORT_ROW_CAP}. Narrow the filter and try again.`);
  }
  const size = Number(first.limit) || PAGE_LIMIT;
  const rows = [...first.data];
  for (let p = 2; p <= Math.ceil(total / size); p++) rows.push(...(await get(p)).data);

  // A row added while walking shifts the pages and repeats a row; keep one.
  const seen = new Set<string>();
  const unique = rows.filter((r) => !r.id || (seen.has(r.id) ? false : (seen.add(r.id), true)));
  if (unique.length < total) {
    throw new Error("The list changed while exporting. Nothing was downloaded, try again.");
  }
  return unique;
}
