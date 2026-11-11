// ---------------------------------------------------------------------------
// products-ui — the small hooks and constants shared by the Products list
// (ProductsScreen) and the SKU detail (ProductDetailScreen). Kept out of the
// screen files so those export only components (react-refresh lint rule).
// ---------------------------------------------------------------------------
import { useCallback, useState } from "react";
import { productsConfig } from "../config/modules";
import { M_CAT } from "../theme";
import { SOFA_TIER_KEY, categoryTone, readSofaTier, type SofaTier } from "./products-hub";

/** GET /api/products — the same cached read for list and detail. */
export const PRODUCTS_URL = productsConfig.sources[0].url;
/** Family photos (the desktop Catalog's storage), cover chosen by coverByFamily. */
export const PHOTOS_URL = "/api/files?resourceType=modular";

/** Category tone (theme-aware fg / bg / placeholder gradient + on-photo colour). */
export const toneOf = (category: string) => M_CAT[categoryTone(category)];

function readTierPref(): SofaTier {
  try {
    return readSofaTier(window.localStorage.getItem(SOFA_TIER_KEY));
  } catch {
    return "PRICE_2";
  }
}

/** Sofa tier view, remembered under the desktop SKU Master's key. */
export function useSofaTier(): [SofaTier, (t: SofaTier) => void] {
  const [tier, setTierState] = useState<SofaTier>(readTierPref);
  const setTier = useCallback((t: SofaTier) => {
    setTierState(t);
    try {
      window.localStorage.setItem(SOFA_TIER_KEY, t);
    } catch {
      /* preference only */
    }
  }, []);
  return [tier, setTier];
}

/** Press feedback (scale on pointer down) for tappable cards. */
export function usePressed() {
  const [pressed, setPressed] = useState(false);
  const on = () => setPressed(true);
  const off = () => setPressed(false);
  return {
    pressed,
    handlers: { onPointerDown: on, onPointerUp: off, onPointerLeave: off, onPointerCancel: off },
  };
}
