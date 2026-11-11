// ---------------------------------------------------------------------------
// Warehouse › Stock Take — a quantity-only count (owner 2026-11-11,
// WORK-TRACKER 133: 「先把我要做的 quantities usage 和 export for stock count
// 功能做好先」). Page: src/pages/inventory/stock-take.tsx; pure helpers:
// src/lib/stock-count.ts.
//
//   GET /api/stock-count/items        item master for the count sheet + the
//                                     types Finance has counted before
//   GET /api/stock-count/count?ym=    the month's saved warehouse count (and
//                                     whether Finance has a priced count)
//   PUT /api/stock-count/count        save the month's counted quantities
//   GET /api/stock-count/usage?ym=    opening count + purchased − closing count
//   PUT /api/stock-count/uom-factor   1 purchase unit = N count units, per item
//
// Quantities only — no price, no value, no posting. The warehouse count is its
// own kv record (stock_count:<org>:<ym>). Finance's stock take (table
// stock_take, kv stock_take_lines) is READ as the fallback count of a month the
// warehouse has not saved, never written here: valuing a count and putting it
// into the P&L stays Finance's (Accounting › Stock Take, owner presses Save).
// Purchase returns are not subtracted: none on Hookka prod (measured 2026-11-11).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import {
  buildUsage,
  countFromFinanceLines,
  countFromWarehouseLines,
  countUnitsFromLines,
  normalizeCountLines,
  parseUomFactor,
  prevYm,
  type CountItem,
  type PurchaseQty,
  type QtyByKey,
} from "../../lib/stock-count";
import { itemCodeKey, lastDayOfYm } from "../../lib/stock-take-import";

const app = new Hono<Env>();

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const countKey = (orgId: string, ym: string) => `stock_count:${orgId}:${ym}`;
const factorsKey = (orgId: string) => `stock_count_uom_factors:${orgId}`;
const financeLinesKey = (orgId: string, ym: string) => `stock_take_lines:${orgId}:${ym}`;

async function readKv(db: D1Database, key: string): Promise<unknown> {
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind(key)
    .first<{ value: string | null }>()
    .catch(() => null);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeKv(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}

/** Every raw material (any status — a count may name an item retired since). */
async function loadItems(db: D1Database, orgId: string): Promise<CountItem[]> {
  const res = await db
    .prepare("SELECT id, itemCode, description, baseUOM, itemGroup, status, isActive FROM raw_materials WHERE orgId = ? ORDER BY itemCode")
    .bind(orgId)
    .all<Record<string, unknown>>();
  return (res.results ?? [])
    .map((r) => {
      const status = String(r.status ?? "").trim().toUpperCase();
      const isActive = Number(r.isActive ?? r.is_active ?? 1) === 1;
      return {
        id: String(r.id ?? ""),
        code: String(r.itemCode ?? r.item_code ?? "").trim(),
        description: String(r.description ?? ""),
        uom: String(r.baseUOM ?? r.base_uom ?? r.baseUom ?? ""),
        group: String(r.itemGroup ?? r.item_group ?? "").trim(),
        active: status ? status === "ACTIVE" : isActive,
      };
    })
    .filter((i) => i.code);
}

/** The item groups Finance has put a stock take on (the P&L's counted types), FG/WIP aside. */
async function loadCountedGroups(db: D1Database, orgId: string): Promise<string[]> {
  try {
    const res = await db
      .prepare("SELECT DISTINCT item_group FROM stock_take WHERE org_id = ?")
      .bind(orgId)
      .all<Record<string, unknown>>();
    return [...new Set((res.results ?? []).map((r) => String(r.itemGroup ?? r.item_group ?? "").trim()))]
      .filter((g) => g && g !== "FG" && g !== "WIP")
      .sort();
  } catch {
    return []; // no stock_take table yet → the page ticks every type
  }
}

/**
 * The month's purchased quantity per item: purchase-invoice STOCKED lines
 * dated in the month (the same lines and status filter as Finance's
 * purchase-prices), plus each item's unit-price spread over every purchase up
 * to month end — prices far apart mean the invoice unit may not be the count's.
 */
async function loadPurchases(db: D1Database, orgId: string, ym: string): Promise<Record<string, PurchaseQty>> {
  const start = `${ym}-01`;
  const end = lastDayOfYm(ym);
  const lines =
    (
      await db
        .prepare(
          `SELECT pi.invoiceDate AS invoiceDate, pii.materialCode AS materialCode, pii.qty AS qty, pii.lineTotalSen AS lineTotalSen
             FROM purchase_invoice_items pii
             JOIN purchase_invoices pi ON pi.id = pii.piId
            WHERE pi.orgId = ? AND pi.status NOT IN ('DRAFT','CANCELLED') AND pii.lineType = 'STOCKED'
              AND pii.materialCode IS NOT NULL`,
        )
        .bind(orgId)
        .all<{ invoiceDate: string | null; materialCode: string | null; qty: number | null; lineTotalSen: number | null }>()
    ).results ?? [];
  const month: Record<string, number> = {};
  const spread: Record<string, { min: number; max: number }> = {};
  for (const l of lines) {
    const date = String(l.invoiceDate ?? "").slice(0, 10);
    const key = itemCodeKey(l.materialCode);
    const qty = Number(l.qty) || 0;
    const total = Number(l.lineTotalSen) || 0;
    if (!key || !date || date > end || qty <= 0) continue;
    if (date >= start) month[key] = Math.round(((month[key] ?? 0) + qty) * 10000) / 10000;
    if (total > 0) {
      const unit = total / qty;
      const s = spread[key];
      if (!s) spread[key] = { min: unit, max: unit };
      else {
        s.min = Math.min(s.min, unit);
        s.max = Math.max(s.max, unit);
      }
    }
  }
  const out: Record<string, PurchaseQty> = {};
  for (const [key, qty] of Object.entries(month)) {
    out[key] = { qty, minUnitSen: spread[key]?.min ?? 0, maxUnitSen: spread[key]?.max ?? 0 };
  }
  return out;
}

function cleanFactors(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = parseUomFactor(v);
    if (typeof f === "number") out[itemCodeKey(k)] = f;
  }
  return out;
}

type CountMeta = { source: "warehouse" | "finance"; ym: string; savedAt: string | null; savedBy: string | null; file: string | null; lines: number };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The count a month is measured with: the warehouse's own, else Finance's
 * priced count, else none — with the units it names per item (a warehouse line
 * carries one only when the sheet changed it; Finance's lines always do).
 */
function pickCount(ym: string, warehouse: unknown, finance: unknown): { qty: QtyByKey; units: Record<string, string[]>; meta: CountMeta } | null {
  const w = countFromWarehouseLines(warehouse);
  if (w && Object.keys(w).length) {
    const r = warehouse as Record<string, unknown>;
    return { qty: w, units: countUnitsFromLines(warehouse, false), meta: { source: "warehouse", ym, savedAt: str(r.savedAt), savedBy: str(r.savedBy), file: str(r.file), lines: Object.keys(w).length } };
  }
  const f = countFromFinanceLines(finance);
  if (f && Object.keys(f).length) {
    const r = finance as Record<string, unknown>;
    return { qty: f, units: countUnitsFromLines(finance, true), meta: { source: "finance", ym, savedAt: str(r.savedAt), savedBy: null, file: str(r.file), lines: Object.keys(f).length } };
  }
  return null;
}

async function actorName(c: Context<Env>): Promise<string | null> {
  const userId = (c.get as unknown as (k: string) => unknown)("userId");
  if (typeof userId !== "string" || !userId) return null;
  try {
    const u = await c.var.DB.prepare("SELECT displayName FROM users WHERE id = ? LIMIT 1").bind(userId).first<{ displayName: string | null }>();
    return u?.displayName ?? null;
  } catch {
    return null;
  }
}

const ymParam = (v: unknown) => String(v ?? "").slice(0, 7);

// GET /api/stock-count/items — the item master the count sheet lists, and the
// types Finance has counted before (ticked by default on the page).
app.get("/items", async (c) => {
  const denied = await requirePermission(c, "inventory", "read");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const [items, defaultGroups] = await Promise.all([loadItems(c.var.DB, orgId), loadCountedGroups(c.var.DB, orgId)]);
  return c.json({ success: true, data: { items, defaultGroups } });
});

// GET /api/stock-count/count?ym=YYYY-MM — the month's saved warehouse count,
// and a summary of Finance's priced count for the month (line count only).
app.get("/count", async (c) => {
  const denied = await requirePermission(c, "inventory", "read");
  if (denied) return denied;
  const ym = ymParam(c.req.query("ym"));
  if (!YM.test(ym)) return c.json({ success: false, error: "ym must be 'YYYY-MM'" }, 400);
  const orgId = getOrgId(c);
  const [count, finance] = await Promise.all([readKv(c.var.DB, countKey(orgId, ym)), readKv(c.var.DB, financeLinesKey(orgId, ym))]);
  const fin = countFromFinanceLines(finance);
  const fr = (finance ?? {}) as Record<string, unknown>;
  return c.json({
    success: true,
    data: {
      count: count && typeof count === "object" ? count : null,
      finance: fin && Object.keys(fin).length ? { savedAt: str(fr.savedAt), file: str(fr.file), lines: Object.keys(fin).length } : null,
    },
  });
});

// PUT /api/stock-count/count {ym, file?, lines:[{code, qty, remark?}]} — save
// (or replace) the month's counted quantities. Draft data: no money, no posting.
app.put("/count", async (c) => {
  const denied = await requirePermission(c, "inventory", "create");
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as { ym?: unknown; file?: unknown; lines?: unknown } | null;
  const ym = ymParam(body?.ym);
  if (!YM.test(ym)) return c.json({ success: false, error: "ym must be 'YYYY-MM'" }, 400);
  const norm = normalizeCountLines(body?.lines);
  if (norm.errors.length) return c.json({ success: false, error: norm.errors.slice(0, 5).join("; ") }, 400);
  if (!norm.lines.length) return c.json({ success: false, error: "Nothing counted — every quantity is blank" }, 400);
  const orgId = getOrgId(c);
  const key = countKey(orgId, ym);
  const before = (await readKv(c.var.DB, key)) as Record<string, unknown> | null;
  const record = {
    ym,
    file: typeof body?.file === "string" ? body.file.slice(0, 200) : "",
    savedAt: new Date().toISOString(),
    savedBy: await actorName(c),
    lines: norm.lines,
  };
  await writeKv(c.var.DB, countKey(orgId, ym), record);
  await emitAudit(c, {
    resource: "stock-count",
    resourceId: key,
    action: before ? "update" : "create",
    before: before ? { savedAt: before.savedAt ?? null, savedBy: before.savedBy ?? null, lines: Array.isArray(before.lines) ? before.lines.length : 0 } : null,
    after: { savedAt: record.savedAt, file: record.file, lines: record.lines.length },
  });
  return c.json({ success: true, data: { ym, savedAt: record.savedAt, savedBy: record.savedBy, file: record.file, lines: record.lines.length } });
});

// GET /api/stock-count/usage?ym=YYYY-MM — per item of every type: last
// month's count + the month's purchased quantity (× unit factor) − this
// month's count. The page shows the types Finance counts by default.
app.get("/usage", async (c) => {
  const denied = await requirePermission(c, "inventory", "read");
  if (denied) return denied;
  const ym = ymParam(c.req.query("ym"));
  if (!YM.test(ym)) return c.json({ success: false, error: "ym must be 'YYYY-MM'" }, 400);
  const prev = prevYm(ym);
  const orgId = getOrgId(c);
  const db = c.var.DB;
  const [items, defaultGroups, curW, curF, prevW, prevF, factorsRaw, purchases] = await Promise.all([
    loadItems(db, orgId),
    loadCountedGroups(db, orgId),
    readKv(db, countKey(orgId, ym)),
    readKv(db, financeLinesKey(orgId, ym)),
    readKv(db, countKey(orgId, prev)),
    readKv(db, financeLinesKey(orgId, prev)),
    readKv(db, factorsKey(orgId)),
    loadPurchases(db, orgId, ym),
  ]);
  const closing = pickCount(ym, curW, curF);
  const opening = pickCount(prev, prevW, prevF);
  const groups = [...new Set(items.map((i) => i.group).filter(Boolean))].sort();
  const usage = buildUsage({
    items,
    groups,
    opening: opening?.qty ?? null,
    closing: closing?.qty ?? null,
    openingUnits: opening?.units ?? {},
    closingUnits: closing?.units ?? {},
    purchases,
    factors: cleanFactors(factorsRaw),
  });
  return c.json({ success: true, data: { ym, prevYm: prev, opening: opening?.meta ?? null, closing: closing?.meta ?? null, defaultGroups, ...usage } });
});

// PUT /api/stock-count/uom-factor {code, factor} — "1 purchase unit = N count
// units" for one item (a roll bought, metres counted); factor null clears it.
app.put("/uom-factor", async (c) => {
  const denied = await requirePermission(c, "inventory", "create");
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as { code?: unknown; factor?: unknown } | null;
  const key = itemCodeKey(body?.code);
  if (!key || key.length > 100) return c.json({ success: false, error: "code is required" }, 400);
  const factor = parseUomFactor(body?.factor);
  if (factor === undefined) return c.json({ success: false, error: "factor must be a number above 0 (or blank to clear)" }, 400);
  const orgId = getOrgId(c);
  const before = cleanFactors(await readKv(c.var.DB, factorsKey(orgId)));
  const next = { ...before };
  if (factor === null) delete next[key];
  else next[key] = factor;
  await writeKv(c.var.DB, factorsKey(orgId), next);
  await emitAudit(c, { resource: "stock-count", resourceId: factorsKey(orgId), action: "update", before: { [key]: before[key] ?? null }, after: { [key]: factor } });
  return c.json({ success: true, data: { code: key, factor } });
});

export default app;
