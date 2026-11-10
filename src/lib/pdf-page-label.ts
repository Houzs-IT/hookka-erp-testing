// ---------------------------------------------------------------------------
// pdf-page-label.ts — "Page x of y" counted within ONE document (review H3-10,
// Houzs#5552). A batch print (the DO packing list, the CN packing list) stacks
// several documents in one file; numbering the whole file made the second DO's
// first page read "Page 3 of 7". Each document now restarts at "Page 1".
//
// `starts` are the 1-based page numbers where each document begins, in order
// (the manifest cover counts as its own document). Pure — no jsPDF here.
// ---------------------------------------------------------------------------

/** The label for `page` in a file of `pageCount` pages split at `starts`. */
export function docPageLabel(page: number, pageCount: number, starts: number[] = [1]): string {
  const sorted = [...new Set(starts.filter((s) => s >= 1 && s <= pageCount))].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted[0] !== 1) sorted.unshift(1);
  let start = 1;
  let end = pageCount;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] <= page) {
      start = sorted[i];
      end = i + 1 < sorted.length ? sorted[i + 1] - 1 : pageCount;
    }
  }
  return `Page ${page - start + 1} of ${end - start + 1}`;
}
