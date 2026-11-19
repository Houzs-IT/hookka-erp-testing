// Page a row list by GROUP (e.g. 15 invoices a page) instead of by row, so one
// group's rows never split across two pages. Groups are counted in the order
// they first appear in `rows`; the rows keep their own order. Used by
// DataGrid's opt-in `pageBy` / `pageSize` (HK-0158 Invoice Price Summary).
export function pageByGroup<T>(
  rows: T[],
  groupOf: (row: T) => string,
  size: number,
  page: number,
): { rows: T[]; page: number; pageCount: number; groupCount: number; firstGroup: number; lastGroup: number } {
  const index = new Map<string, number>();
  for (const r of rows) {
    const g = groupOf(r);
    if (!index.has(g)) index.set(g, index.size);
  }
  const groupCount = index.size;
  const pageCount = Math.max(1, Math.ceil(groupCount / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const lo = (p - 1) * size;
  const hi = lo + size;
  return {
    rows: rows.filter((r) => {
      const i = index.get(groupOf(r))!;
      return i >= lo && i < hi;
    }),
    page: p,
    pageCount,
    groupCount,
    firstGroup: groupCount === 0 ? 0 : lo + 1,
    lastGroup: Math.min(hi, groupCount),
  };
}
