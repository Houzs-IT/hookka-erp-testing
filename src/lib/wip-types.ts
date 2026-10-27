// WIP component types offered in the BOM editor's type dropdown.
//
// The six built-in types carry factory rules keyed by their code (department
// chains in bom-wip-breakdown.ts, the SOFA_ sofa-set scan fan-out, foam
// bonding planning), so they are fixed. Extra types (e.g. Sandback) are typed
// as plain names in Products > Maintenance > BOM > WIP Types and saved in
// variants-config.wipTypes. An extra type has no fixed rules: its departments
// come from the BOM's own processes.

import { bomProductType } from "./bom-variant-fields";

export type WipTypeStyle = { label: string; color: string };

export const BUILT_IN_WIP_TYPES: Record<string, WipTypeStyle> = {
  HEADBOARD: { label: "Headboard", color: "#7C3AED" },
  DIVAN: { label: "Divan", color: "#0891B2" },
  SOFA_BASE: { label: "Sofa Base", color: "#059669" },
  SOFA_CUSHION: { label: "Back Cushion", color: "#D97706" },
  SOFA_ARMREST: { label: "Sofa Armrest", color: "#DC2626" },
  SOFA_HEADREST: { label: "Sofa Headrest", color: "#7C3AED" },
};

const EXTRA_COLOR = "#6B7280";

// Used until Maintenance is saved with its own list. A saved empty list means
// "no extras" and is kept as is.
export const DEFAULT_EXTRA_WIP_TYPES = ["Sandback"];

// "Sandback" -> "SANDBACK", "Sofa Foot Rest" -> "SOFA_FOOT_REST".
export function wipTypeCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Built-ins first, then each saved extra name (the defaults when nothing is
// saved). A name whose code is blank or already taken is skipped.
export function buildWipTypes(extraNames: unknown): Record<string, WipTypeStyle> {
  const out: Record<string, WipTypeStyle> = { ...BUILT_IN_WIP_TYPES };
  for (const n of Array.isArray(extraNames) ? extraNames : DEFAULT_EXTRA_WIP_TYPES) {
    if (typeof n !== "string") continue;
    const code = wipTypeCode(n);
    if (code && !out[code]) out[code] = { label: n.trim(), color: EXTRA_COLOR };
  }
  return out;
}

// Which product types (BEDFRAME / SOFA / ACCESSORY) may use a WIP type, ticked
// in Maintenance and saved in variants-config.wipTypeProducts by type code. A
// code with no saved list is allowed for every product type.
export function wipTypeAllowed(code: string, category: string | undefined, saved: unknown): boolean {
  const list = (saved as Record<string, unknown> | null | undefined)?.[code];
  return !Array.isArray(list) || list.includes(bomProductType(category));
}

// Component-type badge label for a job-card sticker (HB / Divan / Base /
// Armrest / Cushion / Leg, or an extra type's own name such as Sandback), or
// null when the piece doesn't map to one (whole/full product, HEADREST,
// untyped/accessory). Reads the SAME normalized wipType the production grid
// produced (baserows-core.ts), with a case-insensitive wipName fallback for
// legs / un-typed bedframe rows. Shared by the printed 100x150mm Fab Cut/Sew
// sticker AND the on-screen QR Stickers preview tile so the two never drift.
// An extra type has to be named here or SB02's Sandback printed no badge at
// all (HK-0116).
export function componentBadgeLabel(
  s: { wipType?: string; wipName?: string },
  extraNames?: unknown,
): string | null {
  const wt = (s.wipType || "").toUpperCase();
  const wn = (s.wipName || "").toUpperCase();
  if (wt === "HB" || wt === "HEADBOARD") return "HB";
  if (wt === "DIVAN") return "Divan";
  if (wt === "BASE" || wt === "SOFA_BASE") return "Base";
  if (wt === "ARMREST" || wt === "SOFA_ARMREST") return "Armrest";
  if (wt === "CUSHION" || wt === "SOFA_CUSHION") return "Cushion";
  if (wt === "LEG") return "Leg";
  if (wt && !BUILT_IN_WIP_TYPES[wt]) {
    const extra = buildWipTypes(extraNames)[wt];
    if (extra) return extra.label;
  }
  if (/\bDIVAN\b/.test(wn)) return "Divan";
  if (/HEADBOARD|\bHB\b/.test(wn)) return "HB";
  if (/ARM\s?REST|ARMREST|\b(LEFT|RIGHT)\s+ARM\b/.test(wn)) return "Armrest";
  if (/CUSHION/.test(wn)) return "Cushion";
  if (/\bLEG\b/.test(wn)) return "Leg";
  if (/\bBASE\b/.test(wn)) return "Base";
  return null;
}
