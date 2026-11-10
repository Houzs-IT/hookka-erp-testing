// ---------------------------------------------------------------------------
// loading-figure — a KPI tile, header count or total shows "—" while the data
// behind it has not arrived, never "0" or "RM 0.00" that staff read as real
// (review pass 2 C1-11, Conts#186 / #188). Once loaded, a real zero shows as
// zero. Display only: the value itself is never changed.
//
//   <p className="text-2xl font-bold">{figureOrDash(kpiLoading, statsTotal)}</p>
//   <p>{figureOrDash(!loaded, openValueSen, (v) => formatCurrency(v / 100))}</p>
// ---------------------------------------------------------------------------

export const LOADING_DASH = "—";

/** The figure as text, or "—" while it is still loading. */
export function figureOrDash<T>(loading: boolean, value: T, format?: (v: T) => string): string {
  if (loading) return LOADING_DASH;
  return format ? format(value) : String(value);
}
