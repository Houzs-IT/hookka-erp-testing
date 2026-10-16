// Phone header geometry shared by MobileHeader and the rows pinned under it.
import { useResponsiveLayout } from "./responsive-layout";

/** Height of the MobileHeader row, excluding the top safe-area inset. */
export const MOBILE_HEADER_ROW = 52;

/** Where to pin a sticky row (SubTabs, the Dashboard section picker) so it sits
 * directly under the MobileHeader. Phones add the top safe-area inset, which
 * the header pads by (viewport-fit=cover); tablets keep the old offset. */
export function useStickyBelowHeader(): number | string {
  const { mode } = useResponsiveLayout();
  return mode === "phone"
    ? `calc(${MOBILE_HEADER_ROW}px + env(safe-area-inset-top, 0px))`
    : MOBILE_HEADER_ROW;
}
