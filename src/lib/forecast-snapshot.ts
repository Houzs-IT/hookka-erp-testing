// ---------------------------------------------------------------------------
// forecastSnapshot — the Forecast P&L sheet's content as one comparable
// string, for the unsaved-changes banner and leave guard (finance v2).
//
// Months in order; per month the keyed sales and the keyed cells, each cell by
// the side that wins on Save (an amount over a %). Empty cells are dropped, so
// typing a figure and clearing it again — or adding a month and removing it —
// is not a change.
// ---------------------------------------------------------------------------

export type ForecastCell = { p?: string; a?: string };
/** `customers` (owner 2026-11-09): the sales keyed per customer, as typed.
 *  `suppliers` (owner 2026-11-10): the purchases keyed per material, then per
 *  supplier, as typed — RM or % like a line's cell. */
export type ForecastMonth = {
  salesStr: string;
  pct: Record<string, ForecastCell>;
  customers?: Record<string, string>;
  suppliers?: Record<string, Record<string, ForecastCell>>;
};

const byKey = (x: string[], y: string[]) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
const keyedCells = (cells: Record<string, string> | undefined): string[][] =>
  Object.entries(cells ?? {})
    .map(([id, v]) => [id, (v ?? "").trim()])
    .filter(([, v]) => v !== "")
    .sort(byKey);
// A supplier cell by the side that is keyed (an RM amount over a %), "" when
// neither is.
const supplierSide = (e: ForecastCell | undefined): string => {
  const a = (e?.a ?? "").trim();
  if (a !== "") return `a:${a}`;
  const p = (e?.p ?? "").trim();
  return p !== "" ? `p:${p}` : "";
};
// A material's supplier cells keyed "<material>|<supplier>", so the same
// supplier under another material is another cell.
const keyedSupplierCells = (byType: Record<string, Record<string, ForecastCell>> | undefined): string[][] =>
  Object.entries(byType ?? {})
    .flatMap(([type, cells]) =>
      Object.entries(cells ?? {})
        .map(([id, e]) => [`${type}|${id}`, supplierSide(e)])
        .filter(([, v]) => v !== ""),
    )
    .sort(byKey);

export function forecastSnapshot(months: Record<string, ForecastMonth>): string {
  return JSON.stringify(
    Object.keys(months)
      .sort()
      .map((ym) => {
        const m = months[ym];
        const cells = Object.entries(m.pct)
          .filter(([, e]) => (e.a ?? "") !== "" || (e.p ?? "") !== "")
          .map(([code, e]) => [code, (e.a ?? "") !== "" ? `a:${e.a}` : `p:${e.p}`])
          .sort(byKey);
        // Customer and supplier cells only when there are any, so a month
        // keyed the old way reads exactly as before.
        const customers = keyedCells(m.customers);
        const suppliers = keyedSupplierCells(m.suppliers);
        const out: unknown[] = [ym, (m.salesStr ?? "").trim(), cells];
        if (customers.length || suppliers.length) out.push(customers);
        if (suppliers.length) out.push(suppliers);
        return out;
      }),
  );
}
