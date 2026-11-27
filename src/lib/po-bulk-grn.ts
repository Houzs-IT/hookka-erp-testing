// ---------------------------------------------------------------------------
// po-bulk-grn.ts — what a bulk "Convert N to GRN" will receive (BUG-2026-11-27-592).
//
// The bulk action creates one GRN per PO for every line's OUTSTANDING quantity
// (ordered − already received) and posts it straight to stock. There is no
// arrival / QC step in between, so the operator must see exactly what will be
// posted before anything happens. This one plan feeds BOTH the confirmation
// dialog and the POST /api/grn bodies, so what is shown is what is sent.
//
// Fully received lines are skipped, so a PARTIAL_RECEIVED top-up stays inside
// the 110% over-receipt guard.
// ---------------------------------------------------------------------------

export type BulkGrnPoInput = {
  id: string;
  poNo: string;
  supplierName?: string | null;
  items: Array<{
    materialCode?: string | null;
    materialName?: string | null;
    quantity: number;
    receivedQty?: number | null;
    unit?: string | null;
  }>;
};

export type BulkGrnLine = {
  poItemIndex: number;
  materialCode: string;
  materialName: string;
  unit: string;
  ordered: number;
  alreadyReceived: number;
  /** What this GRN receives, accepts and posts to stock. */
  receive: number;
};

export type BulkGrnPlanPo = {
  poId: string;
  poNo: string;
  supplierName: string;
  lines: BulkGrnLine[];
};

/** One entry per PO that has something outstanding, lines in PO order. */
export function buildBulkGrnPlan(pos: BulkGrnPoInput[]): BulkGrnPlanPo[] {
  const plan: BulkGrnPlanPo[] = [];
  for (const po of pos) {
    const lines: BulkGrnLine[] = [];
    (po.items ?? []).forEach((it, idx) => {
      const ordered = Number(it.quantity) || 0;
      const alreadyReceived = Number(it.receivedQty) || 0;
      const receive = Math.max(0, ordered - alreadyReceived);
      if (receive <= 0) return;
      lines.push({
        poItemIndex: idx,
        materialCode: String(it.materialCode ?? ""),
        materialName: String(it.materialName ?? ""),
        unit: String(it.unit ?? ""),
        ordered,
        alreadyReceived,
        receive,
      });
    });
    if (lines.length === 0) continue;
    plan.push({ poId: po.id, poNo: po.poNo, supplierName: String(po.supplierName ?? ""), lines });
  }
  return plan;
}

/** The POST /api/grn `items` for one planned PO: full receipt, all accepted. */
export function bulkGrnItems(p: BulkGrnPlanPo) {
  return p.lines.map((l) => ({
    poItemIndex: l.poItemIndex,
    receivedQty: l.receive,
    acceptedQty: l.receive,
    rejectedQty: 0,
    rejectionReason: null,
  }));
}
