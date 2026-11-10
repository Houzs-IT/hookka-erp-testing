// ---------------------------------------------------------------------------
// pdf-warehouse.ts — the warehouse a DO ships from / a GRN was received at,
// as printed on the paper (cross-system review D6; Houzs#5467, Conts#717).
//
// Hookka records no warehouse on a delivery order or a goods receipt: the
// `grns` and `delivery_orders` rows have no warehouse column, every finished
// good sits in the one factory's racks and every raw material is received
// there. So the paper names that site. A caller that does know a warehouse
// (a future multi-site setup) passes it and it wins. The GRN used to print a
// "Warehouse" row that was always "-" because no caller passed one.
// Display only.
// ---------------------------------------------------------------------------
import { COMPANY } from "./constants";

/** The one site Hookka ships from and receives at (the factory in the letterhead). */
export const DEFAULT_WAREHOUSE_LABEL = `${COMPANY.HOOKKA.shortName}, Sungai Buloh`;

/** What to print on the Ship From / Received At row. */
export function warehousePrintName(recorded?: string | null): string {
  const s = String(recorded ?? "").trim();
  return s && s !== "-" ? s : DEFAULT_WAREHOUSE_LABEL;
}
