// ---------------------------------------------------------------------------
// Shared Delivery Return creation.
//
// One place that writes a DR header + item snapshot, used by BOTH:
//   • the office route (routes/delivery-returns.ts — "New return" /
//     "Convert to Delivery Return"), and
//   • the public driver scan (routes/public-do-qr.ts — "Not received →
//     Delivery Return", where the whole DO's goods come back).
//
// Keeping it here means both paths produce an identical record and the DR
// numbering / snapshot logic never drifts between them. Deploy does NOT replay
// migration files, so the tables are self-applied at runtime here as well (see
// migrations-postgres/0207_delivery_returns.sql for the record copy).
// ---------------------------------------------------------------------------

export type DRCreateItem = {
  productionOrderId?: string;
  poNo?: string;
  productCode?: string;
  productName?: string;
  wipLabel?: string;
  quantity?: number;
  problem?: string;
  fgUnitId?: string;
  wasInvoiced?: boolean;
  // Rich snapshot so the DR (and the SV order it spawns) carries the SAME detail
  // as the source DO/SO — spec / variant / fabric / size + the SO reference.
  fabricCode?: string;
  sizeLabel?: string;
  specialOrder?: string;
  salesOrderNo?: string;
  /** The line's own SO refs — a DO can span several SOs, so the DO header's
   *  single customer PO can't identify a line (owner 2026-07-16). */
  customerPO?: string;
  customerSO?: string;
  reference?: string;
  /** buildSpec() inputs, so the DR PDF renders the SAME variant string as the
   *  DO/SO instead of a hand-rolled one (owner: "PDF 要根據全部 variant的"). */
  itemCategory?: string;
  divanHeightInches?: number | null;
  legHeightInches?: number | null;
  gapInches?: number | null;
};

let tablesEnsured = false;
export async function ensureDeliveryReturnTables(
  db: D1Database,
): Promise<void> {
  if (tablesEnsured) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS delivery_returns (
           id TEXT PRIMARY KEY, return_no TEXT NOT NULL,
           delivery_order_id TEXT, do_no TEXT, sales_order_id TEXT, company_so_id TEXT,
           customer_id TEXT, customer_name TEXT, customer_po_id TEXT,
           return_type TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
           service_case_id TEXT, service_order_id TEXT, credit_note_id TEXT,
           reason TEXT, notes TEXT, returned_at TEXT,
           created_at TEXT, updated_at TEXT, org_id TEXT )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS delivery_return_items (
           id TEXT PRIMARY KEY, delivery_return_id TEXT NOT NULL,
           production_order_id TEXT, po_no TEXT, product_code TEXT, product_name TEXT,
           wip_label TEXT, quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
           problem TEXT, disposition TEXT, fg_unit_id TEXT,
           was_invoiced INTEGER NOT NULL DEFAULT 0,
           fabric_code TEXT, size_label TEXT, special_order TEXT, sales_order_no TEXT,
           customer_po TEXT, reference TEXT )`,
      )
      .run();
    // Rich-snapshot columns for tables created before the enrichment (runtime
    // self-apply; deploy does not replay migration files).
    for (const col of [
      "fabric_code TEXT",
      "size_label TEXT",
      "special_order TEXT",
      "sales_order_no TEXT",
      // Owner 2026-07-16: two identical lines (e.g. the same bedframe twice)
      // are indistinguishable without their order refs — carry the SO's
      // customer PO + Reference per line, not just the DO header's single one.
      "customer_po TEXT",
      "customer_so TEXT",
      "reference TEXT",
      // buildSpec() inputs so the DR PDF prints the same variant as the DO/SO.
      "item_category TEXT",
      "divan_height_inches DOUBLE PRECISION",
      "leg_height_inches DOUBLE PRECISION",
      "gap_inches DOUBLE PRECISION",
    ]) {
      try {
        await db
          .prepare(
            `ALTER TABLE delivery_return_items ADD COLUMN IF NOT EXISTS ${col}`,
          )
          .run();
      } catch {
        /* column already exists / DDL transiently rejected */
      }
    }
    tablesEnsured = true;
  } catch (err) {
    console.warn(
      "[delivery-return-create] ensure tables:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function genDeliveryReturnId(): string {
  return `dr-${crypto.randomUUID().slice(0, 8)}`;
}
function genItemId(): string {
  return `dri-${crypto.randomUUID().slice(0, 8)}`;
}

// DR-YYMM-NNN, sequential within the current year-month.
export async function nextReturnNo(db: D1Database): Promise<string> {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `DR-${yy}${mm}-`;
  const row = await db
    .prepare(
      `SELECT return_no AS "returnNo" FROM delivery_returns
        WHERE return_no LIKE ? ORDER BY return_no DESC LIMIT 1`,
    )
    .bind(`${prefix}%`)
    .first<{ returnNo: string }>();
  let n = 1;
  if (row?.returnNo) {
    const tail = Number(row.returnNo.slice(prefix.length));
    if (Number.isFinite(tail)) n = tail + 1;
  }
  return `${prefix}${String(n).padStart(3, "0")}`;
}

// Load a DO's lines as DR items. Pass `onlyProductionOrderIds` to keep just the
// ticked subset (driver "Delivered with Issue" → only the returned lines);
// omit it to take every line on the DO.
export async function loadDoItemsForReturn(
  db: D1Database,
  doId: string,
  onlyProductionOrderIds?: Set<string>,
): Promise<DRCreateItem[]> {
  const res = await db
    .prepare(
      `SELECT productionOrderId AS "productionOrderId", poNo AS "poNo",
              productCode AS "productCode", productName AS "productName",
              sizeLabel AS "sizeLabel", fabricCode AS "fabricCode",
              specialOrder AS "specialOrder", salesOrderNo AS "salesOrderNo",
              quantity AS "quantity"
         FROM delivery_order_items WHERE deliveryOrderId = ?`,
    )
    .bind(doId)
    .all<{
      productionOrderId: string | null;
      poNo: string | null;
      productCode: string | null;
      productName: string | null;
      sizeLabel: string | null;
      fabricCode: string | null;
      specialOrder: string | null;
      salesOrderNo: string | null;
      quantity: number | null;
    }>();
  const items: DRCreateItem[] = (res.results ?? [])
    .filter(
      (r) =>
        !onlyProductionOrderIds ||
        (!!r.productionOrderId &&
          onlyProductionOrderIds.has(r.productionOrderId)),
    )
    .map((r) => ({
      productionOrderId: r.productionOrderId ?? "",
      poNo: r.poNo ?? "",
      productCode: r.productCode ?? "",
      productName: r.productName ?? "",
      sizeLabel: r.sizeLabel ?? "",
      fabricCode: r.fabricCode ?? "",
      specialOrder: r.specialOrder ?? "",
      salesOrderNo: r.salesOrderNo ?? "",
      quantity: Number(r.quantity ?? 1),
      customerPO: "",
      reference: "",
    }));

  await enrichItemsWithRefs(db, items);
  return items;
}

/**
 * Fill each line's OWN refs (customer PO / customer SO / Reference) and the
 * buildSpec inputs, by the DO's own print-extras join: production_orders → its
 * sales_order, keyed by productionOrderId (exact — the SO number is only a
 * label). The SERVER owns these: the office "New return" modal only knows what
 * the DO API gave it (which carries neither), and a client must never be able to
 * assert a line's order refs. Mutates in place; fails soft (a miss leaves
 * blanks rather than failing the return).
 */
export async function enrichItemsWithRefs(db: D1Database, items: DRCreateItem[]): Promise<void> {
  try {
    const poIds = [...new Set(items.map((i) => i.productionOrderId).filter(Boolean))] as string[];
    for (let i = 0; i < poIds.length; i += 400) {
      const chunk = poIds.slice(i, i + 400);
      const ph = chunk.map(() => "?").join(",");
      const r = await db
        .prepare(
          `SELECT po.id AS "poId", po.itemCategory AS "itemCategory",
                  po.gapInches AS "gapInches", po.divanHeightInches AS "divanHeightInches",
                  po.legHeightInches AS "legHeightInches",
                  poso.customerPOId AS "customerPOId", poso.customerSOId AS "customerSOId",
                  poso.reference AS "reference"
             FROM production_orders po
             LEFT JOIN sales_orders poso ON poso.id = po.salesOrderId
            WHERE po.id IN (${ph})`,
        )
        .bind(...chunk)
        .all<{
          poId: string;
          itemCategory: string | null;
          gapInches: number | null;
          divanHeightInches: number | null;
          legHeightInches: number | null;
          customerPOId: string | null;
          customerSOId: string | null;
          reference: string | null;
        }>();
      const by = new Map((r.results ?? []).map((x) => [x.poId, x]));
      for (const it of items) {
        const hit = by.get(it.productionOrderId ?? "");
        if (!hit) continue;
        it.itemCategory = hit.itemCategory ?? "";
        it.gapInches = hit.gapInches ?? null;
        it.divanHeightInches = hit.divanHeightInches ?? null;
        it.legHeightInches = hit.legHeightInches ?? null;
        it.customerPO = hit.customerPOId ?? "";
        it.customerSO = hit.customerSOId ?? "";
        it.reference = hit.reference ?? "";
      }
    }
  } catch (err) {
    console.warn("[delivery-return-create] line-ref/spec lookup failed:", err);
  }
}

/**
 * T-006 R7 / HK-0110 — a DO line can only come back once. Per production
 * order: everything already returned (non-cancelled) + this return must fit in
 * what the DO delivered. Both sides are SUMMED per production order — a DO can
 * carry the same production order on more than one line, and a Map built
 * straight from the rows kept only the last line's qty. Returns the error text,
 * or null when every line fits.
 */
export function findDeliveryReturnOverCap(
  doLines: Array<{ poId: string | null; quantity: number | null }>,
  priorReturns: Array<{ poId: string | null; qty: number | null }>,
  items: Array<{ productionOrderId?: string; quantity: number }>,
): string | null {
  const sum = <T>(rows: T[], key: (r: T) => string | null | undefined, qty: (r: T) => unknown) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + (Number(qty(r)) || 0));
    }
    return m;
  };
  const delivered = sum(doLines, (r) => r.poId, (r) => r.quantity);
  const prior = sum(priorReturns, (r) => r.poId, (r) => r.qty);
  for (const [poId, thisReturn] of sum(items, (r) => r.productionOrderId, (r) => r.quantity)) {
    const already = prior.get(poId) ?? 0;
    const cap = delivered.get(poId) ?? 0;
    if (already + thisReturn > cap) {
      return `Return exceeds what was delivered on this line: already returned ${already} + this return ${thisReturn} > delivered ${cap}.`;
    }
  }
  return null;
}

export type CreateDeliveryReturnResult =
  | { ok: true; id: string; returnNo: string }
  | { ok: false; error: string; status: 400 | 409 | 500 };

// Create a Delivery Return document from a DO + a set of returned lines.
// Header (SO / customer) is snapshotted from the source DO. BOTH lookups are
// best-effort (a missing/renamed column or an un-rewritten JOIN alias must NOT
// fail the create — the DR header + items still get written). Returns the new
// DR id + number, or the reason it was refused.
export async function createDeliveryReturnRecord(
  db: D1Database,
  orgId: string,
  input: {
    doId: string;
    items: DRCreateItem[];
    reason?: string;
    notes?: string;
  },
): Promise<CreateDeliveryReturnResult> {
  await ensureDeliveryReturnTables(db);
  const doId = String(input.doId ?? "").trim();
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!doId || rawItems.length === 0) {
    return { ok: false, status: 400, error: "A delivery order id and at least one item are required" };
  }
  // Read each line's quantity ONCE; the cap and the insert both use it. The
  // insert used to write a missing quantity as 1, and a negative one would
  // lower the "already returned" sum and make room for an over-return.
  const badQty = rawItems.find((it) => !(Number(it.quantity) > 0));
  if (badQty) {
    return {
      ok: false,
      status: 400,
      error: `Each returned line needs a quantity greater than 0 (${badQty.productCode || badQty.productionOrderId || "a line"} has ${badQty.quantity ?? "none"}).`,
    };
  }
  const items = rawItems.map((it) => ({ ...it, quantity: Number(it.quantity) }));
  // The refs are resolved HERE, not taken from the caller: the office modal
  // posts what the DO API gave it (which carries neither the line's customer PO
  // nor its Reference), and a client should not be able to assert them anyway.
  // Both entry points — office "New return" and the driver flow — land here, so
  // both records come out identical (owner 2026-07-16).
  await enrichItemsWithRefs(db, items);

  // T-006 R7 / HK-0110 — the cap is keyed by production order, so a line
  // without one would slip past it. Refuse such a line when the DO's own lines
  // carry production orders; a legacy DO with none has nothing to key on.
  const doLinesRes = await db
    .prepare(
      `SELECT productionOrderId AS "poId", quantity FROM delivery_order_items WHERE deliveryOrderId = ?`,
    )
    .bind(doId)
    .all<{ poId: string | null; quantity: number | null }>();
  const doLines = doLinesRes.results ?? [];
  if (items.some((it) => !it.productionOrderId) && doLines.some((l) => l.poId)) {
    return {
      ok: false,
      status: 400,
      error: "Each returned line must name the production order it came from on this delivery order.",
    };
  }
  const poIds = [...new Set(items.map((it) => it.productionOrderId).filter((v): v is string => !!v))];
  if (poIds.length) {
    const prior = await db
      .prepare(
        `SELECT dri.production_order_id AS "poId", COALESCE(SUM(dri.quantity), 0) AS qty
           FROM delivery_return_items dri
           JOIN delivery_returns dr ON dr.id = dri.delivery_return_id
          WHERE dr.delivery_order_id = ? AND dr.status <> 'CANCELLED'
          GROUP BY dri.production_order_id`,
      )
      .bind(doId)
      .all<{ poId: string | null; qty: number | null }>();
    const over = findDeliveryReturnOverCap(doLines, prior.results ?? [], items);
    if (over) return { ok: false, status: 409, error: over };
  }

  try {
    let doNo = "";
    let customerName = "";
    let customerPOId = "";
    try {
      const doRow = await db
        .prepare(
          `SELECT doNo AS "doNo", customerName AS "customerName" FROM delivery_orders WHERE id = ?`,
        )
        .bind(doId)
        .first<{ doNo: string | null; customerName: string | null }>();
      doNo = doRow?.doNo ?? "";
      customerName = doRow?.customerName ?? "";
    } catch (e) {
      console.warn(
        "[delivery-return-create] DO snapshot failed:",
        e instanceof Error ? e.message : e,
      );
    }

    let salesOrderId = "";
    let companySOId = "";
    let customerId = "";
    const firstPo = items.find((it) => it.productionOrderId);
    if (firstPo?.productionOrderId) {
      try {
        const soRow = await db
          .prepare(
            `SELECT so.id AS "soId", so.companySOId AS "companySOId",
                    so.customerId AS "customerId", so.customerPOId AS "customerPOId"
               FROM production_orders po
               JOIN sales_orders so ON so.id = po.salesOrderId
              WHERE po.id = ? LIMIT 1`,
          )
          .bind(firstPo.productionOrderId)
          .first<{
            soId: string;
            companySOId: string;
            customerId: string;
            customerPOId: string;
          }>();
        if (soRow) {
          salesOrderId = soRow.soId ?? "";
          companySOId = soRow.companySOId ?? "";
          customerId = soRow.customerId ?? "";
          customerPOId = soRow.customerPOId ?? "";
        }
      } catch (e) {
        console.warn(
          "[delivery-return-create] SO resolve failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    const id = genDeliveryReturnId();
    const returnNo = await nextReturnNo(db);
    const now = new Date().toISOString();

    // The cap read above and this write are separate round-trips, so two
    // returns raised at once could both pass it. The batch is one transaction:
    // take a per-DO lock first, then insert the header only if every line
    // still fits (re-measured under the lock), and each item only if its header
    // went in. A header that did not go in means a concurrent return won.
    const thisReturnByPo = new Map<string, number>();
    for (const it of items) {
      if (it.productionOrderId) {
        thisReturnByPo.set(it.productionOrderId, (thisReturnByPo.get(it.productionOrderId) ?? 0) + it.quantity);
      }
    }
    const capConds = [...thisReturnByPo.keys()].map(
      () => `(SELECT COALESCE(SUM(dri.quantity), 0)
                FROM delivery_return_items dri
                JOIN delivery_returns dr ON dr.id = dri.delivery_return_id
               WHERE dr.delivery_order_id = ? AND dr.status <> 'CANCELLED'
                 AND dri.production_order_id = ?) + CAST(? AS DOUBLE PRECISION)
             <= (SELECT COALESCE(SUM(doi.quantity), 0) FROM delivery_order_items doi
                  WHERE doi.deliveryOrderId = ? AND doi.productionOrderId = ?)`,
    );
    const capParams = [...thisReturnByPo].flatMap(([poId, qty]) => [doId, poId, qty, doId, poId]);
    const statements: D1PreparedStatement[] = [
      db
        .prepare(`SELECT pg_advisory_xact_lock(hashtext('delivery_return:' || ?)::bigint)`)
        .bind(doId),
      db
        .prepare(
          `INSERT INTO delivery_returns
             (id, return_no, delivery_order_id, do_no, sales_order_id, company_so_id,
              customer_id, customer_name, customer_po_id, return_type, status,
              reason, notes, returned_at, created_at, updated_at, org_id)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'OPEN', ?, ?, ?, ?, ?, ?
           ${capConds.length ? `WHERE ${capConds.join(" AND ")}` : ""}`,
        )
        .bind(
          id,
          returnNo,
          doId,
          doNo,
          salesOrderId,
          companySOId,
          customerId,
          customerName,
          customerPOId,
          String(input.reason ?? ""),
          String(input.notes ?? ""),
          now,
          now,
          now,
          orgId,
          ...capParams,
        ),
    ];
    for (const it of items) {
      statements.push(
        db
          .prepare(
            `INSERT INTO delivery_return_items
               (id, delivery_return_id, production_order_id, po_no, product_code,
                product_name, wip_label, quantity, problem, disposition, fg_unit_id, was_invoiced,
                fabric_code, size_label, special_order, sales_order_no,
                customer_po, customer_so, reference,
                item_category, divan_height_inches, leg_height_inches, gap_inches)
             SELECT ?, id, ?, ?, ?, ?, ?, CAST(? AS DOUBLE PRECISION), ?, NULL, ?, CAST(? AS INTEGER),
                    ?, ?, ?, ?, ?, ?, ?, ?,
                    CAST(? AS DOUBLE PRECISION), CAST(? AS DOUBLE PRECISION), CAST(? AS DOUBLE PRECISION)
               FROM delivery_returns WHERE id = ?`,
          )
          .bind(
            genItemId(),
            String(it.productionOrderId ?? ""),
            String(it.poNo ?? ""),
            String(it.productCode ?? ""),
            String(it.productName ?? ""),
            String(it.wipLabel ?? ""),
            it.quantity,
            String(it.problem ?? ""),
            String(it.fgUnitId ?? ""),
            it.wasInvoiced ? 1 : 0,
            String(it.fabricCode ?? ""),
            String(it.sizeLabel ?? ""),
            String(it.specialOrder ?? ""),
            String(it.salesOrderNo ?? ""),
            String(it.customerPO ?? ""),
            String(it.customerSO ?? ""),
            String(it.reference ?? ""),
            String(it.itemCategory ?? ""),
            it.divanHeightInches ?? null,
            it.legHeightInches ?? null,
            it.gapInches ?? null,
            id,
          ),
      );
    }
    const res = await db.batch(statements);
    if (!(Number(res[1]?.meta?.changes) > 0)) {
      return {
        ok: false,
        status: 409,
        error: "Another return was raised on this delivery order at the same time and these lines no longer fit. Reload and check what is left to return.",
      };
    }
    return { ok: true, id, returnNo };
  } catch (err) {
    console.error("[delivery-return-create] create failed:", err);
    return { ok: false, status: 500, error: "Failed to create delivery return" };
  }
}
