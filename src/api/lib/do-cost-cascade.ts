// ---------------------------------------------------------------------------
// do-cost-cascade.ts — Delivery Order cost cascade (phase-4).
//
// Mirrors po-cost-cascade.ts but for the DELIVERY side. When a DO moves to
// DELIVERED, we need to FIFO-consume fg_batches (oldest completedDate first)
// against each DO line item, deducting qty across layers and emitting one
// FG_DELIVERED cost_ledger entry per layer slice with unitCostSen × qtySlice
// as totalCostSen.
//
// SCHEMA NOTE
//   cost_ledger.type CHECK includes 'FG_DELIVERED'. refType for the per-slice
//   ledger rows is 'DELIVERY_ORDER', refId is the DO id. direction='OUT',
//   itemType='FG', itemId=fg_batches.productId, batchId=fg_batches.id.
//
// IDEMPOTENCY
//   Caller (or the helper itself) checks if any cost_ledger row exists with
//   refType='DELIVERY_ORDER' AND refId=<doId> AND type='FG_DELIVERED'. If yes,
//   the helper returns skipped=true and an empty statements list.
//
// RETURN SHAPE
//   { skipped, statements, totalCogsSen, shortages }
//     * statements: D1PreparedStatement[] to append to the existing DELIVERED
//       batch so everything rolls back together if the outer UPDATE fails.
//     * totalCogsSen: sum of every slice's totalCostSen (for observability).
//     * shortages: DO lines where we couldn't fully satisfy from fg_batches
//       (non-fatal — we consume what's available and log the rest).
// ---------------------------------------------------------------------------

type FgBatchRow = {
  id: string;
  productId: string;
  productionOrderId: string | null;
  completedDate: string;
  originalQty: number;
  remainingQty: number;
  unitCostSen: number;
};

export type DeliveryOrderItemForCogs = {
  id: string;
  productCode: string | null;
  productName: string | null;
  quantity: number;
};

export type FGDeliveredShortage = {
  itemId: string;
  productCode: string;
  shortageQty: number;
};

function genLedgerId(prefix: string): string {
  return `cl-${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

type DeliveredSlice = {
  itemId: string;
  batchId: string | null;
  qty: number;
  unitCostSen: number;
};

// ---------------------------------------------------------------------------
// The FG_DELIVERED slices this DO still holds, newest first. A DO can be
// delivered, reversed to Dispatched and delivered again (HK-0111), so its
// original FG_DELIVERED rows outlive their consumption: each reversal appends
// DELIVERY_ORDER_UNDELIVER rows that hand those slices back. Every reader that
// replays a DO's consumption must read it net of them, or a reversed delivery
// is credited (or skipped) twice.
// ---------------------------------------------------------------------------
async function liveDeliveredSlices(
  db: D1Database,
  doId: string,
): Promise<DeliveredSlice[]> {
  const [deliveredRes, undeliveredRes] = await Promise.all([
    db
      .prepare(
        `SELECT itemId AS "itemId", batchId AS "batchId", qty AS "qty",
                unitCostSen AS "unitCostSen"
           FROM cost_ledger
          WHERE refType = 'DELIVERY_ORDER' AND refId = ? AND type = 'FG_DELIVERED'
          ORDER BY date DESC, id DESC`,
      )
      .bind(doId)
      .all<DeliveredSlice>(),
    db
      .prepare(
        `SELECT itemId AS "itemId", batchId AS "batchId", qty AS "qty"
           FROM cost_ledger
          WHERE refType = 'DELIVERY_ORDER_UNDELIVER' AND refId = ?`,
      )
      .bind(doId)
      .all<{ itemId: string; batchId: string | null; qty: number }>(),
  ]);
  const key = (itemId: string, batchId: string | null) => `${itemId}|${batchId ?? ""}`;
  const handedBack = new Map<string, number>();
  for (const r of undeliveredRes.results ?? []) {
    const k = key(r.itemId, r.batchId);
    handedBack.set(k, (handedBack.get(k) ?? 0) + (Number(r.qty) || 0));
  }
  const live: DeliveredSlice[] = [];
  for (const s of deliveredRes.results ?? []) {
    const k = key(s.itemId, s.batchId);
    const qty = Number(s.qty) || 0;
    const offset = Math.min(qty, handedBack.get(k) ?? 0);
    if (offset > 0) handedBack.set(k, (handedBack.get(k) ?? 0) - offset);
    if (qty - offset > 0) live.push({ ...s, qty: qty - offset });
  }
  return live;
}

// ---------------------------------------------------------------------------
// Main entry point. Returns statements to append to the caller's existing
// batch — we don't call db.batch() ourselves so the outer DELIVERED flow
// (UPDATE delivery_orders + fg_units + SO cascade + auto-invoice) stays
// atomic.
// ---------------------------------------------------------------------------
export async function consumeFGBatchesForDO(
  db: D1Database,
  doId: string,
  doNo: string,
  items: DeliveryOrderItemForCogs[],
  deliveredAtIso: string,
): Promise<{
  skipped: boolean;
  statements: D1PreparedStatement[];
  totalCogsSen: number;
  shortages: FGDeliveredShortage[];
}> {
  // Idempotency — this DO already holds FG_DELIVERED consumption? Net of
  // Reverse to Dispatched (HK-0111): a reversed delivery holds none, so its
  // re-delivery consumes again for the corrected lines.
  if ((await liveDeliveredSlices(db, doId)).length > 0) {
    return { skipped: true, statements: [], totalCogsSen: 0, shortages: [] };
  }

  const statements: D1PreparedStatement[] = [];
  let totalCogsSen = 0;
  const shortages: FGDeliveredShortage[] = [];

  for (const item of items) {
    const need = Number(item.quantity) || 0;
    if (need <= 0) continue;
    const productCode = item.productCode ?? "";
    if (!productCode) {
      shortages.push({ itemId: item.id, productCode: "", shortageQty: need });
      continue;
    }

    // Resolve productId by product code. fg_batches keys on productId.
    // NOTE: the products table column is `code`, NOT `productCode`.
    // Using `productCode` here made the SupabaseAdapter rename map
    // rewrite it to `product_code` (its global mapping), and
    // `products` has no such column → "column product_code does not
    // exist", failing every DO → DELIVERED cascade. Mirrors the
    // working sibling query in lib/fg-completion.ts:77.
    const product = await db
      .prepare("SELECT id FROM products WHERE code = ? LIMIT 1")
      .bind(productCode)
      .first<{ id: string }>();
    if (!product) {
      shortages.push({ itemId: item.id, productCode, shortageQty: need });
      continue;
    }

    // FIFO — oldest completedDate first, then oldest id as tiebreaker.
    const batchesRes = await db
      .prepare(
        `SELECT id, productId, productionOrderId, completedDate, originalQty,
                remainingQty, unitCostSen
           FROM fg_batches
          WHERE productId = ? AND remainingQty > 0
          ORDER BY completedDate ASC, id ASC`,
      )
      .bind(product.id)
      .all<FgBatchRow>();
    const batches = batchesRes.results ?? [];

    let remaining = need;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.remainingQty, remaining);
      if (take <= 0) continue;
      const sliceCostSen = batch.unitCostSen * take;
      totalCogsSen += sliceCostSen;
      remaining -= take;

      statements.push(
        db
          .prepare(
            "UPDATE fg_batches SET remainingQty = remainingQty - ? WHERE id = ?",
          )
          .bind(take, batch.id),
        db
          .prepare(
            `INSERT INTO cost_ledger
               (id, date, type, itemType, itemId, batchId, qty, direction,
                unitCostSen, totalCostSen, refType, refId, notes)
             VALUES (?, ?, 'FG_DELIVERED', 'FG', ?, ?, ?, 'OUT', ?, ?, 'DELIVERY_ORDER', ?, ?)`,
          )
          .bind(
            genLedgerId("fgd"),
            deliveredAtIso,
            batch.productId,
            batch.id,
            take,
            batch.unitCostSen,
            sliceCostSen,
            doId,
            `FG delivered for ${doNo} (${productCode})`,
          ),
      );
    }

    if (remaining > 0) {
      shortages.push({
        itemId: item.id,
        productCode,
        shortageQty: remaining,
      });
    }
  }

  return { skipped: false, statements, totalCogsSen, shortages };
}

// ---------------------------------------------------------------------------
// REVERSE — when goods come back on a Delivery Return, undo the COGS + FG
// consumption for the returned lines. For each returned line we find the
// original FG_DELIVERED slices for its DO + product, add the returned qty back
// to those fg_batches (LIFO across the slices), and write a reversing
// ADJUSTMENT (direction IN) cost_ledger row per slice — refType='DELIVERY_RETURN'
// so it's idempotent + traceable. Net effect: FG inventory qty + value restored,
// COGS reduced. Returns statements to append to the caller's batch.
// ---------------------------------------------------------------------------
export type DeliveryReturnLineForCogs = {
  productCode: string | null;
  quantity: number;
};
export async function reverseFGForDeliveryReturn(
  db: D1Database,
  drId: string,
  doId: string,
  lines: DeliveryReturnLineForCogs[],
  reversedAtIso: string,
): Promise<{ skipped: boolean; statements: D1PreparedStatement[]; reversedCogsSen: number }> {
  // Idempotency — already reversed for this Delivery Return?
  const existing = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM cost_ledger WHERE refType = 'DELIVERY_RETURN' AND refId = ?",
    )
    .bind(drId)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    return { skipped: true, statements: [], reversedCogsSen: 0 };
  }

  const statements: D1PreparedStatement[] = [];
  let reversedCogsSen = 0;

  for (const line of lines) {
    let toReverse = Number(line.quantity) || 0;
    if (toReverse <= 0) continue;
    const productCode = line.productCode ?? "";
    if (!productCode) continue;
    const product = await db
      .prepare("SELECT id FROM products WHERE code = ? LIMIT 1")
      .bind(productCode)
      .first<{ id: string }>();
    if (!product) continue;

    // The FG_DELIVERED slices this DO consumed for this product (newest first
    // so a return unwinds the most recent consumption).
    const slices = (await liveDeliveredSlices(db, doId)).filter(
      (s) => s.itemId === product.id,
    );

    for (const s of slices) {
      if (toReverse <= 0) break;
      const take = Math.min(Number(s.qty) || 0, toReverse);
      if (take <= 0) continue;
      const unitSen = Number(s.unitCostSen) || 0;
      const costSen = Math.round(unitSen * take);
      reversedCogsSen += costSen;
      toReverse -= take;
      statements.push(
        db
          .prepare("UPDATE fg_batches SET remainingQty = remainingQty + ? WHERE id = ?")
          .bind(take, s.batchId),
        db
          .prepare(
            `INSERT INTO cost_ledger
               (id, date, type, itemType, itemId, batchId, qty, direction,
                unitCostSen, totalCostSen, refType, refId, notes)
             VALUES (?, ?, 'ADJUSTMENT', 'FG', ?, ?, ?, 'IN', ?, ?, 'DELIVERY_RETURN', ?, ?)`,
          )
          .bind(
            genLedgerId("fgr"),
            reversedAtIso,
            product.id,
            s.batchId,
            take,
            unitSen,
            costSen,
            drId,
            `FG returned via ${drId} (${productCode})`,
          ),
      );
    }
  }

  return { skipped: false, statements, reversedCogsSen };
}

// ---------------------------------------------------------------------------
// UNDO a return-to-stock (HK-0110) — cancelling a RETURNED_TO_STOCK Delivery
// Return takes back exactly what reverseFGForDeliveryReturn credited. Driven by
// that return's OWN ledger rows (refType='DELIVERY_RETURN', refId=drId), the
// same row-for-row replay reverseFGForDoCancel uses: each row's qty comes back
// OFF the batch it went onto, with a counter ADJUSTMENT (OUT) at the same unit
// cost, refType='DELIVERY_RETURN_UNDO'. Refused (nothing written) when it has
// already run, or when a batch no longer holds what the return put on it (the
// goods were sold or used since) — it would go negative.
// ---------------------------------------------------------------------------
export async function undoFGForDeliveryReturn(
  db: D1Database,
  drId: string,
  undoneAtIso: string,
): Promise<
  | { ok: true; statements: D1PreparedStatement[]; batchIds: string[]; undoneCogsSen: number }
  | { ok: false; error: string }
> {
  const done = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM cost_ledger WHERE refType = 'DELIVERY_RETURN_UNDO' AND refId = ?",
    )
    .bind(drId)
    .first<{ n: number }>();
  if ((done?.n ?? 0) > 0) {
    return { ok: false, error: "This return's stock credit has already been undone." };
  }
  const rowsRes = await db
    .prepare(
      `SELECT itemId AS "itemId", batchId AS "batchId", qty AS "qty",
              unitCostSen AS "unitCostSen"
         FROM cost_ledger
        WHERE refType = 'DELIVERY_RETURN' AND refId = ?`,
    )
    .bind(drId)
    .all<{ itemId: string; batchId: string | null; qty: number; unitCostSen: number }>();
  const rows = (rowsRes.results ?? []).filter((r) => (Number(r.qty) || 0) > 0);

  const needByBatch = new Map<string, number>();
  for (const r of rows) {
    if (r.batchId) needByBatch.set(r.batchId, (needByBatch.get(r.batchId) ?? 0) + Number(r.qty));
  }
  const batchIds = [...needByBatch.keys()];
  if (batchIds.length) {
    const ph = batchIds.map(() => "?").join(",");
    const held = await db
      .prepare(`SELECT id, remainingQty AS "remainingQty" FROM fg_batches WHERE id IN (${ph})`)
      .bind(...batchIds)
      .all<{ id: string; remainingQty: number }>();
    const heldBy = new Map((held.results ?? []).map((b) => [b.id, Number(b.remainingQty) || 0]));
    for (const [batchId, need] of needByBatch) {
      const have = heldBy.get(batchId) ?? 0;
      if (have < need) {
        return {
          ok: false,
          error: `Cannot undo: FG batch ${batchId} holds ${have} but this return put ${need} on it — the returned goods were sold or used since. Fix the stock with a stock adjustment instead.`,
        };
      }
    }
  }

  const statements: D1PreparedStatement[] = [];
  let undoneCogsSen = 0;
  for (const r of rows) {
    const qty = Number(r.qty);
    const unitSen = Number(r.unitCostSen) || 0;
    const costSen = Math.round(unitSen * qty);
    undoneCogsSen += costSen;
    if (r.batchId) {
      statements.push(
        db
          .prepare("UPDATE fg_batches SET remainingQty = remainingQty - ? WHERE id = ?")
          .bind(qty, r.batchId),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO cost_ledger
             (id, date, type, itemType, itemId, batchId, qty, direction,
              unitCostSen, totalCostSen, refType, refId, notes)
           VALUES (?, ?, 'ADJUSTMENT', 'FG', ?, ?, ?, 'OUT', ?, ?, 'DELIVERY_RETURN_UNDO', ?, ?)`,
        )
        .bind(
          genLedgerId("fgu"),
          undoneAtIso,
          r.itemId,
          r.batchId,
          qty,
          unitSen,
          costSen,
          drId,
          `Return to stock undone — ${drId} cancelled`,
        ),
    );
  }
  return { ok: true, statements, batchIds, undoneCogsSen };
}

// ---------------------------------------------------------------------------
// REVERSE (whole document) — when a DELIVERED delivery order is CANCELLED, the
// goods never left in the eyes of the book: every FG_DELIVERED slice this DO
// consumed must be handed back to its fg_batches layer and the COGS undone.
//
// Same shape as reverseFGForDeliveryReturn above, but driven by the LEDGER
// rather than by a line list: we replay this DO's own FG_DELIVERED rows and
// give back exactly what each one took, from exactly the batch it took it
// from. Nothing is recomputed, so a price/BOM change since delivery cannot
// make the reversal disagree with the original consumption — the pairing is
// row-for-row.
//
// Idempotent via refType='DELIVERY_ORDER_CANCEL' + refId=<doId>: a second
// cancel attempt (retry, concurrent click) finds its own marker and no-ops.
//
// IMPORTANT — this helper assumes it is reversing the WHOLE consumption. If
// some of it was already handed back by a Delivery Return
// (refType='DELIVERY_RETURN'), replaying the FG_DELIVERED rows in full would
// credit those quantities TWICE. The caller must refuse the cancel in that
// case rather than call this (see buildDoCancelReleaseStatements).
// ---------------------------------------------------------------------------
export async function reverseFGForDoCancel(
  db: D1Database,
  doId: string,
  doNo: string,
  reversedAtIso: string,
): Promise<{
  skipped: boolean;
  statements: D1PreparedStatement[];
  reversedCogsSen: number;
}> {
  const existing = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM cost_ledger WHERE refType = 'DELIVERY_ORDER_CANCEL' AND refId = ?",
    )
    .bind(doId)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    return { skipped: true, statements: [], reversedCogsSen: 0 };
  }

  return {
    skipped: false,
    ...(await handBackDeliveredSlices(
      db,
      doId,
      "DELIVERY_ORDER_CANCEL",
      "fgc",
      `FG un-delivered — ${doNo} cancelled`,
      reversedAtIso,
    )),
  };
}

// ---------------------------------------------------------------------------
// REVERSE TO DISPATCHED (HK-0111) — a delivery marked DELIVERED by mistake (some
// pieces never reached the customer) steps back to LOADED so its lines can be
// corrected and delivered again under the same DO number. Same give-back as the
// cancel above, but repeatable: the DO stays live, may be delivered and
// reversed again, so there is no once-only marker. liveDeliveredSlices nets
// earlier reversals off, which also makes a retry a no-op.
// ---------------------------------------------------------------------------
export async function reverseFGForDoUndeliver(
  db: D1Database,
  doId: string,
  doNo: string,
  reversedAtIso: string,
): Promise<{ statements: D1PreparedStatement[]; reversedCogsSen: number }> {
  return handBackDeliveredSlices(
    db,
    doId,
    "DELIVERY_ORDER_UNDELIVER",
    "fgu",
    `FG un-delivered — ${doNo} reversed to dispatched`,
    reversedAtIso,
  );
}

async function handBackDeliveredSlices(
  db: D1Database,
  doId: string,
  refType: "DELIVERY_ORDER_CANCEL" | "DELIVERY_ORDER_UNDELIVER",
  idPrefix: string,
  note: string,
  reversedAtIso: string,
): Promise<{ statements: D1PreparedStatement[]; reversedCogsSen: number }> {
  const statements: D1PreparedStatement[] = [];
  let reversedCogsSen = 0;
  for (const s of await liveDeliveredSlices(db, doId)) {
    const qty = Number(s.qty) || 0;
    if (qty <= 0) continue;
    const unitSen = Number(s.unitCostSen) || 0;
    const costSen = Math.round(unitSen * qty);
    reversedCogsSen += costSen;
    if (s.batchId) {
      statements.push(
        db
          .prepare(
            "UPDATE fg_batches SET remainingQty = remainingQty + ? WHERE id = ?",
          )
          .bind(qty, s.batchId),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO cost_ledger
             (id, date, type, itemType, itemId, batchId, qty, direction,
              unitCostSen, totalCostSen, refType, refId, notes)
           VALUES (?, ?, 'ADJUSTMENT', 'FG', ?, ?, ?, 'IN', ?, ?, ?, ?, ?)`,
        )
        .bind(
          genLedgerId(idPrefix),
          reversedAtIso,
          s.itemId,
          s.batchId,
          qty,
          unitSen,
          costSen,
          refType,
          doId,
          note,
        ),
    );
  }
  return { statements, reversedCogsSen };
}
