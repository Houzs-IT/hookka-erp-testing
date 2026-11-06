// ---------------------------------------------------------------------------
// fabric-fifo-data.ts — loads what src/lib/fabric-fifo.ts needs: Fabric Usage on
// every cut FAB_CUT job card, receipts as FIFO layers, and the latest stock take.
// ---------------------------------------------------------------------------
import type { D1Database } from "@cloudflare/workers-types";
import {
  computeFcFabricUsageMeters,
  fetchBomWipComponentsByCode,
  fetchSofaSiblingsByGroupKey,
  sofaSiblingGroupKey,
} from "./fabric-usage";
import {
  countedMeters,
  fabricCodeKey,
  fifoCostByMonth,
  openingIsCredible,
  repricedOpeningSen,
  type FifoLayer,
} from "../../lib/fabric-fifo";

const FABRIC_GROUPS = ["B.M-FABR", "S.M-FABR", "S-FABRIC"];

export type FabricFifoRow = {
  cat: string;
  fabCode: string;
  ym: string;
  meters: number;
  pricedMeters: number;
  costSen: number;
};

export type FabricFifo = {
  rows: FabricFifoRow[];
  /** Metres cut in the last 30 days, category → fabric. */
  past30: Map<string, Map<string, number>>;
};

type CutRow = {
  completedDate: string | null;
  wipType: string | null;
  departmentCode: string | null;
  fabricCode: string | null;
  quantity: number;
  productCode: string | null;
  itemCategory: string | null;
  gapInches: number | null;
  divanHeightInches: number | null;
  legHeightInches: number | null;
  sizeCode: string | null;
  sizeLabel: string | null;
  companySOId: string | null;
  companyCOId: string | null;
};

async function loadLayers(db: D1Database, orgId: string): Promise<Map<string, FifoLayer[]>> {
  const groups = FABRIC_GROUPS.map((g) => `'${g}'`).join(",");
  const [batchRes, piRes] = await Promise.all([
    db
      .prepare(
        `SELECT rm.itemCode AS "code", b.source AS "source", b.receivedDate AS "date",
                b.originalQty AS "qty", b.unitCostSen AS "unitSen"
           FROM rm_batches b
           JOIN raw_materials rm ON rm.id = b.rmId
          WHERE rm.orgId = ? AND rm.itemGroup IN (${groups})`,
      )
      .bind(orgId)
      .all<{ code: string; source: string; date: string; qty: number; unitSen: number }>(),
    // Goods with no GRN only reach the books on the invoice, so the invoice is
    // the receipt for them. A line tied to a GRN is already a batch above. IN,
    // not a join: raw_materials has duplicate codes, which would double the line.
    db
      .prepare(
        `SELECT pii.materialCode AS "code", pi.invoiceDate AS "date", pii.qty AS "qty",
                pii.lineTotalSen AS "totalSen"
           FROM purchase_invoice_items pii
           JOIN purchase_invoices pi ON pi.id = pii.piId
          WHERE pi.orgId = ? AND pi.status NOT IN ('DRAFT','CANCELLED')
            AND pii.lineType = 'STOCKED' AND pii.grn_item_id IS NULL
            AND pii.materialCode IN (
              SELECT itemCode FROM raw_materials WHERE orgId = ? AND itemGroup IN (${groups})
            )`,
      )
      .bind(orgId, orgId)
      .all<{ code: string; date: string; qty: number; totalSen: number }>(),
  ]);

  const received = new Map<string, FifoLayer[]>();
  const openings = new Map<string, FifoLayer[]>();
  const add = (into: Map<string, FifoLayer[]>, code: string, l: FifoLayer) => {
    if (!(l.qty > 0) || !(l.unitSen > 0) || !l.date) return;
    const key = fabricCodeKey(code);
    into.set(key, [...(into.get(key) ?? []), l]);
  };
  for (const b of batchRes.results ?? []) {
    add(b.source === "OPENING" ? openings : received, b.code, {
      date: String(b.date).slice(0, 10),
      qty: Number(b.qty) || 0,
      unitSen: Number(b.unitSen) || 0,
    });
  }
  // An invoice from the GRN era is the same goods as its batch, so a fabric's
  // invoices only count from after its last GRN.
  const lastGrn = new Map<string, string>();
  for (const [code, ls] of received) lastGrn.set(code, ls.map((l) => l.date).sort().pop() ?? "");
  for (const p of piRes.results ?? []) {
    const date = String(p.date).slice(0, 10);
    const qty = Number(p.qty) || 0;
    if (date <= (lastGrn.get(fabricCodeKey(p.code)) ?? "") || qty <= 0) continue;
    add(received, p.code, { date, qty, unitSen: (Number(p.totalSen) || 0) / qty });
  }
  for (const [code, ls] of openings) {
    const bought = (received.get(code) ?? []).map((l) => l.unitSen);
    const kept = ls.filter((l) => openingIsCredible(l.unitSen, bought));
    if (kept.length > 0) received.set(code, [...kept, ...(received.get(code) ?? [])]);
  }
  return received;
}

export type OpeningReprice = {
  batchId: string;
  fabCode: string;
  remainingQty: number;
  oldUnitSen: number;
  newUnitSen: number;
};

/** OPENING fabric batches still on hand whose cost is out of line with what the fabric is bought at. */
export async function planOpeningReprice(db: D1Database, orgId: string): Promise<OpeningReprice[]> {
  const groups = FABRIC_GROUPS.map((g) => `'${g}'`).join(",");
  const res = await db
    .prepare(
      `SELECT b.id AS "id", rm.itemCode AS "code", b.remainingQty AS "remainingQty", b.unitCostSen AS "unitSen"
         FROM rm_batches b
         JOIN raw_materials rm ON rm.id = b.rmId
        WHERE rm.orgId = ? AND rm.itemGroup IN (${groups})
          AND b.source = 'OPENING' AND b.remainingQty > 0`,
    )
    .bind(orgId)
    .all<{ id: string; code: string; remainingQty: number; unitSen: number }>();
  const layers = await loadLayers(db, orgId);
  const out: OpeningReprice[] = [];
  for (const b of res.results ?? []) {
    const oldUnitSen = Number(b.unitSen) || 0;
    const key = fabricCodeKey(b.code);
    const newUnitSen = repricedOpeningSen(oldUnitSen, layers.get(key) ?? []);
    if (newUnitSen === null) continue;
    out.push({ batchId: b.id, fabCode: key, remainingQty: Number(b.remainingQty) || 0, oldUnitSen, newUnitSen });
  }
  return out;
}

/** The latest stock take that kept its lines: the month, and metres by fabric. */
async function loadLatestCount(
  db: D1Database,
  orgId: string,
  layers: ReadonlyMap<string, FifoLayer[]>,
): Promise<{ ym: string; meters: Map<string, number> } | null> {
  const prefix = `stock_take_lines:${orgId}:`;
  const row = await db
    .prepare(`SELECT key AS "key", value AS "value" FROM kv_config WHERE key LIKE ? ORDER BY key DESC LIMIT 1`)
    .bind(`${prefix}%`)
    .first<{ key: string; value: string | null }>();
  if (!row?.value) return null;
  const parsed = JSON.parse(row.value) as {
    lines?: { code?: string; group?: string; uom?: string; qty?: number; valueSen?: number; counted?: boolean }[];
  };
  const meters = new Map<string, number>();
  for (const l of parsed.lines ?? []) {
    if (!l.counted || !FABRIC_GROUPS.includes(String(l.group ?? ""))) continue;
    const key = fabricCodeKey(l.code);
    const latest = layers.get(key)?.reduce((a, b) => (b.date > a.date ? b : a));
    meters.set(key, (meters.get(key) ?? 0) + countedMeters(l, latest?.unitSen ?? 0));
  }
  return { ym: row.key.slice(prefix.length), meters };
}

export async function loadFabricFifo(db: D1Database, orgId: string, last30StartISO: string): Promise<FabricFifo> {
  const [bomMap, siblingsIdx, cutRes] = await Promise.all([
    fetchBomWipComponentsByCode(db),
    fetchSofaSiblingsByGroupKey(db),
    db
      .prepare(
        `SELECT jc.completedDate AS "completedDate", jc.wipType AS "wipType",
                jc.departmentCode AS "departmentCode", po.fabricCode AS "fabricCode",
                po.quantity AS "quantity", po.productCode AS "productCode",
                po.itemCategory AS "itemCategory", po.gapInches AS "gapInches",
                po.divanHeightInches AS "divanHeightInches", po.legHeightInches AS "legHeightInches",
                po.sizeCode AS "sizeCode", po.sizeLabel AS "sizeLabel",
                po.companySOId AS "companySOId", po.companyCOId AS "companyCOId"
           FROM job_cards jc
           JOIN production_orders po ON po.id = jc.productionOrderId
          WHERE po.orgId = ? AND jc.departmentCode = 'FAB_CUT'
            AND jc.status IN ('COMPLETED','TRANSFERRED')
            AND jc.completedDate IS NOT NULL
            AND po.status <> 'CANCELLED'
            AND po.fabricCode IS NOT NULL AND po.fabricCode <> ''`,
      )
      .bind(orgId)
      .all<CutRow>(),
  ]);

  // fabric → month → category → metres
  const used = new Map<string, Map<string, Map<string, number>>>();
  const past30 = new Map<string, Map<string, number>>();
  const since = last30StartISO.slice(0, 10);
  for (const jc of cutRes.results ?? []) {
    const wip = jc.productCode ? bomMap.get(jc.productCode) : null;
    const baseModel = jc.productCode ? siblingsIdx.baseModelByProductCode.get(jc.productCode) : null;
    const groupKey = sofaSiblingGroupKey(jc, baseModel);
    const siblings = groupKey ? siblingsIdx.byGroupKey.get(groupKey) : undefined;
    if (!wip && (!siblings || siblings.length === 0)) continue;
    const meters = computeFcFabricUsageMeters(jc, jc, wip, bomMap, siblings);
    if (meters <= 0) continue;
    const date = String(jc.completedDate).slice(0, 10);
    const ym = date.slice(0, 7);
    const code = fabricCodeKey(jc.fabricCode);
    const cat = String(jc.itemCategory ?? "").toUpperCase();
    const byYm = used.get(code) ?? new Map<string, Map<string, number>>();
    const byCat = byYm.get(ym) ?? new Map<string, number>();
    byCat.set(cat, (byCat.get(cat) ?? 0) + meters);
    byYm.set(ym, byCat);
    used.set(code, byYm);
    if (date >= since) {
      const m = past30.get(cat) ?? new Map<string, number>();
      m.set(code, (m.get(code) ?? 0) + meters);
      past30.set(cat, m);
    }
  }

  const layers = await loadLayers(db, orgId);
  const count = await loadLatestCount(db, orgId, layers);
  const nowYm = new Date().toISOString().slice(0, 7);
  const rows: FabricFifoRow[] = [];
  for (const [code, byYm] of used) {
    const usage = new Map([...byYm].map(([ym, c]) => [ym, [...c.values()].reduce((a, b) => a + b, 0)]));
    const months = fifoCostByMonth(layers.get(code) ?? [], usage, count?.ym ?? nowYm, count?.meters.get(code) ?? 0);
    for (const [ym, byCat] of byYm) {
      const total = usage.get(ym) ?? 0;
      const m = months.get(ym) ?? { pricedMeters: 0, costSen: 0 };
      for (const [cat, meters] of byCat) {
        const share = total > 0 ? meters / total : 0;
        rows.push({
          cat,
          fabCode: code,
          ym,
          meters,
          pricedMeters: m.pricedMeters * share,
          costSen: Math.round(m.costSen * share),
        });
      }
    }
  }
  return { rows, past30 };
}
