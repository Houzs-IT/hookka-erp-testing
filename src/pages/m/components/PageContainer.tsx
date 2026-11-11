// PageContainer — a centred, width-capped column for a screen's content.
//
// Four places already hand-write this: the Delivery detail
// (`maxWidth: tablet && !canSplitDetail ? 760 : undefined, margin: "0 auto"`),
// the Procurement detail body, the Procurement full-screen dialog (all 760),
// and the Product detail (720). This is that one wrapper.
//
// It caps and centres; it deliberately does NOT pad. Each approved 390px screen
// owns its own padding (16 / 18 / 14 px vary by design), so a shared gutter would
// move phone pixels. Pass `maxWidth="none"` where today's code leaves the width
// uncapped (a split-view pane), to keep that screen's behaviour exact.
import { type HTMLAttributes, type ReactNode } from "react";

/** The readable column width the Delivery and Procurement screens already use. */
export const PAGE_MAX_WIDTH = 760;

type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  /** CSS px or any CSS length; `"none"` leaves the width uncapped. Default PAGE_MAX_WIDTH. */
  maxWidth?: number | string;
};

export function PageContainer({ children, maxWidth = PAGE_MAX_WIDTH, style, ...rest }: Props) {
  return (
    <div
      {...rest}
      style={{
        width: "100%",
        maxWidth,
        marginLeft: "auto",
        marginRight: "auto",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
