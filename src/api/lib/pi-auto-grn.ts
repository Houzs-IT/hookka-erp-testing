// PI auto stock-in (owner 2026-10-27「po pi 如果 scan 了 match 了就自动 stock in」).
//
// The office bills straight from the PO and never posts a GRN, so since April
// 2026 nothing billed reached raw-material stock while production kept issuing
// from it (prod 2026-10-26: 3,420 RM_ISSUE, 1 RM_RECEIPT). When a purchase
// invoice is CONFIRMED, every line that is matched — tied to a PO, same
// material code as a PO line, and that material is a raw material — is
// received through a system GRN, born POSTED. It goes through the GRN's own
// stock and PO-counter statements, so stock, FIFO lots, cost ledger and PO
// status move exactly as a hand-posted GRN would move them.
//
// Only what the PO line still has open is received (ordered - receivedQty), so
// a PO that already had its GRN, or a second invoice for the same goods, adds
// nothing. A line that does not match is left for a person — it is listed in
// the result, never guessed.
//
// One receipt per invoice: the GRN id is derived from the PI id, so a retry or
// a second call is a no-op. Voiding the invoice does not undo the receipt —
// a wrong bill does not mean the goods did not arrive; cancel the GRN itself
// (its cancel already refuses once the stock has been used).
import {
  buildGRNStockStatements,
  buildPoReceiptStatements,
  ensureGrnMigrations,
  generateGrnNumber,
  isPoOverReceiptRace,
  resolveRmForGRNItem,
} from "../routes/grn";

export interface AutoGrnPiLine {
  id: string;
  poId: string | null;
  poItemId: string | null;
  materialCode: string | null;
  qty: number;
  unitPriceSen: number;
  lineType: string | null;
  grnItemId: string | null;
}

export interface AutoGrnPoLine {
  id: string;
  poId: string;
  materialCode: string | null;
  materialName: string | null;
  quantity: number;
  receivedQty: number;
  poStatus: string;
}

export interface AutoGrnPlannedLine {
  piLineId: string;
  poId: string;
  poItemId: string;
  materialCode: string;
  materialName: string;
  qty: number;
  unitPriceSen: number;
}

export interface AutoGrnSkippedLine {
  piLineId: string;
  materialCode: string | null;
  qty: number;
  reason: "NOT_STOCKED" | "FROM_GRN" | "NO_PO" | "PO_NOT_OPEN" | "NO_CODE" | "CODE_NOT_ON_PO" | "ALREADY_RECEIVED" | "NOT_RAW_MATERIAL";
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

// Only a PO that may move to RECEIVED (purchase-orders VALID_TRANSITIONS); a
// CLOSED one is settled by hand and receiving on it would flip it back.
const OPEN_PO = new Set(["CONFIRMED", "PARTIAL_RECEIVED"]);

// Pure: which PI lines go on the receipt, against which PO line, how many.
// `open` carries what earlier invoices in the same run already received, so a
// dry run over many invoices does not hand the same open quantity out twice.
export function planPiAutoGrn(
  piLines: AutoGrnPiLine[],
  poLines: AutoGrnPoLine[],
  open: Map<string, number> = new Map(),
): { lines: AutoGrnPlannedLine[]; skipped: AutoGrnSkippedLine[] } {
  const lines: AutoGrnPlannedLine[] = [];
  const skipped: AutoGrnSkippedLine[] = [];
  for (const po of poLines) {
    if (!open.has(po.id)) open.set(po.id, Math.max(0, (Number(po.quantity) || 0) - (Number(po.receivedQty) || 0)));
  }
  for (const pl of piLines) {
    const qty = Number(pl.qty) || 0;
    const skip = (reason: AutoGrnSkippedLine["reason"], left = qty) =>
      skipped.push({ piLineId: pl.id, materialCode: pl.materialCode, qty: left, reason });
    if (qty <= 0) continue;
    if ((pl.lineType ?? "STOCKED") !== "STOCKED") { skip("NOT_STOCKED"); continue; }
    if (pl.grnItemId) { skip("FROM_GRN"); continue; }
    if (!pl.poId) { skip("NO_PO"); continue; }
    const ofPo = poLines.filter((po) => po.poId === pl.poId);
    if (ofPo.length > 0 && !OPEN_PO.has(String(ofPo[0].poStatus).toUpperCase())) { skip("PO_NOT_OPEN"); continue; }
    // A blank code on the bill still matches when the line names its PO line;
    // the code checked is then that PO line's own.
    const own = pl.poItemId ? ofPo.find((po) => String(po.id) === String(pl.poItemId)) : undefined;
    const code = norm(pl.materialCode) || norm(own?.materialCode);
    if (!code) { skip("NO_CODE"); continue; }
    const candidates = ofPo
      .filter((po) => norm(po.materialCode) === code)
      .sort((a, b) => Number(String(b.id) === String(pl.poItemId)) - Number(String(a.id) === String(pl.poItemId)));
    if (candidates.length === 0) { skip("CODE_NOT_ON_PO"); continue; }
    let left = qty;
    for (const po of candidates) {
      const room = open.get(po.id) ?? 0;
      const take = Math.min(room, left);
      if (take <= 0) continue;
      open.set(po.id, room - take);
      left -= take;
      lines.push({
        piLineId: pl.id,
        poId: po.poId,
        poItemId: String(po.id),
        materialCode: String(po.materialCode ?? "").trim(),
        materialName: po.materialName ?? "",
        qty: take,
        unitPriceSen: Number(pl.unitPriceSen) || 0,
      });
      if (left <= 0) break;
    }
    if (left > 0) skip("ALREADY_RECEIVED", left);
  }
  return { lines, skipped };
}

export const autoGrnIdForPi = (piId: string) => `grn-pi-${piId}`;

type PiHeader = {
  id: string;
  piNo: string | null;
  status: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceDate: string | null;
  orgCode: string | null;
};

// Aliased columns throughout: the Postgres shim hands an unaliased snake_case
// column back under its camelCase key, so `r.material_code` reads undefined.
const PI_HEADER_SQL = `SELECT pi.id, pi.piNo AS "piNo", pi.status AS "status", pi.supplierId AS "supplierId",
       pi.supplierName AS "supplierName", pi.invoiceDate AS "invoiceDate", pi.purchase_org_code AS "orgCode"
  FROM purchase_invoices pi`;
const PI_LINE_SQL = `SELECT pii.id, pii.pi_id AS "piId", COALESCE(pii.po_id, pi.purchaseOrderId) AS "poId",
       pii.po_item_id AS "poItemId", pii.material_code AS "mc", pii.qty AS "qty",
       pii.unit_price_sen AS "price", pii.line_type AS "lt", pii.grn_item_id AS "grnItem"
  FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.pi_id`;

type PiLineRow = {
  id: string | number; piId: string; poId: string | null; poItemId: string | number | null; mc: string | null;
  qty: number; price: number; lt: string | null; grnItem: string | number | null;
};

function toPiLine(r: PiLineRow): AutoGrnPiLine {
  return {
    id: String(r.id),
    poId: r.poId ? String(r.poId) : null,
    poItemId: r.poItemId == null || r.poItemId === "" ? null : String(r.poItemId),
    materialCode: r.mc ?? null,
    qty: Number(r.qty) || 0,
    unitPriceSen: Number(r.price) || 0,
    lineType: r.lt ?? "STOCKED",
    grnItemId: r.grnItem == null || r.grnItem === "" ? null : String(r.grnItem),
  };
}

async function loadPiForAutoGrn(db: D1Database, piId: string) {
  const pi = await db.prepare(`${PI_HEADER_SQL} WHERE pi.id = ?`).bind(piId).first<PiHeader>();
  if (!pi) return null;
  const res = await db
    .prepare(`${PI_LINE_SQL} WHERE pii.pi_id = ? ORDER BY pii.created_at ASC, pii.id ASC`)
    .bind(piId)
    .all<PiLineRow>();
  return { pi, piLines: (res.results ?? []).map(toPiLine) };
}

async function loadPoLines(db: D1Database, poIds: string[]): Promise<AutoGrnPoLine[]> {
  if (poIds.length === 0) return [];
  const ph = poIds.map(() => "?").join(",");
  const res = await db
    .prepare(
      `SELECT poi.id, poi.purchaseOrderId AS "poId", poi.material_code AS "mc", poi.materialName AS "name",
              poi.quantity AS "qty", poi.receivedQty AS "recv", p.status AS "st"
         FROM purchase_order_items poi
         JOIN purchase_orders p ON p.id = poi.purchaseOrderId
        WHERE poi.purchaseOrderId IN (${ph})
        ORDER BY poi.id ASC`,
    )
    .bind(...poIds)
    .all<{ id: string | number; poId: string; mc: string | null; name: string | null; qty: number; recv: number | null; st: string }>();
  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    poId: String(r.poId),
    materialCode: r.mc,
    materialName: r.name,
    quantity: Number(r.qty) || 0,
    receivedQty: Number(r.recv) || 0,
    poStatus: String(r.st ?? ""),
  }));
}

type RmHit = { itemCode: string; description: string | null } | null;

// Drops planned lines whose material is not a raw material, and hands the
// stock writer a name its resolver will find ("itemCode - description").
async function resolvePlannedRm(
  db: D1Database,
  planned: AutoGrnPlannedLine[],
  skipped: AutoGrnSkippedLine[],
  cache: Map<string, RmHit> = new Map(),
) {
  const out: Array<AutoGrnPlannedLine & { stockName: string }> = [];
  for (const l of planned) {
    const key = `${norm(l.materialCode)}|${l.materialName}`;
    if (!cache.has(key)) {
      const hit =
        (await db
          .prepare(`SELECT itemCode AS "itemCode", description AS "description" FROM raw_materials WHERE itemCode = ? LIMIT 1`)
          .bind(l.materialCode)
          .first<{ itemCode: string; description: string | null }>()) ??
        (await resolveRmForGRNItem(db, l.materialCode, l.materialName));
      cache.set(key, hit ? { itemCode: hit.itemCode, description: hit.description } : null);
    }
    const rm = cache.get(key);
    if (!rm) {
      skipped.push({ piLineId: l.piLineId, materialCode: l.materialCode, qty: l.qty, reason: "NOT_RAW_MATERIAL" });
      continue;
    }
    out.push({ ...l, stockName: `${rm.itemCode} - ${rm.description ?? l.materialName}` });
  }
  return out;
}

export interface AutoGrnResult {
  grnId: string | null;
  grnNumber: string | null;
  received: AutoGrnPlannedLine[];
  skipped: AutoGrnSkippedLine[];
  note?: string;
}

// Post the receipt for one CONFIRMED invoice. Never throws: the invoice is
// already saved when this runs, and a failed receipt must not turn that save
// into a 500 that invites a second invoice.
export async function autoReceivePiStock(db: D1Database, piId: string): Promise<AutoGrnResult> {
  const grnId = autoGrnIdForPi(piId);
  const empty = (note: string, skipped: AutoGrnSkippedLine[] = []): AutoGrnResult => ({
    grnId: null, grnNumber: null, received: [], skipped, note,
  });
  try {
    await ensureGrnMigrations(db);
    const done = await db.prepare("SELECT grnNumber FROM grns WHERE id = ?").bind(grnId).first<{ grnNumber: string }>();
    if (done) return { grnId, grnNumber: done.grnNumber, received: [], skipped: [], note: "already received" };
    const loaded = await loadPiForAutoGrn(db, piId);
    if (!loaded) return empty("invoice not found");
    const { pi, piLines } = loaded;
    if (!["CONFIRMED", "PAID", "PARTIAL_PAID"].includes(String(pi.status).toUpperCase())) {
      return empty(`invoice is ${pi.status}`);
    }
    const poIds = [...new Set(piLines.map((l) => l.poId).filter((x): x is string => !!x))];
    const plan = planPiAutoGrn(piLines, await loadPoLines(db, poIds));
    const lines = await resolvePlannedRm(db, plan.lines, plan.skipped);
    if (lines.length === 0) return empty("no matched line", plan.skipped);

    const grnNumber = await generateGrnNumber(db);
    const receiveDate = String(pi.invoiceDate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const headerPoId = poIds.length === 1 ? poIds[0] : null;
    const headerPoNo = headerPoId
      ? (await db.prepare("SELECT poNo FROM purchase_orders WHERE id = ?").bind(headerPoId).first<{ poNo: string }>())?.poNo ?? null
      : null;
    const totalAmount = Math.round(lines.reduce((s, l) => s + l.qty * l.unitPriceSen, 0));
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO grns (id, grnNumber, poId, poNumber, supplierId, supplierName, receiveDate,
             receivedBy, totalAmount, qcStatus, status, notes, arrival_state, purchase_org_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PASSED', 'POSTED', ?, 'ARRIVED', ?)`,
        )
        .bind(
          grnId,
          grnNumber,
          headerPoId,
          headerPoNo,
          pi.supplierId,
          pi.supplierName ?? "",
          receiveDate,
          "System (purchase invoice)",
          totalAmount,
          `Auto stock-in from purchase invoice ${pi.piNo ?? piId}`,
          pi.orgCode ?? "HOOKKA",
        ),
      ...lines.map((l) =>
        db
          .prepare(
            `INSERT INTO grn_items (grnId, poItemIndex, po_id, po_item_id, materialCode, materialName,
               orderedQty, receivedQty, acceptedQty, rejectedQty, rejectionReason, unitPrice)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
          )
          .bind(grnId, l.poId, l.poItemId, l.materialCode, l.stockName, l.qty, l.qty, l.qty, l.unitPriceSen),
      ),
    ];
    const stock = await buildGRNStockStatements(
      db,
      { id: grnId, grnNumber, receiveDate },
      lines.map((l) => ({ acceptedQty: l.qty, materialCode: l.materialCode, materialName: l.stockName, unitPrice: l.unitPriceSen })),
    );
    statements.push(...stock.statements);
    statements.push(...buildPoReceiptStatements(db, lines.map((l) => ({ poId: l.poId, poItemId: l.poItemId, qty: l.qty }))));
    await db.batch(statements);
    return { grnId, grnNumber, received: lines, skipped: plan.skipped };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pi-auto-grn] ${piId} receipt failed:`, msg);
    return empty(isPoOverReceiptRace(e) ? "PO line received by another save at the same time" : `failed: ${msg}`);
  }
}

// Read-only: what a backfill would receive for invoices since `from`, oldest
// first, sharing PO open quantity across invoices the way a real run would.
// Reads in bulk (headers, lines, PO lines) so six months of invoices fit in
// one request.
export async function previewPiAutoGrn(db: D1Database, orgId: string, from: string) {
  await ensureGrnMigrations(db);
  const scope = `pi.orgId = ? AND pi.status IN ('CONFIRMED','PAID','PARTIAL_PAID') AND pi.invoiceDate >= ?
    AND NOT EXISTS (SELECT 1 FROM grns g WHERE g.id = 'grn-pi-' || pi.id)`;
  const heads =
    (await db.prepare(`${PI_HEADER_SQL} WHERE ${scope} ORDER BY pi.invoiceDate ASC, pi.id ASC`).bind(orgId, from).all<PiHeader>())
      .results ?? [];
  const lineRows =
    (await db
      .prepare(`${PI_LINE_SQL} WHERE ${scope} ORDER BY pii.created_at ASC, pii.id ASC`)
      .bind(orgId, from)
      .all<PiLineRow>()).results ?? [];
  const linesByPi = new Map<string, AutoGrnPiLine[]>();
  for (const r of lineRows) {
    const arr = linesByPi.get(String(r.piId)) ?? [];
    arr.push(toPiLine(r));
    linesByPi.set(String(r.piId), arr);
  }
  const allPoIds = [...new Set(lineRows.map((r) => r.poId).filter((x): x is string => !!x).map(String))];
  const poByPo = new Map<string, AutoGrnPoLine[]>();
  for (let i = 0; i < allPoIds.length; i += 200) {
    for (const line of await loadPoLines(db, allPoIds.slice(i, i + 200))) {
      const arr = poByPo.get(line.poId) ?? [];
      arr.push(line);
      poByPo.set(line.poId, arr);
    }
  }
  const open = new Map<string, number>();
  const rmCache = new Map<string, RmHit>();
  const invoices: Array<{ piNo: string | null; invoiceDate: string | null; supplierName: string | null; received: number; skipped: number; valueSen: number }> = [];
  const byMaterial = new Map<string, { qty: number; valueSen: number }>();
  const skipReasons: Record<string, number> = {};
  for (const head of heads) {
    const piLines = linesByPi.get(String(head.id)) ?? [];
    const poIds = [...new Set(piLines.map((l) => l.poId).filter((x): x is string => !!x))];
    const plan = planPiAutoGrn(piLines, poIds.flatMap((p) => poByPo.get(p) ?? []), open);
    const lines = await resolvePlannedRm(db, plan.lines, plan.skipped, rmCache);
    for (const s of plan.skipped) skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1;
    let valueSen = 0;
    for (const l of lines) {
      const v = l.qty * l.unitPriceSen;
      valueSen += v;
      const m = byMaterial.get(l.materialCode) ?? { qty: 0, valueSen: 0 };
      m.qty += l.qty;
      m.valueSen += v;
      byMaterial.set(l.materialCode, m);
    }
    if (lines.length > 0 || plan.skipped.length > 0) {
      invoices.push({
        piNo: head.piNo,
        invoiceDate: head.invoiceDate,
        supplierName: head.supplierName,
        received: lines.length,
        skipped: plan.skipped.length,
        valueSen: Math.round(valueSen),
      });
    }
  }
  return {
    from,
    invoicesScanned: heads.length,
    invoicesWithStock: invoices.filter((i) => i.received > 0).length,
    linesReceived: invoices.reduce((s, i) => s + i.received, 0),
    valueRm: Math.round(invoices.reduce((s, i) => s + i.valueSen, 0)) / 100,
    skipReasons,
    materials: [...byMaterial.entries()]
      .map(([code, m]) => ({ code, qty: m.qty, valueRm: Math.round(m.valueSen) / 100 }))
      .sort((a, b) => b.valueRm - a.valueRm),
    invoices,
  };
}
