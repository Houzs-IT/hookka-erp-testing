// HK-0149 — the Unit cell of a purchase-invoice line. A line picked off a PO
// line may be billed in another unit (ordered in ROLL, received in MTR); the
// choice is saved on the PI line only. Other lines show their unit as text.
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
}) {
  const [cfg, setCfg] = useState(() => getVariantsConfigSync());
  useEffect(() => {
    if (props.editable) void fetchVariantsConfig().then(setCfg);
  }, [props.editable]);
  const shown = props.uom || props.poUnit || "";
  if (!props.editable || !props.poUnit) return <span className="text-sm text-[#6B7280]">{shown || "—"}</span>;
  const units = rmUnitsFrom(cfg);
  const options = units.some((u) => sameUom(u, shown)) ? units : [shown.toUpperCase(), ...units];
  const differs = !sameUom(shown, props.poUnit);
  return (
    <select
      aria-label="Unit"
      title={differs ? `PO line is in ${props.poUnit}. Billed in ${shown}: this line is not counted against the PO quantity or received into stock.` : undefined}
      className={`h-8 rounded-md border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B5C32]/20 ${differs ? "border-[#B8860B]" : "border-[#E2DDD8]"}`}
      value={options.find((u) => sameUom(u, shown)) ?? shown}
      onChange={(e) => props.onChange?.(e.target.value)}
    >
      {options.map((u) => (
        <option key={u} value={u}>{u}</option>
      ))}
    </select>
  );
}
