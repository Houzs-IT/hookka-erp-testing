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
export type ForecastMonth = { salesStr: string; pct: Record<string, ForecastCell> };

export function forecastSnapshot(months: Record<string, ForecastMonth>): string {
  return JSON.stringify(
    Object.keys(months)
      .sort()
      .map((ym) => {
        const m = months[ym];
        const cells = Object.entries(m.pct)
          .filter(([, e]) => (e.a ?? "") !== "" || (e.p ?? "") !== "")
          .map(([code, e]) => [code, (e.a ?? "") !== "" ? `a:${e.a}` : `p:${e.p}`])
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
        return [ym, (m.salesStr ?? "").trim(), cells];
      }),
  );
}
