// ---------------------------------------------------------------------------
// cnc-cut-list.ts — HK-0036: the daily CNC cut list for the ETMark operator.
//
// ERP does NOT make the cutter file. The chain is BUYI (.prj) → ETMark nests →
// .plt → xiao.exe "Send" → cutter, and a human presses Send. ERP's job is:
//   * a cut list of open Fab Cut job cards, grouped the way the CNC cuts:
//     BEDFRAME (and ACCESSORY) by fabric/colour code, SOFA by model + fabric,
//     due date ascending inside a group;
//   * stamping each export on its cards (cnc_cut_items), so the next export
//     takes only new cards, and a past batch can be re-exported;
//   * a "changed since export, check before cutting" line, once, when a PO is
//     cancelled or its qty / fabric / size is edited after its card went out.
// .plt files: sofa layouts live in the CNC template library (plt_key /
// plt_metres on cnc_templates); bedframe batch markers live in cnc_cut_markers.
// Metres are the trailing "NNMTR" the operator types into the file name.
//
// Same open-card filter as the Morning Brief's CNC queue (production-brief.ts
// collectCncQueue), so the two never disagree about what is waiting to cut.
// ---------------------------------------------------------------------------

export type DbLike = {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

/** Trailing "NNMTR" (optionally "NN MTR", decimals ok) before the extension. */
export function parseMetresFromName(name: string): number | null {
  const base = String(name ?? "").replace(/\.[^.\\/]*$/, "");
  const m = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*MTR\s*$/i.exec(base);
  return m ? Number(m[1]) : null;
}

export type CutRow = {
  jobCardId: string;
  category: string;
  fabricCode: string;
  productCode: string;
  productName: string;
  sizeLabel: string;
  wipLabel: string;
  qty: number;
  poNo: string;
  dueDate: string;
  layout?: { templateId: string; name: string; metres: number | null } | null;
};

export type CutLayout = {
  id: string;
  productCode: string;
  sizeLabel: string;
  displayName: string;
  pltMetres: number | null;
};

export type CutGroup = {
  key: string;
  category: string;
  fabricCode: string;
  model: string;
  rows: CutRow[];
};

const CAT_ORDER = ["BEDFRAME", "SOFA", "ACCESSORY"];
// Same loose size match as CncTemplatePanel: `2 S`, `2S`, `2s` are one size.
const normSize = (s: string) => String(s ?? "").replace(/["\s]/g, "").toLowerCase();

export function groupCutList(rows: CutRow[], layouts: CutLayout[] = []): CutGroup[] {
  const byKey = new Map<string, CutGroup>();
  for (const r of rows) {
    const category = (r.category || "ACCESSORY").toUpperCase();
    const isSofa = category === "SOFA";
    const model = isSofa ? r.productCode : "";
    const key = `${category}|${model}|${r.fabricCode}`;
    let g = byKey.get(key);
    if (!g) byKey.set(key, (g = { key, category, fabricCode: r.fabricCode, model, rows: [] }));
    const lay = isSofa
      ? layouts.find(
          (t) => t.productCode === r.productCode && normSize(t.sizeLabel) === normSize(r.sizeLabel),
        )
      : undefined;
    g.rows.push({
      ...r,
      layout: isSofa
        ? lay
          ? { templateId: lay.id, name: lay.displayName, metres: lay.pltMetres ?? null }
          : null
        : undefined,
    });
  }
  const catIdx = (c: string) => (CAT_ORDER.indexOf(c) + 4) % 4; // unknown categories last
  const groups = [...byKey.values()].sort(
    (a, b) =>
      catIdx(a.category) - catIdx(b.category) ||
      a.model.localeCompare(b.model) ||
      a.fabricCode.localeCompare(b.fabricCode),
  );
  for (const g of groups) {
    g.rows.sort(
      (a, b) =>
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.poNo.localeCompare(b.poNo),
    );
  }
  return groups;
}

// ── tables (runtime self-apply; migration 0260 is the record) ──────────────
export async function ensureCutListTables(db: DbLike): Promise<void> {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS cnc_cut_batches (
       id TEXT PRIMARY KEY, org_id TEXT NOT NULL, exported_at TEXT NOT NULL,
       exported_by TEXT, card_count INTEGER NOT NULL DEFAULT 0,
       change_count INTEGER NOT NULL DEFAULT 0)`,
    // One row per job card = the "exported at" stamp. snap_* is what the card
    // looked like when it went out; change_* is the last change reported.
    `CREATE TABLE IF NOT EXISTS cnc_cut_items (
       org_id TEXT NOT NULL, job_card_id TEXT NOT NULL, batch_id TEXT NOT NULL,
       exported_at TEXT NOT NULL, snap_qty INTEGER, snap_fabric TEXT,
       snap_size TEXT, snap_status TEXT, change_batch_id TEXT, change_note TEXT,
       PRIMARY KEY (org_id, job_card_id))`,
    `CREATE INDEX IF NOT EXISTS idx_cnc_cut_items_batch ON cnc_cut_items (batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cnc_cut_items_change ON cnc_cut_items (change_batch_id)`,
    `CREATE TABLE IF NOT EXISTS cnc_cut_markers (
       id TEXT PRIMARY KEY, org_id TEXT NOT NULL, batch_id TEXT NOT NULL,
       group_key TEXT NOT NULL, file_name TEXT NOT NULL, storage_key TEXT NOT NULL,
       metres DOUBLE PRECISION, size_bytes INTEGER NOT NULL DEFAULT 0,
       uploaded_at TEXT NOT NULL, uploaded_by TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_cnc_cut_markers_batch ON cnc_cut_markers (batch_id)`,
  ];
  for (const sql of ddl) await db.prepare(sql).bind().run();
}

// The Morning Brief's open-card filter (production-brief.ts collectCncQueue).
const OPEN_FAB_CUT = `jc.department_code = 'FAB_CUT'
  AND jc.status NOT IN ('COMPLETED','CANCELLED','TRANSFERRED')
  AND po.status IN ('IN_PROGRESS','PENDING')`;

const ROW_COLS = `jc.id AS job_card_id, COALESCE(jc.wip_label,'') AS wip_label,
  COALESCE(jc.due_date,'') AS due_date, COALESCE(po.po_no,'') AS po_no,
  COALESCE(po.product_code,'') AS product_code, COALESCE(po.product_name,'') AS product_name,
  COALESCE(po.size_label,'') AS size_label, COALESCE(po.fabric_code,'') AS fabric_code,
  COALESCE(po.item_category,'') AS item_category, COALESCE(po.quantity,0) AS quantity,
  COALESCE(po.status,'') AS po_status`;

type RawRow = {
  jobCardId: string;
  wipLabel: string;
  dueDate: string;
  poNo: string;
  productCode: string;
  productName: string;
  sizeLabel: string;
  fabricCode: string;
  itemCategory: string;
  quantity: number | string;
  poStatus: string;
};

const toCutRow = (r: RawRow): CutRow => ({
  jobCardId: r.jobCardId,
  category: r.itemCategory,
  fabricCode: r.fabricCode,
  productCode: r.productCode,
  productName: r.productName,
  sizeLabel: r.sizeLabel,
  wipLabel: r.wipLabel,
  qty: Number(r.quantity) || 0,
  poNo: r.poNo,
  dueDate: String(r.dueDate).slice(0, 10),
});

/** What changed between the export snapshot and the PO now; null = nothing. */
export function describeChange(
  snap: { qty: number; fabric: string; size: string; status: string },
  now: { qty: number; fabric: string; size: string; status: string },
): string | null {
  if (now.status === "CANCELLED" && snap.status !== "CANCELLED") return "PO cancelled";
  const parts: string[] = [];
  if (snap.qty !== now.qty) parts.push(`qty ${snap.qty} → ${now.qty}`);
  if (snap.fabric !== now.fabric) parts.push(`fabric ${snap.fabric} → ${now.fabric}`);
  if (snap.size !== now.size) parts.push(`size ${snap.size} → ${now.size}`);
  return parts.length ? parts.join("; ") : null;
}

async function loadLayouts(db: DbLike, orgId: string): Promise<CutLayout[]> {
  try {
    const res = await db
      .prepare(
        `SELECT id, COALESCE(product_code,'') AS product_code, COALESCE(size_label,'') AS size_label,
                COALESCE(display_name,'') AS display_name, plt_metres
           FROM cnc_templates
          WHERE org_id = ? AND plt_key IS NOT NULL AND plt_key <> ''`,
      )
      .bind(orgId)
      .all<Omit<CutLayout, "pltMetres"> & { pltMetres: number | string | null }>();
    return (res.results ?? []).map((t) => ({
      ...t,
      pltMetres: t.pltMetres == null || t.pltMetres === "" ? null : Number(t.pltMetres),
    }));
  } catch {
    return []; // library not set up / plt columns not self-applied yet
  }
}

export type CutBatch = {
  id: string;
  exportedAt: string;
  exportedBy: string | null;
  cardCount: number;
  changeCount: number;
};
export type CutMarker = {
  id: string;
  groupKey: string;
  fileName: string;
  metres: number | null;
  sizeBytes: number;
  uploadedAt: string;
};
export type CutChange = {
  jobCardId: string;
  poNo: string;
  productCode: string;
  fabricCode: string;
  sizeLabel: string;
  wipLabel: string;
  exportedAt: string;
  note: string;
};
export type CutListPayload = {
  batch: CutBatch;
  groups: CutGroup[];
  changed: CutChange[];
  markers: CutMarker[];
};

const toBatch = (b: Record<string, unknown>): CutBatch => ({
  id: String(b.id),
  exportedAt: String(b.exportedAt),
  exportedBy: (b.exportedBy as string) ?? null,
  cardCount: Number(b.cardCount) || 0,
  changeCount: Number(b.changeCount) || 0,
});

export async function listCutBatches(db: DbLike, orgId: string, limit = 30): Promise<CutBatch[]> {
  const res = await db
    .prepare(
      `SELECT id, exported_at, exported_by, card_count, change_count
         FROM cnc_cut_batches WHERE org_id = ? ORDER BY exported_at DESC LIMIT ?`,
    )
    .bind(orgId, limit)
    .all<Record<string, unknown>>();
  return (res.results ?? []).map(toBatch);
}

/** A batch as it reads now (its cards with current PO data) — the re-export. */
export async function loadCutBatch(
  db: DbLike,
  orgId: string,
  batchId: string,
): Promise<CutListPayload | null> {
  const b = await db
    .prepare(
      `SELECT id, exported_at, exported_by, card_count, change_count
         FROM cnc_cut_batches WHERE id = ? AND org_id = ?`,
    )
    .bind(batchId, orgId)
    .first<Record<string, unknown>>();
  if (!b) return null;

  const rows = await db
    .prepare(
      `SELECT ${ROW_COLS} FROM cnc_cut_items i
         JOIN job_cards jc ON jc.id = i.job_card_id
         JOIN production_orders po ON po.id = jc.production_order_id
        WHERE i.org_id = ? AND i.batch_id = ?`,
    )
    .bind(orgId, batchId)
    .all<RawRow>();
  const changed = await db
    .prepare(
      `SELECT ${ROW_COLS}, i.exported_at, COALESCE(i.change_note,'') AS change_note
         FROM cnc_cut_items i
         JOIN job_cards jc ON jc.id = i.job_card_id
         JOIN production_orders po ON po.id = jc.production_order_id
        WHERE i.org_id = ? AND i.change_batch_id = ?`,
    )
    .bind(orgId, batchId)
    .all<RawRow & { exportedAt: string; changeNote: string }>();
  const markers = await db
    .prepare(
      `SELECT id, group_key, file_name, metres, size_bytes, uploaded_at
         FROM cnc_cut_markers WHERE org_id = ? AND batch_id = ? ORDER BY uploaded_at`,
    )
    .bind(orgId, batchId)
    .all<Record<string, unknown>>();

  return {
    batch: toBatch(b),
    groups: groupCutList((rows.results ?? []).map(toCutRow), await loadLayouts(db, orgId)),
    changed: (changed.results ?? []).map((r) => ({
      jobCardId: r.jobCardId,
      poNo: r.poNo,
      productCode: r.productCode,
      fabricCode: r.fabricCode,
      sizeLabel: r.sizeLabel,
      wipLabel: r.wipLabel,
      exportedAt: r.exportedAt,
      note: r.changeNote,
    })),
    markers: (markers.results ?? []).map((m) => ({
      id: String(m.id),
      groupKey: String(m.groupKey),
      fileName: String(m.fileName),
      metres: m.metres == null ? null : Number(m.metres),
      sizeBytes: Number(m.sizeBytes) || 0,
      uploadedAt: String(m.uploadedAt),
    })),
  };
}

/**
 * Export the cut list: stamp every open Fab Cut card not yet exported into a
 * new batch, and report (once) cards whose PO changed since their export.
 * Returns null when there is nothing new and nothing changed.
 */
export async function exportCutList(
  db: DbLike,
  orgId: string,
  userId: string | null,
  now: string,
): Promise<CutListPayload | null> {
  const batchId = `cut-${crypto.randomUUID().slice(0, 12)}`;
  await db
    .prepare(
      `INSERT INTO cnc_cut_batches (id, org_id, exported_at, exported_by) VALUES (?, ?, ?, ?)`,
    )
    .bind(batchId, orgId, now, userId)
    .run();

  // Changes first: cards still to cut whose PO moved since their snapshot.
  const stamped = await db
    .prepare(
      `SELECT i.job_card_id, COALESCE(i.snap_qty,0) AS snap_qty, COALESCE(i.snap_fabric,'') AS snap_fabric,
              COALESCE(i.snap_size,'') AS snap_size, COALESCE(i.snap_status,'') AS snap_status,
              COALESCE(po.quantity,0) AS quantity, COALESCE(po.fabric_code,'') AS fabric_code,
              COALESCE(po.size_label,'') AS size_label, COALESCE(po.status,'') AS po_status
         FROM cnc_cut_items i
         JOIN job_cards jc ON jc.id = i.job_card_id
         JOIN production_orders po ON po.id = jc.production_order_id
        WHERE i.org_id = ? AND jc.status <> 'COMPLETED'`,
    )
    .bind(orgId)
    .all<Record<string, string | number>>();
  let changeCount = 0;
  for (const r of stamped.results ?? []) {
    const cur = {
      qty: Number(r.quantity) || 0,
      fabric: String(r.fabricCode),
      size: String(r.sizeLabel),
      status: String(r.poStatus),
    };
    const note = describeChange(
      {
        qty: Number(r.snapQty) || 0,
        fabric: String(r.snapFabric),
        size: String(r.snapSize),
        status: String(r.snapStatus),
      },
      cur,
    );
    if (!note) continue;
    // Move the snapshot forward so the same change is reported only once.
    await db
      .prepare(
        `UPDATE cnc_cut_items SET snap_qty = ?, snap_fabric = ?, snap_size = ?, snap_status = ?,
                change_batch_id = ?, change_note = ?
          WHERE org_id = ? AND job_card_id = ?`,
      )
      .bind(cur.qty, cur.fabric, cur.size, cur.status, batchId, note, orgId, r.jobCardId)
      .run();
    changeCount++;
  }

  // The stamp: one INSERT…SELECT; the (org_id, job_card_id) key makes a
  // concurrent second export skip cards the first already took.
  await db
    .prepare(
      `INSERT INTO cnc_cut_items (org_id, job_card_id, batch_id, exported_at,
              snap_qty, snap_fabric, snap_size, snap_status)
       SELECT CAST(? AS TEXT), jc.id, CAST(? AS TEXT), CAST(? AS TEXT),
              COALESCE(po.quantity,0), COALESCE(po.fabric_code,''),
              COALESCE(po.size_label,''), COALESCE(po.status,'')
         FROM job_cards jc
         JOIN production_orders po ON po.id = jc.production_order_id
        WHERE po.org_id = ? AND ${OPEN_FAB_CUT}
          AND NOT EXISTS (SELECT 1 FROM cnc_cut_items x
                           WHERE x.org_id = ? AND x.job_card_id = jc.id)
       ON CONFLICT DO NOTHING`,
    )
    .bind(orgId, batchId, now, orgId, orgId)
    .run();
  const cnt = await db
    .prepare(`SELECT COUNT(*) AS n FROM cnc_cut_items WHERE org_id = ? AND batch_id = ?`)
    .bind(orgId, batchId)
    .first<{ n: number | string }>();
  const cardCount = Number(cnt?.n) || 0;

  if (cardCount === 0 && changeCount === 0) {
    await db.prepare(`DELETE FROM cnc_cut_batches WHERE id = ?`).bind(batchId).run();
    return null;
  }
  await db
    .prepare(`UPDATE cnc_cut_batches SET card_count = ?, change_count = ? WHERE id = ?`)
    .bind(cardCount, changeCount, batchId)
    .run();
  return loadCutBatch(db, orgId, batchId);
}
