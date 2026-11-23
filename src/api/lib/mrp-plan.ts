// ---------------------------------------------------------------------------
// MRP plan (owner 2026-11-23) — raw materials only, against RM stock.
//
//   demand  = every open production order (PENDING / IN_PROGRESS) × its BOM,
//             computed by computeRequiredLines — the SAME function that
//             deducts stock, so the MRP and production can never disagree on
//             quantities (waste %, sponge sheet fraction, repair scope, fabric
//             from the order). A WIP's materials stop counting the moment that
//             WIP's job card completes and deducts them (rm_consume_marks); a
//             PO deducted under the old whole-PO rule counts as fully done.
//   need-by = the consuming job card's due date (that department's production
//             date), else the order's target date.
//   supply  = raw_materials.balanceQty, then open PO lines (not RECEIVED /
//             CANCELLED / CLOSED / DRAFT), earliest ETA first.
//   short   = what is left — see src/lib/mrp-netting.ts.
//
// Read-only. Nothing is stored: every GET recomputes from live data and says
// when (calculatedAt).
// ---------------------------------------------------------------------------
import {
  computeRequiredLines,
  loadBomResolveCache,
  loadConsumeState,
  sliceKey,
  type ProductionOrderRow,
} from "./po-cost-cascade";
import { netMaterial, statusOf, type MrpCover, type MrpDemand, type MrpStockStatus, type MrpSupply } from "../../lib/mrp-netting";
import { mrpGroupOf, mrpGroupTabs } from "../../lib/mrp-groups";

export type MrpOrderLine = {
  productionOrderId: string;
  poNo: string;
  productCode: string;
  quantity: number;
  jobCardId: string | null;
  dept: string;
  wipKey: string;
  required: number;
  needBy: string;
  covers: MrpCover[];
  shortQty: number;
  status: MrpStockStatus;
};

export type MrpMaterialRow = {
  rmId: string;
  code: string;
  description: string;
  itemGroup: string;
  group: string;
  uom: string;
  needed: number;
  stock: number;
  poOutstanding: number;
  short: number;
  firstNeedBy: string;
  mainSupplier: string | null;
  orders: MrpOrderLine[];
};

export type MrpPlan = {
  calculatedAt: string;
  groups: string[];
  materials: MrpMaterialRow[];
  productionOrders: { open: number; counted: number; alreadyDeducted: number; noBom: number };
  // BOM lines that map to no raw material — they cannot be planned.
  unresolved: { poNo: string; productCode: string; material: string; required: number }[];
  // Open PO lines whose code matches no raw material. Their quantity is
  // credited to nothing, so PO outstanding is a FLOOR — published, never
  // silently dropped (BUG-2026-08-13-096 / -144).
  openPoLinesUnresolved: number;
};

type JcRow = {
  id: string;
  productionOrderId: string;
  departmentCode: string;
  wipKey: string;
  dueDate: string;
};

const str = (r: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
};
const num = (r: Record<string, unknown>, ...keys: string[]): number => {
  for (const k of keys) {
    const v = Number(r[k]);
    if (r[k] != null && Number.isFinite(v)) return v;
  }
  return 0;
};

// Read-only memo over the few per-PO queries computeRequiredLines still issues
// when given a cache (leg-SKU config, leg fuzzy match). Identical SQL + binds
// run once per plan instead of once per order.
function memoReadDb(db: D1Database): D1Database {
  const memo = new Map<string, Promise<unknown>>();
  const wrap = (sql: string, binds: unknown[]) => {
    const key = (kind: string) => `${kind}\u0000${sql}\u0000${JSON.stringify(binds)}`;
    const real = () => db.prepare(sql).bind(...binds);
    return {
      bind: (...more: unknown[]) => wrap(sql, more),
      first: <T>() => {
        const k = key("first");
        if (!memo.has(k)) memo.set(k, real().first<T>());
        return memo.get(k) as Promise<T | null>;
      },
      all: <T>() => {
        const k = key("all");
        if (!memo.has(k)) memo.set(k, real().all<T>());
        return memo.get(k) as Promise<D1Result<T>>;
      },
      run: () => real().run(),
      raw: () => real().raw(),
    };
  };
  return {
    prepare: (sql: string) => wrap(sql, []),
    batch: (s: D1PreparedStatement[]) => db.batch(s),
    exec: (q: string) => db.exec(q),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

export async function buildMrpPlan(db: D1Database): Promise<MrpPlan> {
  const calculatedAt = new Date().toISOString();

  const [poRes, jcRes, poLineRes, bindRes, supRes] = await Promise.all([
    db
      .prepare("SELECT * FROM production_orders WHERE status IN ('PENDING','IN_PROGRESS')")
      .all<ProductionOrderRow & Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, productionOrderId, departmentCode, wipKey, dueDate
           FROM job_cards
          WHERE productionOrderId IN (SELECT id FROM production_orders WHERE status IN ('PENDING','IN_PROGRESS'))`,
      )
      .all<Record<string, unknown>>(),
    // Open PO lines. Code resolution mirrors the legacy MRP / Fabric tab:
    // material_code when present, else the "<itemCode> - <description>"
    // materialName convention. DRAFT is excluded (owner 2026-11-23: draft and
    // cancelled POs don't count as coming in).
    db
      .prepare(
        `SELECT COALESCE(
                  NULLIF(TRIM(poi.material_code), ''),
                  NULLIF(TRIM(SPLIT_PART(poi.materialName, ' - ', 1)), ''),
                  ''
                ) AS code,
                GREATEST(poi.quantity - COALESCE(poi.receivedQty, 0), 0) AS qty,
                po.poNo AS ref,
                po.expectedDate AS eta
           FROM purchase_order_items poi
           INNER JOIN purchase_orders po ON po.id = poi.purchaseOrderId
          WHERE po.status NOT IN ('RECEIVED', 'CANCELLED', 'CLOSED', 'DRAFT')`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare("SELECT supplierId, materialCode, isMainSupplier FROM supplier_material_bindings")
      .all<Record<string, unknown>>(),
    db.prepare("SELECT id, name FROM suppliers").all<Record<string, unknown>>(),
  ]);

  const orders = poRes.results ?? [];
  const cache = await loadBomResolveCache(db);
  const memoDb = memoReadDb(db);
  const state = await loadConsumeState(
    db,
    orders.map((o) => o.id),
  );

  // Job cards per PO for need-by + the consuming card id.
  const jcsByPo = new Map<string, JcRow[]>();
  for (const r of jcRes.results ?? []) {
    const jc: JcRow = {
      id: str(r, "id"),
      productionOrderId: str(r, "productionOrderId", "production_order_id"),
      departmentCode: str(r, "departmentCode", "department_code").toUpperCase(),
      wipKey: str(r, "wipKey", "wip_key", "wipkey"),
      dueDate: str(r, "dueDate", "due_date").slice(0, 10),
    };
    const arr = jcsByPo.get(jc.productionOrderId) ?? [];
    arr.push(jc);
    jcsByPo.set(jc.productionOrderId, arr);
  }

  type Demand = MrpDemand & Omit<MrpOrderLine, "covers" | "shortQty" | "status">;
  const demandsByRm = new Map<string, Demand[]>();
  const unresolved: MrpPlan["unresolved"] = [];
  let counted = 0;
  let alreadyDeducted = 0;
  let noBom = 0;

  for (const po of orders) {
    const st = state.get(po.id);
    if (st?.legacyConsumed) {
      alreadyDeducted++;
      continue;
    }
    const lines = await computeRequiredLines(memoDb, po, { cache });
    if (lines.length === 0) {
      noBom++;
      continue;
    }
    const remaining = lines.filter((l) => !st?.consumed.has(sliceKey(l.wipKey, l.consumeDept)));
    if (remaining.length === 0) {
      alreadyDeducted++;
      continue;
    }
    counted++;
    const jcs = jcsByPo.get(po.id) ?? [];
    const target = String((po as Record<string, unknown>).targetEndDate ?? (po as Record<string, unknown>).target_end_date ?? "").slice(0, 10);
    for (const l of remaining) {
      if (!l.rm) {
        unresolved.push({ poNo: po.poNo, productCode: po.productCode ?? "", material: l.name || l.code, required: l.required });
        continue;
      }
      // The job card that will consume this line: same dept, same WIP (an
      // untagged legacy line, or a card without wipKey, matches any WIP).
      const cards = jcs
        .filter((j) => j.departmentCode === l.consumeDept && (l.wipKey === "" || j.wipKey === "" || j.wipKey === l.wipKey))
        .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
      const card = cards[0] ?? null;
      const needBy = card?.dueDate || target || "";
      const d: Demand = {
        rmId: l.rm.id,
        required: l.required,
        needBy,
        sortKey: po.poNo ?? "",
        productionOrderId: po.id,
        poNo: po.poNo ?? "",
        productCode: po.productCode ?? "",
        quantity: Number(po.quantity) || 0,
        jobCardId: card?.id ?? null,
        dept: l.consumeDept,
        wipKey: l.wipKey,
      };
      const arr = demandsByRm.get(l.rm.id) ?? [];
      arr.push(d);
      demandsByRm.set(l.rm.id, arr);
    }
  }

  // Open PO supply per RM id.
  const supplyByRm = new Map<string, MrpSupply[]>();
  let openPoLinesUnresolved = 0;
  for (const r of poLineRes.results ?? []) {
    const code = str(r, "code");
    const qty = num(r, "qty");
    if (qty <= 0) continue;
    const rm = code ? cache.rmByItemCode.get(code) : undefined;
    if (!rm) {
      openPoLinesUnresolved++;
      continue;
    }
    const rmId = String(rm.id ?? "");
    const arr = supplyByRm.get(rmId) ?? [];
    arr.push({ rmId, ref: str(r, "ref", "poNo", "po_no"), eta: str(r, "eta", "expectedDate", "expected_date").slice(0, 10), qty });
    supplyByRm.set(rmId, arr);
  }

  // Main supplier per material code.
  const supplierName = new Map<string, string>();
  for (const s of supRes.results ?? []) supplierName.set(str(s, "id"), str(s, "name"));
  const mainSupplierByCode = new Map<string, string>();
  for (const b of bindRes.results ?? []) {
    if (num(b, "isMainSupplier", "is_main_supplier") !== 1) continue;
    const code = str(b, "materialCode", "material_code");
    const name = supplierName.get(str(b, "supplierId", "supplier_id"));
    if (code && name && !mainSupplierByCode.has(code)) mainSupplierByCode.set(code, name);
  }

  // Index RM rows by id once.
  const rmById = new Map<string, Record<string, unknown>>();
  for (const r of cache.rmByItemCode.values()) rmById.set(String(r.id ?? ""), r);

  const materials: MrpMaterialRow[] = [];
  for (const [rmId, demands] of demandsByRm) {
    const rm = rmById.get(rmId) ?? {};
    const stock = num(rm, "balanceQty", "balance_qty");
    const supplies = supplyByRm.get(rmId) ?? [];
    const alloc = netMaterial(demands, stock, supplies);
    const orderLines: MrpOrderLine[] = alloc.map((a) => {
      const { rmId: _r, sortKey: _s, ...rest } = a.demand;
      void _r;
      void _s;
      return { ...rest, covers: a.covers, shortQty: a.shortQty, status: statusOf(a) };
    });
    const itemGroup = str(rm, "itemGroup", "item_group");
    const code = str(rm, "itemCode", "item_code");
    const needed = demands.reduce((s, d) => s + d.required, 0);
    materials.push({
      rmId,
      code,
      description: str(rm, "description"),
      itemGroup,
      group: mrpGroupOf(itemGroup),
      uom: str(rm, "baseUOM", "baseUom", "base_uom"),
      needed,
      stock,
      poOutstanding: supplies.reduce((s, p) => s + p.qty, 0),
      short: orderLines.reduce((s, o) => s + o.shortQty, 0),
      firstNeedBy: orderLines.map((o) => o.needBy).filter(Boolean).sort()[0] ?? "",
      mainSupplier: mainSupplierByCode.get(code) ?? null,
      orders: orderLines,
    });
  }
  // Shortages first, then earliest need-by, then code.
  materials.sort(
    (a, b) =>
      Number(b.short > 0) - Number(a.short > 0) ||
      (a.firstNeedBy || "9999").localeCompare(b.firstNeedBy || "9999") ||
      a.code.localeCompare(b.code),
  );

  const liveGroups = [...cache.rmByItemCode.values()].map((r) => str(r, "itemGroup", "item_group"));
  return {
    calculatedAt,
    groups: mrpGroupTabs(liveGroups),
    materials,
    productionOrders: { open: orders.length, counted, alreadyDeducted, noBom },
    unresolved,
    openPoLinesUnresolved,
  };
}
