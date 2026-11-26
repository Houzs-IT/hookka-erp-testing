// Status pills of the Daily Report details: the design's pill shape, coloured by the repo's own status maps (never the prototype's colours).
//   so   -> the Sales Order status map (design-tokens SO_STATUS_COLOR)
//   prod -> the Production Order status map (PRODUCTION_STATUS_COLOR), tinted like the phone Production board
//   po   -> the phone Procurement PO map (procurement-mobile PO_STATUS) through the delivery pill tones
//   do   -> the Delivery status map, DRAFT: the check flags only delivery orders still waiting to be dispatched
import { resolveStatus, STATUS_MAPS } from "../../config/helpers";
import { statusOf } from "../../lib/procurement-mobile";
import { statusTint } from "../../lib/production-ui";
import { pill as tonePill } from "../delivery/ui-tokens";
import { statusWords, type DrCard } from "./ops-lib";

export type StatusPillLook = { label: string; bg: string; fg: string };

export function statusPill(kind: DrCard["statusKind"], raw: string): StatusPillLook | null {
  if (!kind || !raw) return null;
  if (kind === "po") {
    const st = statusOf("po", raw);
    return { label: st.label, ...tonePill(st.tone) };
  }
  if (kind === "do") {
    const t = statusTint(resolveStatus(raw, STATUS_MAPS.delivery).style.hex);
    return { label: "Pending dispatch", ...t };
  }
  const map = kind === "so" ? STATUS_MAPS.so : STATUS_MAPS.production;
  return { label: statusWords(raw), ...statusTint(resolveStatus(raw, map).style.hex) };
}
