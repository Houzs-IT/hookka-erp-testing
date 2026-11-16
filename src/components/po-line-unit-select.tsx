// HK-0149 — the Unit of a PO line. Defaults to the material's stock unit; any
// unit on the RM unit list may be chosen for this order only (Violet
// 2026-11-16: fabric is stocked in MTR but ordered in ROLL, and the same for
// any raw material). The material itself is not changed.
import { useEffect, useState } from "react";
import { fetchVariantsConfig, getVariantsConfigSync } from "@/lib/kv-config";
import { rmUnitsFrom, sameUom } from "@/lib/material-variants";

export function PoLineUnitSelect(props: {
  value: string;
  onChange: (unit: string) => void;
  /** A line already (part-)received keeps its unit (the server refuses a change). */
  disabled?: boolean;
  className?: string;
}) {
  const [cfg, setCfg] = useState(() => getVariantsConfigSync());
  useEffect(() => {
    void fetchVariantsConfig().then(setCfg);
  }, []);
  const units = rmUnitsFrom(cfg);
  const value = props.value || "";
  const options = !value || units.some((u) => sameUom(u, value)) ? units : [value, ...units];
  return (
    <select
      aria-label="Unit"
      disabled={props.disabled}
      className={`h-8 rounded-md border border-[#E2DDD8] bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B5C32]/20 disabled:bg-[#F9FAFB] ${props.className ?? ""}`}
      value={options.find((u) => sameUom(u, value)) ?? value}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {options.map((u) => (
        <option key={u} value={u}>{u}</option>
      ))}
    </select>
  );
}
