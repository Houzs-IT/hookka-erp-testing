// Pure helpers for a BOM material line, shared by the BOM Builder and the
// product costing editor (plan D8). Components live in
// src/components/bom/material-editor.tsx.
import type { MaterialScaling } from "@/api/lib/material-scaling";

export type RawMaterialOption = {
  id: string;
  itemCode: string;
  description: string;
  baseUOM: string;
  itemGroup: string;
};

/** The fields of a BOM material line this editor touches. */
export type WIPMaterial = {
  code: string;
  name: string;
  qty: number;
  unit: string;
  wastePct?: number;
  inventoryCode?: string;
  autoDetect?: "FABRIC" | "LEG";
  scaling?: MaterialScaling[];
  cutLengthIn?: number;
  cutWidthIn?: number;
};

// Patch applied to a WIPMaterial when the user picks "from SO" in the picker.
// Clears any concrete inventory link, sets the autoDetect kind, and seeds a
// sensible default UOM (fabric is sold by metre, legs by piece).
export function autoDetectMaterialPatch(kind: "FABRIC" | "LEG"): Partial<WIPMaterial> {
  return {
    autoDetect: kind,
    code: "",
    inventoryCode: "",
    name: kind === "FABRIC" ? "Fabric (from order)" : "Leg (from order)",
    unit: kind === "FABRIC" ? "MTR" : "PCS",
  };
}

// Accept both the new array shape AND legacy single-object data still
// living in saved bom_versions.tree blobs. Returns a fresh array safe
// to mutate.
export function normaliseScaling(
  scaling: MaterialScaling | MaterialScaling[] | undefined,
): MaterialScaling[] {
  if (!scaling) return [];
  if (Array.isArray(scaling)) return scaling.slice();
  // Legacy single-object → 1-element array.
  return [scaling];
}
