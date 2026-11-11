// ResponsiveGrid — a card grid that sizes itself to the box it sits in.
//
// Pure CSS (`auto-fill` + `minmax`), so the column count follows the
// CONTAINER's width with no mode check: one column on the 390px phone and in the
// split view's list pane, more columns where the content area is wide. It
// replaces the `repeat(auto-fill, minmax(320px, 1fr))` that Delivery and
// Procurement each wrote by hand (their migration is a later, separate step).
import { type HTMLAttributes, type ReactNode } from "react";
import { CARD_GAP, responsiveGridTemplate } from "../lib/responsive-grid";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  /** Narrowest card, in px. Default 320. */
  min?: number;
  /** Cap on the number of columns. Omit for "as many as fit". */
  maxColumns?: number;
  /** Any CSS length; defaults to the card-gap token. */
  gap?: string | number;
};

export function ResponsiveGrid({ children, min, maxColumns, gap, style, ...rest }: Props) {
  const gapCss = gap == null ? CARD_GAP : typeof gap === "number" ? `${gap}px` : gap;
  return (
    <div
      {...rest}
      style={{
        display: "grid",
        gridTemplateColumns: responsiveGridTemplate(min, maxColumns, gapCss),
        gap: gapCss,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
