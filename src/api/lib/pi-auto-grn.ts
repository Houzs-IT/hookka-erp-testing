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
    const code = norm(pl.materialCode);
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
  purchaseOrderId: string | null;
  invoiceDate: string | null;
  purchase_org_code?: string | null;
  purchaseOrgCode?: string | null;
};

async function loadPiForAutoGrn(db: D1Database, piId: string) {
  const pi = await db
    .prepare(
      `SELECT id, piNo, status, supplierId, supplierName, purchaseOrderId, invoiceDate, purchase_org_code
         FROM purchase_invoices WHERE id = ?`,
    )
    .bind(piId)
    .first<PiHeader>();
  if (!pi) return null;
  const itemsRes = await db
    .prepare(
      `SELECT id, po_id, po_item_id, material_code, qty, unit_price_sen, line_type, grn_item_id
         FROM purchase_invoice_items WHERE pi_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .bind(piId)
    .all<Record<string, unknown>>();
  const piLines: AutoGrnPiLine[] = (itemsRes.results ?? []).map((r) => ({
    id: String(r.id),
    poId: (r.po_id as string | null) || pi.purchaseOrderId || null,
    poItemId: r.po_item_id == null ? null : String(r.po_item_id),
    materialCode: (r.material_code as string | null) ?? null,
    qty: Number(r.qty) || 0,
    unitPriceSen: Number(r.unit_price_sen) || 0,
    lineType: (r.line_type as string | null) ?? "STOCKED",
    grnItemId: r.grn_item_id == null || r.grn_item_id === "" ? null : String(r.grn_item_id),
  }));
  return { pi, piLines };
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

// Drops planned lines whose material is not a raw material, and hands the
// stock writer a name its resolver will find ("itemCode - description").
async function resolvePlannedRm(db: D1Database, planned: AutoGrnPlannedLine[], skipped: AutoGrnSkippedLine[]) {
  const out: Array<AutoGrnPlannedLine & { stockName: string }> = [];
  for (const l of planned) {
    const rm =
      (await db
        .prepare("SELECT id, itemCode, description FROM raw_materials WHERE itemCode = ? LIMIT 1")
        .bind(l.materialCode)
        .first<{ id: string; itemCode: string; description: string | null }>()) ??
      (await resolveRmForGRNItem(db, l.materialCode, l.materialName));
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
          pi.purchaseOrgCode ?? pi.purchase_org_code ?? "HOOKKA",
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
export async function previewPiAutoGrn(db: D1Database, orgId: string, from: string) {
  await ensureGrnMigrations(db);
  const pis = (
    await db
      .prepare(
        `SELECT pi.id FROM purchase_invoices pi
          WHERE pi.orgId = ? AND pi.status IN ('CONFIRMED','PAID','PARTIAL_PAID') AND pi.invoiceDate >= ?
            AND NOT EXISTS (SELECT 1 FROM grns g WHERE g.id = 'grn-pi-' || pi.id)
          ORDER BY pi.invoiceDate ASC, pi.id ASC`,
      )
      .bind(orgId, from)
      .all<{ id: string }>()
  ).results ?? [];
  const open = new Map<string, number>();
  const poCache = new Map<string, AutoGrnPoLine[]>();
  const invoices: Array<{ piNo: string | null; invoiceDate: string | null; supplierName: string | null; received: number; skipped: number; valueSen: number }> = [];
  const byMaterial = new Map<string, { qty: number; valueSen: number }>();
  const skipReasons: Record<string, number> = {};
  for (const { id } of pis) {
    const loaded = await loadPiForAutoGrn(db, id);
    if (!loaded) continue;
    const poIds = [...new Set(loaded.piLines.map((l) => l.poId).filter((x): x is string => !!x))];
    const missing = poIds.filter((p) => !poCache.has(p));
    for (const line of await loadPoLines(db, missing)) {
      const arr = poCache.get(line.poId) ?? [];
      arr.push(line);
      poCache.set(line.poId, arr);
    }
    for (const p of missing) if (!poCache.has(p)) poCache.set(p, []);
    const plan = planPiAutoGrn(loaded.piLines, poIds.flatMap((p) => poCache.get(p) ?? []), open);
    const lines = await resolvePlannedRm(db, plan.lines, plan.skipped);
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
        piNo: loaded.pi.piNo,
        invoiceDate: loaded.pi.invoiceDate,
        supplierName: loaded.pi.supplierName,
        received: lines.length,
        skipped: plan.skipped.length,
        valueSen: Math.round(valueSen),
      });
    }
  }
  return {
    from,
    invoicesScanned: pis.length,
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
