// ---------------------------------------------------------------------------
// scan-corrections.ts - the scan learning loop's missing half (HK-0005).
//
// The loop only ever saw the corrected answer (`correctedJson`). The MISTAKE -
// what OCR read vs what the operator filed - was never kept, so a layout that
// misreads the same code every week was fixed by hand every week. This logs
// each changed string field as a (scope, field, raw) -> corrected pair and
// replays it on the next scan of the same customer / supplier.
//
// Scope: PO scans key on the customer id the operator picked, supplier scans on
// the supplier id. Pairs are exact (case/whitespace-folded) matches of what
// OCR read - the same layout misreads the same way - so a replay cannot touch
// a value OCR read correctly. Numbers are never aliased.
// ---------------------------------------------------------------------------
import { rawPoFor } from "./ocr-accuracy-core";

export type ScanKind = "po" | "supplier";
export type FieldCorrection = { field: string; rawValue: string; correctedValue: string };

const SHAPE: Record<ScanKind, { lines: string; fields: readonly string[] }> = {
  po: { lines: "items", fields: ["productCode", "sizeCode", "fabricCode"] },
  supplier: { lines: "lines", fields: ["supplierCode", "description"] },
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);

export function correctionKey(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
export const correctionMapKey = (field: string, raw: unknown): string =>
  `${field}\u0000${correctionKey(raw)}`;

// The raw document the corrected one was made from. PO: by customerPO (shared
// with the accuracy dashboard). Supplier: by docNo inside the {docs:[...]}
// envelope, else the sole doc.
function rawDocFor(kind: ScanKind, raw: unknown, corrected: unknown): Rec {
  if (kind === "po") return rec(rawPoFor(raw, corrected));
  const docs = arr(rec(raw).docs);
  if (docs.length === 0) return rec(raw);
  const want = correctionKey(rec(corrected).docNo);
  return docs.find((d) => want && correctionKey(d.docNo) === want) ?? docs[0];
}

/** Field-level mistakes between a raw extraction and what the operator filed. */
export function diffCorrections(kind: ScanKind, raw: unknown, corrected: unknown): FieldCorrection[] {
  const { lines, fields } = SHAPE[kind];
  const rl = arr(rawDocFor(kind, raw, corrected)[lines]);
  const cl = arr(rec(corrected)[lines]);
  const out: FieldCorrection[] = [];
  // Lines are paired by index, so an inserted/deleted/reordered line would
  // mis-pair every row after it and teach a wrong correction. Different line
  // counts => the operator restructured the doc; learn nothing from it.
  if (rl.length !== cl.length) return out;
  for (let i = 0; i < cl.length; i++) {
    for (const field of fields) {
      const rawValue = String(rl[i][field] ?? "").trim();
      const correctedValue = String(cl[i][field] ?? "").trim();
      if (!rawValue || !correctedValue) continue;
      if (correctionKey(rawValue) === correctionKey(correctedValue)) continue;
      out.push({ field, rawValue, correctedValue });
    }
  }
  return out;
}

/** Replay learned pairs onto one extracted document, in place. Returns count. */
export function applyCorrections(kind: ScanKind, doc: unknown, map: Map<string, string>): number {
  if (map.size === 0) return 0;
  const { lines, fields } = SHAPE[kind];
  let n = 0;
  for (const line of arr(rec(doc)[lines])) {
    for (const field of fields) {
      const hit = map.get(correctionMapKey(field, line[field]));
      if (hit !== undefined && line[field] !== hit) {
        line[field] = hit;
        n++;
      }
    }
  }
  return n;
}

// ---------- persistence -----------------------------------------------------
type Db = {
  prepare: (sql: string) => {
    bind: (...a: unknown[]) => {
      first: <T = unknown>() => Promise<T | null>;
      run: () => Promise<unknown>;
      all: <T = unknown>() => Promise<{ results?: T[] }>;
    };
    run: () => Promise<unknown>;
  };
};

let ensured = false;
export async function ensureScanCorrectionsTable(db: Db): Promise<void> {
  if (ensured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS scan_field_corrections (
         id              TEXT PRIMARY KEY,
         org_id          TEXT,
         kind            TEXT NOT NULL,
         scope_id        TEXT NOT NULL,
         field           TEXT NOT NULL,
         raw_norm        TEXT NOT NULL,
         raw_value       TEXT NOT NULL,
         corrected_value TEXT NOT NULL,
         hits            INTEGER NOT NULL DEFAULT 1,
         created_at      TEXT NOT NULL,
         last_seen_at    TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS scan_field_corrections_key_idx
         ON scan_field_corrections (org_id, kind, scope_id, field, raw_norm)`,
    )
    .run();
  ensured = true;
}

/** Upsert; the newest human decision for a (scope, field, raw) wins. Never throws. */
export async function recordCorrections(
  db: Db,
  o: { orgId: string; kind: ScanKind; scopeId: string; corrections: FieldCorrection[] },
): Promise<number> {
  if (!o.scopeId || o.corrections.length === 0) return 0;
  const now = new Date().toISOString();
  let n = 0;
  try {
    await ensureScanCorrectionsTable(db);
    for (const c of o.corrections) {
      await db
        .prepare(
          `INSERT INTO scan_field_corrections
             (id, org_id, kind, scope_id, field, raw_norm, raw_value, corrected_value, hits, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT (org_id, kind, scope_id, field, raw_norm) DO UPDATE SET
             corrected_value = EXCLUDED.corrected_value,
             raw_value       = EXCLUDED.raw_value,
             hits            = scan_field_corrections.hits + 1,
             last_seen_at    = EXCLUDED.last_seen_at`,
        )
        .bind(
          `sfc-${crypto.randomUUID().slice(0, 12)}`, o.orgId, o.kind, o.scopeId, c.field,
          correctionKey(c.rawValue), c.rawValue, c.correctedValue, now, now,
        )
        .run();
      n++;
    }
  } catch (e) {
    console.warn("[scan-corrections] record failed:", (e as Error).message);
  }
  return n;
}

/**
 * Learned pairs for one customer / supplier as a replay map. Never throws.
 * Only pairs seen at least twice replay (one confirm may be a one-off typo).
 * Rows with org_id NULL are legacy/unscoped and are deliberately not read.
 */
export async function loadCorrections(
  db: Db,
  o: { orgId: string; kind: ScanKind; scopeId: string },
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!o.scopeId) return map;
  try {
    await ensureScanCorrectionsTable(db);
    const res = await db
      .prepare(
        `SELECT field, raw_norm AS "rawNorm", corrected_value AS "correctedValue"
           FROM scan_field_corrections
          WHERE kind = ? AND scope_id = ? AND org_id = ? AND hits >= 2`,
      )
      .bind(o.kind, o.scopeId, o.orgId)
      .all<{ field: string; rawNorm: string; correctedValue: string }>();
    for (const r of res.results ?? []) map.set(`${r.field}\u0000${r.rawNorm}`, r.correctedValue);
  } catch (e) {
    console.warn("[scan-corrections] load failed:", (e as Error).message);
  }
  return map;
}

/**
 * Confirm-time hook: diff the stored raw extraction against what the operator
 * filed and log the mistakes. `raw` is the sample row's JSON text. Never throws.
 */
export async function learnFromConfirm(
  db: Db,
  o: { orgId: string; kind: ScanKind; scopeId: unknown; raw: unknown; corrected: unknown },
): Promise<number> {
  if (typeof o.scopeId !== "string" || !o.scopeId) return 0;
  try {
    // scopeId comes from the operator-submitted body; it must name a customer /
    // supplier of THIS org or a caller could seed another tenant's scope.
    const owner = await db
      .prepare(`SELECT id FROM ${o.kind === "po" ? "customers" : "suppliers"} WHERE id = ? AND orgId = ?`)
      .bind(o.scopeId, o.orgId)
      .first<{ id: string }>();
    if (!owner) return 0;
    const raw = typeof o.raw === "string" ? JSON.parse(o.raw) : o.raw;
    return await recordCorrections(db, {
      orgId: o.orgId, kind: o.kind, scopeId: o.scopeId,
      corrections: diffCorrections(o.kind, raw, o.corrected),
    });
  } catch (e) {
    console.warn("[scan-corrections] learn failed:", (e as Error).message);
    return 0;
  }
}
