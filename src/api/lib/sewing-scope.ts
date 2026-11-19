import { freshFirst } from "./worker-penalties";

export interface SewingScope {
  productionOrderId: string;
  wipKey: string | null;
  pieceNo: number | null;
}

export async function resolveSewingScope(
  db: D1Database,
  request: { productionOrderId: string; wipKey?: string; pieceNo?: number },
): Promise<SewingScope> {
  let wipKey = request.wipKey;
  let pieceNo = request.pieceNo;
  // SOFA exception: a sofa BASE compartment represents the WHOLE variant — its
  // base, cushions and armrests are sewn together by one worker (Wei Siang
  // 2026-06-07: scan 1A → 1A's base + armrest + back-cushion complete together).
  // The base sticker carries the base's own wipKey so the PHONE resolves it to a
  // single card (no Divan-vs-HB-style chooser), but COMPLETION must fan out to
  // every FAB_SEW / UPHOLSTERY card of the variant. Detect a sofa compartment by
  // its wipType (SOFA_BASE / SOFA_CUSHION / SOFA_ARMREST / SOFA_HEADREST) and drop
  // the per-compartment + per-piece scoping so the whole-dept fan-out runs.
  // Bedframe pieces (DIVAN / HEADBOARD) are NOT SOFA_* — they keep per-piece
  // scoping and stay separately scannable.
  if (wipKey) {
    const wkProbe = await freshFirst<{ wipType: string | null }>(
      db,
      db
        .prepare(
          "SELECT wipType FROM job_cards WHERE productionOrderId = ? AND wipKey = ? LIMIT 1",
        )
        .bind(request.productionOrderId, wipKey),
    );
    if ((wkProbe?.wipType || "").toUpperCase().startsWith("SOFA_")) {
      wipKey = undefined;
      pieceNo = undefined;
    }
  }
  return {
    productionOrderId: request.productionOrderId,
    wipKey: wipKey ?? null,
    pieceNo: pieceNo ?? null,
  };
}
