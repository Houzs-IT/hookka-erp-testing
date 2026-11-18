import {
  deriveBarcodeToken,
  deptOfBarcodeToken,
  isBarcodeToken,
} from "../../lib/job-card-id";

export type PoMatch = {
  productionOrderId: string;
  productName: string;
  poNo: string | null;
  // The Sales Order number this PO traces back to (production_orders.salesOrderNo),
  // and a human description (productName + size). Both flow to the scan page so a
  // piece shows e.g. "1013 King Size Headboard" + "SO 250114".
  salesOrderNo: string | null;
  description: string;
  // The id of the SPECIFIC job_card this scan resolved to, when it was resolved
  // through a card (the PACKING-sentinel path below, or a job-card-id sticker).
  // null for a PO-level match that carries no single card. The scan page threads
  // this back into stock-in so the stamp hits EXACTLY that card's rackingNumber
  // (a bedframe PO has one PACKING card per compartment — Divan vs Headboard —
  // and only the resolved id picks the right one).
  jobCardId: string | null;
};

// Columns selected for every PoMatch lookup — id + the human + document fields
// the per-piece scan card needs (description = productName + size, plus the SO).
export type PoRow = {
  id: string;
  poNo: string | null;
  productName: string | null;
  productCode: string | null;
  sizeLabel: string | null;
  salesOrderNo: string | null;
  // Only present when resolved through a job_card (paths 2 & 3). This is the
  // exact WIP label the production / packing sheet prints, e.g. "5530-2A(RHF)"
  // or '8" Divan- 6FT Frame'.
  wipLabel?: string | null;
};
export const PO_COLS = "id, poNo, productName, productCode, sizeLabel, salesOrderNo";

// Resolve a scanned/typed term to its production order, mirroring the worker
// scan-lookup chain (routes/worker.ts GET /scan-lookup): exact poNo / PO id
// first, then a job-card id, then a SHORT Code 128 schedule token re-derived
// across that department's cards. Returns null when nothing matches.
export async function resolvePo(
  db: D1Database,
  term: string,
  // The job_card this match was resolved through (paths 2 & 3 below carry one).
  // Threaded into the response as `jobCardId` so stock-in can stamp the EXACT
  // card. null for a bare PO-level match (path 1).
  jobCardId: string | null = null,
): Promise<PoMatch | null> {
  const toMatch = (r: PoRow): PoMatch => {
    const name = (r.productName || r.productCode || r.poNo || "").trim();
    const size = (r.sizeLabel || "").trim();
    const wip = (r.wipLabel || "").trim();
    // Prefer the job_card's WIP label — exactly what the production / packing
    // sheet prints (e.g. "5530-2A(RHF)", '8" Divan- 6FT Frame'), because the
    // rack holds WIP heading into packing, so a racked piece must read as its
    // WIP, not a spelled-out product name (owner 2026-06-17). Falls back to
    // productName + size for a PO-level match that carries no specific piece.
    const description = wip || (size ? `${name} ${size}`.trim() : name);
    return {
      productionOrderId: r.id,
      productName: name,
      poNo: r.poNo ?? null,
      salesOrderNo: (r.salesOrderNo || "").trim() || null,
      description,
      jobCardId,
    };
  };

  // 1) PO number / PO id (exact — the sticker encodes the stored poNo verbatim).
  let row = await db
    .prepare(
      `SELECT ${PO_COLS}
         FROM production_orders WHERE poNo = ? OR id = ? LIMIT 1`,
    )
    .bind(term, term)
    .first<PoRow>();
  if (row) return toMatch(row);

  // 2) Job-card id (other-dept per-piece stickers encode the jc id in op=).
  // Pull the card's wipLabel so the racked piece reads as its WIP.
  row = await db
    .prepare(
      `SELECT po.id AS id, po.poNo AS poNo, po.productName AS productName,
              po.productCode AS productCode, po.sizeLabel AS sizeLabel,
              po.salesOrderNo AS salesOrderNo, jc.wipLabel AS wipLabel
         FROM production_orders po
         JOIN job_cards jc ON jc.productionOrderId = po.id
        WHERE jc.id = ? LIMIT 1`,
    )
    .bind(term)
    .first<PoRow>();
  // The job-card-id sticker IS this card, so stamp it by id: term is the jc id.
  if (row) return { ...toMatch(row), jobCardId: term };

  // 3) SHORT schedule Code 128 token (b<deptNN><hash>) — not a stored id;
  // re-derive deriveBarcodeToken across EVERY card in the token's department
  // (the leading 2 digits) and match. Bounded by one dept's cards; works for
  // new + old cards with no id rewrite. try/catch keeps any hiccup graceful.
  if (isBarcodeToken(term)) {
    const deptCode = deptOfBarcodeToken(term);
    if (deptCode) {
      try {
        const cand =
          (
            await db
              .prepare(
                `SELECT id, productionOrderId, departmentCode, wipLabel
                   FROM job_cards WHERE departmentCode = ?`,
              )
              .bind(deptCode)
              .all<{
                id: string;
                productionOrderId: string;
                departmentCode: string | null;
                wipLabel: string | null;
              }>()
          ).results ?? [];
        // BUG-2026-08-13-146, second site. Same non-unique key, and here the
        // resolved card id is STAMPED onto a stock-in (`jobCardId: hit.id`), so
        // a collision files someone else's piece into the rack. Exactly one
        // claimant or nothing — see the twin in `worker.ts`.
        const tokenHits = cand.filter(
          (j) =>
            deriveBarcodeToken(j.id, j.departmentCode ?? deptCode) === term,
        );
        if (tokenHits.length > 1) {
          console.warn(
            "[public-rack-qr] barcode token is ambiguous — refusing to guess:",
            { term, count: tokenHits.length },
          );
        }
        const hit = tokenHits.length === 1 ? tokenHits[0] : undefined;
        if (hit) {
          row = await db
            .prepare(
              `SELECT ${PO_COLS}
                 FROM production_orders WHERE id = ? LIMIT 1`,
            )
            .bind(hit.productionOrderId)
            .first<PoRow>();
          // Carry the matched card's WIP label so the piece reads as its WIP,
          // and its id so stock-in stamps that exact card.
          if (row)
            return { ...toMatch({ ...row, wipLabel: hit.wipLabel }), jobCardId: hit.id };
        }
      } catch (e) {
        console.warn("[public-rack-qr] barcode-token resolve failed:", e);
      }
    }
  }
  return null;
}
