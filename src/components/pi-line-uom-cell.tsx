// HK-0149 — the Unit cell of a purchase-invoice line. A line picked off a PO
// line may be billed in another unit (ordered in ROLL, received in MTR); the
// choice is saved on the PI line only. Billed in another unit, the line also
// says how much of the PO line it covers, in the PO line's unit (e.g. 100 MTR
// for 2 of 3 ROLL). Other lines show their unit as text.
import { useEffect, useState } from "react";
import { fetchVariantsConfig, getVariantsConfigSync } from "@/lib/kv-config";
import { rmUnitsFrom, sameUom } from "@/lib/material-variants";

export function PiLineUomCell(props: {
  /** The unit the line is billed in (defaults to the PO line's). */
  uom: string | null | undefined;
  /** The PO line's unit; editable only when known. */
  poUnit: string | null | undefined;
  editable: boolean;
  onChange?: (uom: string) => void;
  /** How much of the PO line this line covers, in the PO line's unit. */
  poQty?: number | null;
  /** Filled in when the unit is first changed (the line's quantity in the PO unit). */
  defaultPoQty?: number;
  onPoQtyChange?: (qty: number) => void;
}) {
  const [cfg, setCfg] = useState(() => getVariantsConfigSync());
  useEffect(() => {
    if (props.editable) void fetchVariantsConfig().then(setCfg);
  }, [props.editable]);
  const shown = props.uom || props.poUnit || "";
  const differs = !!props.poUnit && !sameUom(shown, props.poUnit);
  if (!props.editable || !props.poUnit) {
    return (
      <span className="text-sm text-[#6B7280]">
        {shown || "—"}
        {differs && props.poQty != null && (
          <span className="block text-[11px] leading-tight text-[#9CA3AF]">
            for {props.poQty} {props.poUnit}
          </span>
        )}
      </span>
    );
  }
  const units = rmUnitsFrom(cfg);
  const options = units.some((u) => sameUom(u, shown)) ? units : [shown.toUpperCase(), ...units];
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label="Unit"
        title={differs ? `PO line is in ${props.poUnit}. This quantity goes into stock; the PO line counts the ${props.poUnit} it covers.` : undefined}
        className={`h-8 rounded-md border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B5C32]/20 ${differs ? "border-[#B8860B]" : "border-[#E2DDD8]"}`}
        value={options.find((u) => sameUom(u, shown)) ?? shown}
        onChange={(e) => {
          const next = e.target.value;
          props.onChange?.(next);
          if (!sameUom(next, props.poUnit) && props.poQty == null && props.defaultPoQty != null) {
            props.onPoQtyChange?.(props.defaultPoQty);
          }
        }}
      >
        {options.map((u) => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>
      {differs && (
        <label className="flex items-center gap-1 text-[11px] text-[#6B7280]">
          for
          <input
            type="number"
            min={0}
            step="any"
            aria-label={`${props.poUnit} covered`}
            className="h-7 w-16 rounded-md border border-[#E2DDD8] bg-white px-1 text-sm"
            value={props.poQty ?? ""}
            onChange={(e) => props.onPoQtyChange?.(Number(e.target.value) || 0)}
          />
          {props.poUnit}
        </label>
      )}
    </div>
  );
}
