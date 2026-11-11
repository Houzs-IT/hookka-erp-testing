import {
  breakBomIntoJobCardWips,
  l1ProcessesWithoutWipDupes,
  type BomVariantContext,
} from "./bom-wip-breakdown";

export type ProductionOrderRow = {
  id: string;
  salesOrderId: string | null;
  productCode: string | null;
  itemCategory: string | null;
  quantity: number;
  currentDepartment: string | null;
  targetEndDate: string | null;
  startDate: string | null;
  sizeCode: string | null;
  sizeLabel: string | null;
  fabricCode: string | null;
  gapInches: number | null;
  divanHeightInches: number | null;
  legHeightInches: number | null;
};

type L1Process = { deptCode: string; category: string; minutes: number };

// Mirror parseL1Processes from sales-orders.ts. Kept inline (not exported
// from sales-orders.ts) to preserve the "do not touch sales-orders.ts"
// constraint — the parser is small and stable.
function parseL1Processes(raw: string | null): L1Process[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => ({
        deptCode: String((p as { deptCode?: unknown }).deptCode ?? ""),
        category: String((p as { category?: unknown }).category ?? ""),
        minutes: Number((p as { minutes?: unknown }).minutes) || 0,
      }))
      .filter((p) => p.deptCode.length > 0);
  } catch {
    return [];
  }
}

// Build the full (wipKey, deptCode) → {wipCode, wipLabel, wipType, wipQty,
// estMinutes, category, sequence} map the BOM currently expects for one PO.
// Covers both the L2 WIP chain (breakBomIntoWips output) and the FG-level
// l1Processes (wipKey="FG").
export type ExpectedJc = {
  wipKey: string;
  wipCode: string;
  wipLabel: string;
  wipType: string;
  wipQty: number;
  deptCode: string;
  sequence: number;
  estMinutes: number;
  category: string;
  branchKey: string;
};

export function computeExpectedJcs(
  po: ProductionOrderRow,
  bomRow: {
    wipComponents: string | null;
    l1Processes: string | null;
    baseModel: string | null;
  } | null,
): ExpectedJc[] {
  const productCode = po.productCode ?? "";
  const variants: BomVariantContext = {
    productCode,
    // Parent model from bom_templates.baseModel — fall back to productCode
    // when BOM didn't store one (so {MODEL} keeps the legacy variant value
    // for those rows instead of going blank). See BUG-2026-04-27-004.
    model: bomRow?.baseModel ?? productCode,
    sizeLabel: po.sizeLabel ?? "",
    sizeCode: po.sizeCode ?? "",
    fabricCode: po.fabricCode ?? "",
    divanHeightInches: po.divanHeightInches ?? null,
    legHeightInches: po.legHeightInches ?? null,
    gapInches: po.gapInches ?? null,
  };
  // Same rules as the SO-confirm builder: an L1-only BOM gets an
  // auto-generated chain of its L1 steps, and an L1 step a WIP card already
  // covers gets no FG card (BUG-2026-10-01-244).
  const l1ProcsAll = parseL1Processes(bomRow?.l1Processes ?? null);
  const wips = breakBomIntoJobCardWips(
    bomRow?.wipComponents ?? null,
    l1ProcsAll,
    productCode,
    variants,
  );
  const expected: ExpectedJc[] = [];
  for (const wip of wips) {
    const wipQty = Math.max(
      1,
      Math.floor((po.quantity || 1) * wip.quantityMultiplier),
    );
    for (let i = 0; i < wip.processes.length; i++) {
      const p = wip.processes[i];
      expected.push({
        wipKey: wip.wipKey,
        wipCode: p.wipCode || wip.wipCode,
        wipLabel: p.wipLabel || wip.wipLabel,
        wipType: wip.wipType,
        wipQty,
        deptCode: p.deptCode,
        sequence: i,
        estMinutes: p.minutes,
        category: p.category,
        // BOM-walker stamped this on the process — no category/dept hardcode.
        branchKey: p.branchKey ?? "",
      });
    }
  }
  // FG-level l1Processes — single JC per process, wipKey="FG".
  for (const l1p of l1ProcessesWithoutWipDupes(l1ProcsAll, wips)) {
    expected.push({
      wipKey: "FG",
      wipCode: productCode,
      wipLabel: productCode,
      wipType: "FG",
      wipQty: po.quantity || 1,
      deptCode: l1p.deptCode,
      sequence: 99,
      estMinutes: l1p.minutes,
      category: l1p.category,
      // FG-level joint terminals (UPHOLSTERY, PACKING) live at root —
      // shared by every branch, so no specific branch identifier.
      branchKey: "",
    });
  }
  return expected;
}

// Load ACTIVE BOM; fall back to most-recent. Mirrors sales-orders.ts.
export async function loadBomTemplate(
  db: D1Database,
  productCode: string,
): Promise<{
  wipComponents: string | null;
  l1Processes: string | null;
  baseModel: string | null;
} | null> {
  if (!productCode) return null;
  type Row = {
    wipComponents: string | null;
    l1Processes: string | null;
    baseModel: string | null;
  };
  const active = await db
    .prepare(
      `SELECT wipComponents, l1Processes, baseModel FROM bom_templates
         WHERE productCode = ? AND versionStatus = 'ACTIVE'
         ORDER BY effectiveFrom DESC LIMIT 1`,
    )
    .bind(productCode)
    .first<Row>();
  if (active) return active;
  const latest = await db
    .prepare(
      `SELECT wipComponents, l1Processes, baseModel FROM bom_templates
         WHERE productCode = ? ORDER BY effectiveFrom DESC LIMIT 1`,
    )
    .bind(productCode)
    .first<Row>();
  return latest ?? null;
}
