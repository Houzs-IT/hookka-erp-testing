// The `grid-template-columns` maths behind <ResponsiveGrid>, kept apart from the
// component so it is unit-testable and the component file only exports a component.

/** Narrowest a card may get before the grid drops a column. */
export const GRID_MIN_COLUMN_WIDTH = 320;

/** The /m card gap token (12px on phones, 16px from 720px; see theme-vars.css). */
export const CARD_GAP = "var(--m-card-gap, 12px)";

/**
 * The `grid-template-columns` value. `min(100%, Npx)` keeps a container that is
 * narrower than `min` from overflowing. `maxColumns` caps the count: a column is
 * never narrower than an equal share of the row, so no more than `maxColumns`
 * ever fit.
 */
export function responsiveGridTemplate(
  min: number = GRID_MIN_COLUMN_WIDTH,
  maxColumns?: number,
  gap: string = CARD_GAP,
): string {
  // One column is simply one flexible track (what the phone screens already use).
  if (maxColumns === 1) return "minmax(0, 1fr)";
  const floor = `min(100%, ${min}px)`;
  if (!maxColumns || maxColumns < 1) return `repeat(auto-fill, minmax(${floor}, 1fr))`;
  const share = `calc((100% - ${gap} * ${maxColumns - 1}) / ${maxColumns})`;
  return `repeat(auto-fill, minmax(max(${floor}, ${share}), 1fr))`;
}
