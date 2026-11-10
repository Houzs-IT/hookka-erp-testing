// ---------------------------------------------------------------------------
// supplier-binding-unique.ts — one supplier is bound to one item ONCE (O4).
//
// `supplier_material_bindings` is meant to hold one row per supplier+material
// (the effective-dated model UPDATEs that row's price; history lives in
// price_histories). Nothing enforced it: POST inserted blind, a PUT could move
// a binding onto an item the supplier already had, and the MRP / PO autofill
// then saw the same supplier twice with two prices. Sister fixes: Houzs#5486
// (route refusal) and Houzs#5509 (unique index; 23505 answers 409, not 500).
//
// Three parts:
//   * findSameBinding   — the route pre-check; a hit answers 409 with a plain
//                         message naming the row to edit instead.
//   * ensureBindingUniqueIndex — self-applies the unique index, but ONLY when
//                         the table holds no duplicate pairs today. If it does,
//                         creating the index would fail; we log and skip, and
//                         never delete or merge rows here — cleaning old rows is
//                         a production data write that needs the owner's yes.
//                         The route pre-check still refuses NEW duplicates.
//   * listDuplicateBindings — read-only report of the pairs that block the
//                         index (GET /api/supplier-materials/duplicates).
// ---------------------------------------------------------------------------

export const BINDING_UNIQUE_INDEX = "ux_supplier_material_bindings_org_supplier_material";

/** The plain-English refusal both POST and PUT answer with (409). */
export function duplicateBindingMessage(supplierLabel: string, materialCode: string): string {
  const who = supplierLabel.trim() || "This supplier";
  return `${who} is already bound to ${materialCode}. Edit the existing binding instead of adding another.`;
}

/** Postgres 23505 / SQLite "UNIQUE constraint failed" / adapter "duplicate key". */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && String(e.code ?? "") === "23505") return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /23505|duplicate key|UNIQUE constraint failed/i.test(msg);
}

type Db = D1Database;

export type SameBinding = { id: string; supplierName: string };

/**
 * An existing binding of the same org + supplier + material (exact code, the
 * same key the unique index uses), other than `excludeId`. null when free.
 */
export async function findSameBinding(
  db: Db,
  orgId: string,
  supplierId: string,
  materialCode: string,
  excludeId?: string,
): Promise<SameBinding | null> {
  const row = await db
    .prepare(
      `SELECT b.id AS "id", s.name AS "supplierName"
         FROM supplier_material_bindings b
         LEFT JOIN suppliers s ON s.id = b.supplierId
        WHERE b.orgId = ? AND b.supplierId = ? AND b.materialCode = ? AND b.id <> ?
        LIMIT 1`,
    )
    .bind(orgId, supplierId, materialCode, excludeId ?? "")
    .first<{ id: string; supplierName?: string | null; supplier_name?: string | null }>();
  if (!row) return null;
  return { id: String(row.id), supplierName: String(row.supplierName ?? row.supplier_name ?? "") };
}

export type DuplicateBindingGroup = {
  orgId: string;
  supplierId: string;
  supplierName: string;
  materialCode: string;
  count: number;
  bindingIds: string[];
};

type DupRow = {
  id: string;
  orgId?: string;
  org_id?: string;
  supplierId?: string;
  supplier_id?: string;
  materialCode?: string;
  material_code?: string;
  supplierName?: string | null;
  supplier_name?: string | null;
};

/**
 * Every org + supplier + material pair bound more than once. Read-only.
 * `orgId` limits the report to one tenant; omitted = all (the index is global).
 */
export async function listDuplicateBindings(db: Db, orgId?: string): Promise<DuplicateBindingGroup[]> {
  const orgFilter = orgId ? "WHERE orgId = ?" : "";
  const res = await db
    .prepare(
      `SELECT b.id AS "id", b.orgId AS "orgId", b.supplierId AS "supplierId",
              b.materialCode AS "materialCode", s.name AS "supplierName"
         FROM supplier_material_bindings b
         JOIN (
           SELECT orgId, supplierId, materialCode
             FROM supplier_material_bindings
             ${orgFilter}
            GROUP BY orgId, supplierId, materialCode
           HAVING COUNT(*) > 1
         ) d ON d.orgId = b.orgId AND d.supplierId = b.supplierId AND d.materialCode = b.materialCode
         LEFT JOIN suppliers s ON s.id = b.supplierId
        ORDER BY b.orgId, b.supplierId, b.materialCode, b.id`,
    )
    .bind(...(orgId ? [orgId] : []))
    .all<DupRow>();
  return groupDuplicateRows(res.results ?? []);
}

/** Pure: fold the joined rows into one group per pair. Exported for tests. */
export function groupDuplicateRows(rows: DupRow[]): DuplicateBindingGroup[] {
  const groups = new Map<string, DuplicateBindingGroup>();
  for (const r of rows) {
    const org = String(r.orgId ?? r.org_id ?? "");
    const supplierId = String(r.supplierId ?? r.supplier_id ?? "");
    const materialCode = String(r.materialCode ?? r.material_code ?? "");
    const key = `${org}\u0000${supplierId}\u0000${materialCode}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        orgId: org,
        supplierId,
        supplierName: String(r.supplierName ?? r.supplier_name ?? ""),
        materialCode,
        count: 0,
        bindingIds: [],
      };
      groups.set(key, g);
    }
    g.count++;
    g.bindingIds.push(String(r.id));
  }
  return [...groups.values()];
}

export type IndexOutcome = "created" | "skipped-duplicates" | "failed";

// Once per isolate. A skip / failure is remembered too (the duplicates will not
// vanish by themselves within an isolate's life); a new isolate re-checks, so
// the index lands on its own once the owner has cleaned the pairs up.
let indexOutcome: Promise<IndexOutcome> | null = null;

/** Test hook: forget the memo. */
export function resetBindingUniqueIndexMemo(): void {
  indexOutcome = null;
}

/**
 * Self-apply the unique index when — and only when — no duplicate pairs exist.
 * NEVER throws: the index is a backstop, the route pre-check is the refusal,
 * and a request must not fail because the backstop could not be built.
 */
export function ensureBindingUniqueIndex(db: Db): Promise<IndexOutcome> {
  if (indexOutcome) return indexOutcome;
  indexOutcome = (async (): Promise<IndexOutcome> => {
    try {
      const dup = await db
        .prepare(
          `SELECT COUNT(*) AS "n" FROM (
             SELECT orgId FROM supplier_material_bindings
              GROUP BY orgId, supplierId, materialCode
             HAVING COUNT(*) > 1
           ) d`,
        )
        .first<{ n: number | string }>();
      const groups = Number(dup?.n ?? 0);
      if (groups > 0) {
        console.warn(
          `[supplier-binding-unique] ${groups} supplier+material pair(s) are bound more than once; ` +
            `${BINDING_UNIQUE_INDEX} NOT created. List them at GET /api/supplier-materials/duplicates. ` +
            `No rows were changed.`,
        );
        return "skipped-duplicates";
      }
      await db
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${BINDING_UNIQUE_INDEX}
             ON supplier_material_bindings (org_id, supplier_id, material_code)`,
        )
        .run();
      return "created";
    } catch (err) {
      console.warn(
        `[supplier-binding-unique] could not create ${BINDING_UNIQUE_INDEX}:`,
        err instanceof Error ? err.message : err,
      );
      return "failed";
    }
  })().then((outcome) => {
    // A transient failure should be retried by the next request.
    if (outcome === "failed") indexOutcome = null;
    return outcome;
  });
  return indexOutcome;
}
