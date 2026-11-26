// ---------------------------------------------------------------------------
// mcp-round4.ts — AI Connector round 4 (owner 2026-11-26 「每个系统的 connector
// 都要做完整」): the Hookka quick answers K1–K12 + company_report.
//
// Same contract as mcp-quick.ts: pure functions over the JSON of EXISTING
// endpoints, which routes/mcp.ts reads as the calling person through readValue
// (module gate → inner GET → makeRedactor). A money field the person may not
// see arrives already removed; every summary here then shows it as null —
// never 0, never guessed. Money in sen, out as RM (2 dp).
// ---------------------------------------------------------------------------
import { addDays, daysBetween, listRows, pctChange, rm, sameDaysPrevMonth, validRange } from "./mcp-quick";

type Obj = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const ymd = (v: unknown): string => str(v).slice(0, 10);
const enc = encodeURIComponent;
/** Sen → RM, or null when the field is absent (removed for this person, or never sent). */
const rmOrNull = (o: Obj, k: string): number | null => (k in o && o[k] !== null && o[k] !== undefined ? rm(o[k]) : null);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : r1((s[m - 1] + s[m]) / 2);
};
const avg = (xs: number[]): number | null => (xs.length ? r1(xs.reduce((t, x) => t + x, 0) / xs.length) : null);
const TOP = 15;

// ── period (every period-type tool) ─────────────────────────────────────────

export const PERIODS = ["today", "week", "month", "last_month", "quarter", "year", "custom"] as const;
export type PeriodKind = (typeof PERIODS)[number];
export type Period = { period: PeriodKind; from: string; to: string; prev: { from: string; to: string } };

/** Same calendar day `n` months away, clamped to that month's last day. */
export function shiftMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const monthEnd = (ym: string) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

/**
 * today | week (Monday → today) | month (1st → today) | last_month | quarter
 * (quarter start → today) | year (1 Jan → today) | custom {from, to}. `prev` is
 * the period before it, same length: for the to-date periods the same days of
 * the previous week / month / quarter / year.
 */
export function resolvePeriod(args: Obj, today: string, dflt: PeriodKind = "month"): Period | { error: string } {
  const raw = str(args.period).trim().toLowerCase();
  const hasRange = !!args.from || !!args.to;
  const kind = (PERIODS as readonly string[]).includes(raw) ? (raw as PeriodKind) : hasRange ? "custom" : dflt;
  if (kind === "today") return { period: kind, from: today, to: today, prev: { from: addDays(today, -1), to: addDays(today, -1) } };
  if (kind === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const mon = addDays(today, -((dow + 6) % 7));
    return { period: kind, from: mon, to: today, prev: { from: addDays(mon, -7), to: addDays(today, -7) } };
  }
  if (kind === "month") {
    const from = `${today.slice(0, 7)}-01`;
    return { period: kind, from, to: today, prev: sameDaysPrevMonth(from, today) };
  }
  if (kind === "last_month") {
    const ym = shiftMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const pym = shiftMonths(`${ym}-01`, -1).slice(0, 7);
    return { period: kind, from: `${ym}-01`, to: monthEnd(ym), prev: { from: `${pym}-01`, to: monthEnd(pym) } };
  }
  if (kind === "quarter") {
    const m = Number(today.slice(5, 7));
    const qm = m - ((m - 1) % 3);
    const from = `${today.slice(0, 4)}-${String(qm).padStart(2, "0")}-01`;
    return { period: kind, from, to: today, prev: { from: shiftMonths(from, -3), to: shiftMonths(today, -3) } };
  }
  if (kind === "year") {
    const from = `${today.slice(0, 4)}-01-01`;
    return { period: kind, from, to: today, prev: { from: shiftMonths(from, -12), to: shiftMonths(today, -12) } };
  }
  const r = validRange(args.from, args.to ?? today);
  if (!r) return { error: "Give from and to as YYYY-MM-DD (from before to, at most 400 days), or period: today, week, month, last_month, quarter or year." };
  const len = daysBetween(r.from, r.to);
  return { period: "custom", from: r.from, to: r.to, prev: { from: addDays(r.from, -(len + 1)), to: addDays(r.from, -1) } };
}

// ── K1 po_overdue (Houzs shape) ─────────────────────────────────────────────

const PO_DONE = ["RECEIVED", "CLOSED", "CANCELLED"];
const PO_SENT = ["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"];
const poOpen = (p: Obj) => !PO_DONE.includes(str(p.status)) && p.deliveredInFull !== true;

/**
 * Open POs past their expected date + everything still to be received, from
 * GET /api/purchase-orders/stats. Same output shape as Houzs ERP's po_overdue
 * (services/mcp-faq.ts summarisePoOutstanding). Open / overdue = the
 * Procurement page's isOverdue rule (not received / closed / cancelled / billed
 * in full); awaiting receipt = sent to the supplier (submitted, confirmed,
 * partly received).
 */
export function summarisePoOverdue(stats: unknown, today: string, origin: string) {
  const open = listRows(stats).filter(poOpen);
  const line = (p: Obj) => {
    const date = ymd(p.expectedDate);
    return {
      po: str(p.poNo),
      supplier: str(p.supplierName) || "(no supplier)",
      supplierDate: date || null,
      daysLate: date && date < today ? daysBetween(date, today) : 0,
      status: str(p.status),
      valueRm: rmOrNull(p, "totalSen"),
      url: `${origin}/procurement/${enc(str(p.id))}`,
    };
  };
  const lines = open.map(line);
  const overdue = lines.filter((l) => l.daysLate > 0).sort((a, b) => b.daysLate - a.daysLate);
  const week = addDays(today, 6);
  const dueThisWeek = lines.filter((l) => l.supplierDate && l.supplierDate >= today && l.supplierDate <= week).sort((a, b) => str(a.supplierDate).localeCompare(str(b.supplierDate)));
  const awaiting = open.filter((p) => PO_SENT.includes(str(p.status)));
  const sum = (xs: (number | null)[]) => (xs.some((x) => x === null) && xs.every((x) => x === null) ? null : r2(xs.reduce<number>((t, x) => t + (x ?? 0), 0)));
  const bySupplier = new Map<string, { pos: number; valueRm: number; worstDaysLate: number }>();
  for (const l of overdue) {
    const g = bySupplier.get(l.supplier) ?? { pos: 0, valueRm: 0, worstDaysLate: 0 };
    g.pos += 1;
    g.valueRm = r2(g.valueRm + (l.valueRm ?? 0));
    g.worstDaysLate = Math.max(g.worstDaysLate, l.daysLate);
    bySupplier.set(l.supplier, g);
  }
  return {
    today,
    note: "Money in RM (the whole PO's value). Supplier date = the PO's expected date. Overdue = the Procurement page's rule: open (not received, closed, cancelled or billed in full) and past that date. Awaiting receipt = submitted, confirmed or partly received.",
    awaitingReceipt: { pos: awaiting.length, partlyReceived: awaiting.filter((p) => str(p.status) === "PARTIAL_RECEIVED").length, valueRm: sum(awaiting.map((p) => rmOrNull(p, "totalSen"))) },
    overdue: { pos: overdue.length, valueRm: sum(overdue.map((l) => l.valueRm)), top: overdue.slice(0, TOP) },
    dueThisWeek: { pos: dueThisWeek.length, top: dueThisWeek.slice(0, TOP) },
    overdueBySupplier: [...bySupplier.entries()].map(([supplier, g]) => ({ supplier, ...g })).sort((a, b) => b.pos - a.pos || b.valueRm - a.valueRm).slice(0, TOP),
  };
}

// ── K2 supplier_lateness (Houzs shape) ──────────────────────────────────────

function latenessIn(pos: Obj[], from: string, to: string) {
  const acc = new Map<string, { received: number; late: number; daysLate: number }>();
  let counted = 0;
  for (const p of pos) {
    if (!["RECEIVED", "CLOSED"].includes(str(p.status))) continue;
    const got = ymd(p.receivedDate);
    const promised = ymd(p.expectedDate);
    if (!got || !promised || got < from || got > to) continue;
    counted += 1;
    const name = str(p.supplierName) || "(no supplier)";
    const g = acc.get(name) ?? { received: 0, late: 0, daysLate: 0 };
    g.received += 1;
    const late = daysBetween(promised, got);
    if (late > 0) {
      g.late += 1;
      g.daysLate += late;
    }
    acc.set(name, g);
  }
  return { acc, counted };
}

/**
 * Late deliveries per supplier over a window, from GET /api/purchase-orders/stats:
 * a PO's received date (stamped by the GRN that completed it, grn.ts) against
 * its expected date. Houzs ERP's supplier_lateness shape, plus the window
 * before it for comparison.
 */
export function summariseSupplierLateness(stats: unknown, p: Period, today: string) {
  const pos = listRows(stats);
  const cur = latenessIn(pos, p.from, p.to);
  const prev = latenessIn(pos, p.prev.from, p.prev.to);
  const openOverdue = new Map<string, number>();
  for (const po of pos) {
    const d = ymd(po.expectedDate);
    if (poOpen(po) && d && d < today) openOverdue.set(str(po.supplierName) || "(no supplier)", (openOverdue.get(str(po.supplierName) || "(no supplier)") ?? 0) + 1);
  }
  const names = new Set([...cur.acc.keys(), ...openOverdue.keys()]);
  const suppliers = [...names]
    .map((supplier) => {
      const g = cur.acc.get(supplier) ?? { received: 0, late: 0, daysLate: 0 };
      return {
        supplier,
        receivedPos: g.received,
        lateDeliveries: g.late,
        onTimePct: g.received ? r1(((g.received - g.late) / g.received) * 100) : null,
        avgDaysLate: g.late ? r1(g.daysLate / g.late) : 0,
        openPosPastDate: openOverdue.get(supplier) ?? 0,
      };
    })
    .filter((s) => s.lateDeliveries > 0 || s.openPosPastDate > 0)
    .sort((a, b) => b.lateDeliveries + b.openPosPastDate - (a.lateDeliveries + a.openPosPastDate) || b.avgDaysLate - a.avgDaysLate);
  const totals = (x: ReturnType<typeof latenessIn>) => {
    let late = 0;
    for (const g of x.acc.values()) late += g.late;
    return { receivedPos: x.counted, lateDeliveries: late, onTimePct: x.counted ? r1(((x.counted - late) / x.counted) * 100) : null };
  };
  const t = totals(cur);
  return {
    from: p.from,
    to: p.to,
    note: "A delivery counts as late when the PO's received date (set by the GRN that completed it) is after its expected date. avgDaysLate is over the late ones only. openPosPastDate = POs still open and past their expected date today.",
    receivedPosInWindow: t.receivedPos,
    lateDeliveries: t.lateDeliveries,
    onTimePct: t.onTimePct,
    previousPeriod: { from: p.prev.from, to: p.prev.to, ...totals(prev) },
    suppliers: suppliers.slice(0, TOP),
  };
}

// ── K3 uninvoiced_deliveries ────────────────────────────────────────────────

export const UNINVOICED_STATUSES = "SIGNED,DELIVERED";

/**
 * Delivered (signed / delivered) delivery orders with no live invoice, from
 * GET /api/delivery-orders?status=SIGNED,DELIVERED (each row carries its live
 * invoiceNo and valueSen). Age from the day it was delivered.
 */
export function summariseUninvoiced(rows: Obj[], today: string, origin: string, truncated: boolean) {
  const open = rows.filter((r) => !str(r.invoiceNo).trim() && str(r.status) !== "INVOICED");
  const day = (r: Obj) => ymd(r.deliveredAt) || ymd(r.signedAt) || ymd(r.deliveryDate);
  const lines = open
    .map((r) => {
      const d = day(r);
      return {
        do: str(r.doNo),
        customer: str(r.customerName),
        status: str(r.status),
        delivered: d || null,
        ageDays: d ? daysBetween(d, today) : null,
        valueRm: rmOrNull(r, "valueSen"),
        url: `${origin}/delivery/${enc(str(r.id))}`,
      };
    })
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
  const buckets = { "0-7": 0, "8-30": 0, "31-60": 0, "over60": 0 };
  for (const l of lines) {
    const a = l.ageDays ?? 0;
    if (a <= 7) buckets["0-7"] += 1;
    else if (a <= 30) buckets["8-30"] += 1;
    else if (a <= 60) buckets["31-60"] += 1;
    else buckets.over60 += 1;
  }
  const money = lines.some((l) => l.valueRm !== null);
  const byCustomer = new Map<string, { dos: number; valueRm: number; oldestDays: number }>();
  for (const l of lines) {
    const g = byCustomer.get(l.customer) ?? { dos: 0, valueRm: 0, oldestDays: 0 };
    g.dos += 1;
    g.valueRm = r2(g.valueRm + (l.valueRm ?? 0));
    g.oldestDays = Math.max(g.oldestDays, l.ageDays ?? 0);
    byCustomer.set(l.customer, g);
  }
  return {
    note: "Delivered (signed or delivered) delivery orders with no invoice yet. Age = days since delivery. Value = the DO's value in RM.",
    count: lines.length,
    valueRm: money ? r2(lines.reduce((t, l) => t + (l.valueRm ?? 0), 0)) : null,
    byAgeDays: buckets,
    byCustomer: [...byCustomer.entries()].map(([customer, g]) => ({ customer, ...g, ...(money ? {} : { valueRm: null }) })).sort((a, b) => b.dos - a.dos).slice(0, 10),
    oldest: lines.slice(0, TOP),
    ...(truncated ? { cut: "More delivered DOs than were read; the newest are counted." } : {}),
  };
}

// ── K4 stock_check ──────────────────────────────────────────────────────────

const lc = (s: unknown) => str(s).trim().toLowerCase();
/** Exact code first, then code / name containing the text. */
function matchItems<T extends Obj>(rows: T[], q: string, code: (r: T) => string, name: (r: T) => string, max: number): T[] {
  const k = lc(q);
  if (!k) return [];
  const exact = rows.filter((r) => lc(code(r)) === k);
  const part = rows.filter((r) => lc(code(r)) !== k && (lc(code(r)).includes(k) || lc(name(r)).includes(k)));
  return [...exact, ...part].slice(0, max);
}

/**
 * One item → stock. Raw materials from GET /api/inventory?buckets=rawMaterials,
 * their open PO lines (outstanding qty, ETA) from GET
 * /api/procurement-reports/outstanding-lines; finished goods matched by GET
 * /api/products?search= and counted by GET /api/inventory/fg-stock. Any part
 * may be null (no access).
 */
export function summariseStockCheck(query: string, inv: unknown, products: unknown, fg: unknown, lines: unknown, today: string) {
  const out: Obj = {
    query,
    note: "Hookka keeps one stock balance per raw material (no warehouse split) and counts finished goods from production orders (no warehouse split either). Raw materials have no reservation — what open production orders need is in material_shortages. Open PO = outstanding quantity on POs not yet received, with the PO's expected date as ETA.",
  };
  if (inv !== null && inv !== undefined) {
    const rms = arr(obj(obj(inv).data ?? inv).rawMaterials).filter((r) => r.isActive !== false);
    const hits = matchItems(rms, query, (r) => str(r.itemCode), (r) => str(r.description), 10);
    const poLines = lines === null || lines === undefined ? null : listRows(lines);
    out.rawMaterials = hits.map((r) => {
      const code = str(r.itemCode);
      const open = poLines ? poLines.filter((l) => lc(l.materialCode) === lc(code)).sort((a, b) => ymd(a.expectedDate).localeCompare(ymd(b.expectedDate))) : null;
      return {
        code,
        description: str(r.description),
        group: str(r.itemGroup),
        uom: str(r.baseUOM),
        onHand: "balanceQty" in r ? num(r.balanceQty) : null,
        minStock: num(r.minStock),
        ...(open
          ? {
              onOpenPo: r2(open.reduce((t, l) => t + num(l.outstanding), 0)),
              nextEta: open.length ? ymd(open[0].expectedDate) || null : null,
              openPoLines: open.slice(0, 5).map((l) => ({
                po: str(l.poNo),
                supplier: str(l.supplierName),
                outstanding: num(l.outstanding),
                eta: ymd(l.expectedDate) || null,
                daysLate: ymd(l.expectedDate) && ymd(l.expectedDate) < today ? daysBetween(ymd(l.expectedDate), today) : 0,
              })),
            }
          : {}),
      };
    });
    if (hits.some((r) => !("balanceQty" in r))) out.onHandHidden = "The on-hand balance is hidden for this person (the ERP treats balances as a money field for their role).";
  }
  if (products !== null && products !== undefined) {
    const prods = listRows(products);
    const f = obj(obj(fg).data ?? fg);
    const counts = new Map(arr(f.counts).map((r) => [str(r.id), r] as const));
    const dyn = arr(f.dyn);
    const fgHits = [
      ...prods.map((p) => ({ code: str(p.code), name: str(p.name), c: counts.get(str(p.id)) })),
      ...matchItems(dyn, query, (r) => str(r.code), (r) => str(r.name), 5).map((r) => ({ code: str(r.code), name: str(r.name), c: r })),
    ].slice(0, 10);
    out.finishedGoods = fg === null || fg === undefined
      ? { products: fgHits.map((h) => ({ code: h.code, name: h.name })), note: "Finished-goods stock could not be read for this person." }
      : fgHits.map((h) => {
          const stock = num(h.c?.stockQty);
          const reserved = num(h.c?.reservedQty);
          return { code: h.code, name: h.name, inStock: stock, reserved, available: stock - reserved };
        });
  }
  return out;
}

// ── K5 product_cost ─────────────────────────────────────────────────────────

/** "Exact code" when the text looks like one, else the first search hit. */
export function pickProduct(query: string, search: unknown): { id: string; code: string; name: string } | null {
  const rows = listRows(search);
  const hit = matchItems(rows, query, (r) => str(r.code), (r) => str(r.name), 1)[0] ?? rows[0];
  return hit ? { id: str(hit.id), code: str(hit.code), name: str(hit.name) } : null;
}

/** BOM cost breakdown from GET /api/product-costing/:productId (the costing page's own figures). */
export function summariseProductCost(body: unknown, origin: string) {
  const d = obj(obj(body).data ?? body);
  const product = obj(d.product);
  const bom = d.bom ? obj(d.bom) : null;
  const mats = arr(d.nodes).flatMap((n) =>
    arr(n.materials).map((m) => ({
      part: str(n.label),
      code: str(m.code),
      name: str(m.name),
      qty: r2(num(m.qty)),
      unit: str(m.unit),
      status: str(m.status),
      priceRm: "priceSen" in m && m.priceSen !== null ? Math.round(num(m.priceSen) * 100) / 10_000 : null,
      amountRm: rmOrNull(m, "amountSen"),
      supplier: str(m.supplierName) || null,
    })),
  );
  const moneyShown = "totalSen" in d;
  const std = d.standard ? obj(d.standard) : null;
  return {
    product: { code: str(product.code), name: str(product.name), category: str(product.category) },
    link: `${origin}/products/${enc(str(product.id))}/costing`,
    bom: bom ? { version: str(bom.version), status: str(bom.status), effectiveFrom: ymd(bom.effectiveFrom) || null } : null,
    note: bom
      ? "Money in RM. Cost = labour (minutes × the labour rate) + materials with a supplier price; fabric at the selected price tier. Lines with no price, no code or 'from order' are NOT counted (missingLines) — the cost is understated by those."
      : "This product has no BOM, so it has no cost yet.",
    ...(moneyShown ? {} : { moneyHidden: "Cost and price figures are hidden for this person (product pricing / costing permission)." }),
    fabricTier: d.tier ?? null,
    totalRm: rmOrNull(d, "totalSen"),
    labourRm: rmOrNull(d, "labourSen"),
    materialRm: rmOrNull(d, "materialSen"),
    labourMinutes: num(d.minutes),
    byTierTotalRm: arr(d.tiers).map((t) => ({ tier: str(t.level), totalRm: rmOrNull(t, "totalSen") })),
    byDepartment: arr(d.byDept).map((x) => ({ dept: str(x.dept) || str(x.deptCode), minutes: num(x.minutes), labourRm: rmOrNull(x, "labourSen") })),
    materialLines: num(d.materialLines),
    missingLines: num(d.missingLines),
    materials: mats.sort((a, b) => (b.amountRm ?? -1) - (a.amountRm ?? -1)).slice(0, 25),
    notCounted: mats.filter((m) => m.status !== "priced" && m.status !== "fabric-tier").slice(0, 15).map((m) => ({ code: m.code, name: m.name, why: m.status })),
    ...(std ? { standard: { totalRm: rmOrNull(std, "totalSen"), setAt: ymd(std.setAt) || null, setBy: str(std.setBy) || null, changeVsStandardPct: moneyShown && "totalSen" in std ? pctChange(num(d.totalSen), num(std.totalSen)) : null } } : {}),
  };
}

// ── K6 / K11 production_output, worker_efficiency ───────────────────────────

const DEPT_NAMES: Record<string, string> = {
  FAB_CUT: "Fabric Cutting",
  FAB_SEW: "Fabric Sewing",
  WOOD_CUT: "Wood Cutting",
  FOAM: "Foam Bonding",
  FOAM_CUTTING: "Foam Cutting",
  FIBRE: "Fibre",
  FRAMING: "Framing",
  WEBBING: "Webbing",
  UPHOLSTERY: "Upholstery",
  PACKING: "Packing",
};

export type FloorWorker = { id: string; name: string; dept: string; done: number; workingMinutes: number; earnedMinutes: number; effPct: number | null; helper: boolean };

/**
 * Per-worker figures for a period: the saved days (GET
 * /api/dashboard/floor-live/summary) plus, when the period includes today and
 * today is not saved yet, today's live floor (GET /api/dashboard/floor-live).
 * Efficiency = earned ÷ clocked minutes (Floor Live's rule); a person who was
 * only a helper (never scanned) has no efficiency.
 */
export function mergeFloorWorkers(summary: unknown, live: unknown): FloorWorker[] {
  const by = new Map<string, FloorWorker>();
  for (const r of arr(obj(summary).rows)) {
    by.set(str(r.id), {
      id: str(r.id),
      name: str(r.name),
      dept: str(r.homeDept),
      done: num(r.done),
      workingMinutes: num(r.workingMinutes),
      earnedMinutes: num(r.earnedMinutes),
      effPct: r.effPct === null || r.effPct === undefined ? null : num(r.effPct),
      helper: r.isHelper === true,
    });
  }
  for (const w of arr(obj(live).workers)) {
    const id = str(w.id);
    const cur = by.get(id);
    const helperToday = w.isHelper === true;
    if (!cur) {
      by.set(id, { id, name: str(w.name), dept: str(w.homeDept || w.dept), done: num(w.done), workingMinutes: num(w.workingMinutes), earnedMinutes: num(w.earnedMinutes), effPct: w.effPct === null || w.effPct === undefined ? null : num(w.effPct), helper: helperToday });
      continue;
    }
    cur.done += num(w.done);
    cur.workingMinutes += num(w.workingMinutes);
    cur.earnedMinutes += num(w.earnedMinutes);
    cur.helper = cur.helper && helperToday;
    cur.effPct = !cur.helper && cur.workingMinutes > 0 ? Math.round((cur.earnedMinutes / cur.workingMinutes) * 100) : null;
  }
  return [...by.values()];
}

const deptName = (code: string, names: Map<string, string>) => names.get(code) || DEPT_NAMES[code] || code;

/** Department names from a floor-live reply ({departments:[{code,name}]}). */
export function floorDeptNames(...replies: unknown[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of replies) for (const d of arr(obj(r).departments)) if (str(d.code) && str(d.name)) m.set(str(d.code), str(d.name));
  return m;
}

/** Labour cost per department code over the period's months, from GET /api/accounting/dashboard rows (salaryByDept). */
export function labourByDept(dash: unknown, from: string, to: string): Map<string, number> | null {
  if (dash === null || dash === undefined) return null;
  const out = new Map<string, number>();
  for (const row of arr(obj(obj(dash).data ?? dash).rows)) {
    const ym = str(row.key);
    if (ym < from.slice(0, 7) || ym > to.slice(0, 7)) continue;
    for (const s of arr(row.salaryByDept)) {
      if (!("costSen" in s)) continue;
      out.set(str(s.dept), (out.get(str(s.dept)) ?? 0) + num(s.costSen));
    }
  }
  return out;
}

/**
 * Output and efficiency for a period. `cur` / `prev` = GET
 * /api/dashboard/floor-live/completed for the period and the one before
 * (pieces completed per department, production value); `workers` from
 * mergeFloorWorkers. view "efficiency" (worker_efficiency) leads with the
 * lowest efficiency; "output" (production_output) with what was made.
 */
export function summariseProductionOutput(view: "output" | "efficiency", p: Period, cur: unknown, prev: unknown, workers: FloorWorker[] | null, names: Map<string, string>, labour: Map<string, number> | null) {
  const depts = arr(obj(cur).departments);
  const prevDepts = arr(obj(prev).departments);
  const sumUnits = (xs: Obj[]) => ({ bedframeUnits: r1(xs.reduce((t, d) => t + num(d.bedframeUnits), 0)), sofaSets: r1(xs.reduce((t, d) => t + num(d.sofaSets), 0)) });
  const valueShown = depts.some((d) => "bedframeSen" in d);
  const val = (d: Obj) => (valueShown ? rm(num(d.bedframeSen) + num(d.sofaSen) + num(d.accessorySen)) : null);
  const ws = workers ?? [];
  const byDept = new Map<string, { workers: number; working: number; earned: number; done: number }>();
  for (const w of ws) {
    const g = byDept.get(w.dept) ?? { workers: 0, working: 0, earned: 0, done: 0 };
    g.workers += 1;
    g.done += w.done;
    if (!w.helper) {
      g.working += w.workingMinutes;
      g.earned += w.earnedMinutes;
    }
    byDept.set(w.dept, g);
  }
  const codes = new Set([...depts.map((d) => str(d.dept)), ...byDept.keys()].filter(Boolean));
  const days = Math.max(1, daysBetween(p.from, p.to) + 1);
  const rows = [...codes].map((code) => {
    const d = depts.find((x) => str(x.dept) === code) ?? {};
    const pd = prevDepts.find((x) => str(x.dept) === code) ?? {};
    const g = byDept.get(code);
    return {
      dept: deptName(code, names),
      bedframeUnits: num(d.bedframeUnits),
      sofaSets: num(d.sofaSets),
      previous: { bedframeUnits: num(pd.bedframeUnits), sofaSets: num(pd.sofaSets) },
      usualPerDay: { bedframe: num(d.usualBedframe), sofa: num(d.usualSofa) },
      valueRm: val(d),
      ...(g
        ? {
            workers: g.workers,
            piecesDone: r1(g.done),
            hoursClocked: r1(g.working / 60),
            hoursEarned: r1(g.earned / 60),
            efficiencyPct: g.working > 0 ? Math.round((g.earned / g.working) * 100) : null,
          }
        : {}),
      ...(labour ? { labourCostRm: labour.has(code) ? rm(labour.get(code)) : null } : {}),
    };
  });
  const tot = sumUnits(depts);
  const ptot = sumUnits(prevDepts);
  const work = ws.reduce((t, w) => t + (w.helper ? 0 : w.workingMinutes), 0);
  const earn = ws.reduce((t, w) => t + (w.helper ? 0 : w.earnedMinutes), 0);
  const rated = ws.filter((w) => !w.helper && w.effPct !== null && w.workingMinutes >= 60);
  const wline = (w: FloorWorker) => ({ name: w.name, dept: deptName(w.dept, names), piecesDone: r1(w.done), hoursClocked: r1(w.workingMinutes / 60), hoursEarned: r1(w.earnedMinutes / 60), efficiencyPct: w.effPct });
  const lowest = [...rated].sort((a, b) => (a.effPct ?? 0) - (b.effPct ?? 0));
  const base = {
    view,
    period: p.period,
    from: p.from,
    to: p.to,
    note: "Pieces = job cards completed per department (Floor Live / Department Completed rules; a bed is counted in units, a sofa in sets). Efficiency = earned minutes (standard time of the work done) ÷ clocked minutes, helpers left out (Floor Live's rule). Past days come from Floor Live's saved daily copies; today is live." + (labour ? " Labour cost = payroll by department from the Finance dashboard, whole months." : ""),
    ...(workers === null ? { workersNote: "Per-worker figures could not be read for this person." } : {}),
    factory: {
      ...tot,
      valueRm: valueShown ? r2(depts.reduce((t, d) => t + (val(d) ?? 0), 0)) : null,
      previous: { from: p.prev.from, to: p.prev.to, ...ptot },
      change: { bedframePct: pctChange(tot.bedframeUnits, ptot.bedframeUnits), sofaPct: pctChange(tot.sofaSets, ptot.sofaSets) },
      ...(workers ? { workers: ws.length, hoursClocked: r1(work / 60), efficiencyPct: work > 0 ? Math.round((earn / work) * 100) : null } : {}),
      ...(labour ? { labourCostRm: rm([...labour.values()].reduce((t, x) => t + x, 0)) } : {}),
      days,
    },
  };
  if (view === "efficiency") {
    return {
      ...base,
      departmentsLowestFirst: rows.filter((r) => "efficiencyPct" in r && r.efficiencyPct !== null).sort((a, b) => num(a.efficiencyPct) - num(b.efficiencyPct)),
      lowestEfficiencyWorkers: lowest.slice(0, TOP).map(wline),
      workersRated: rated.length,
      ratingRule: "Only people with at least 1 clocked hour in the period who were not helpers.",
    };
  }
  return {
    ...base,
    byDepartment: rows.sort((a, b) => b.bedframeUnits + b.sofaSets - (a.bedframeUnits + a.sofaSets)),
    ...(workers
      ? {
          topWorkers: [...rated].sort((a, b) => b.done - a.done).slice(0, 5).map(wline),
          lowestEfficiencyWorkers: lowest.slice(0, 5).map(wline),
        }
      : {}),
  };
}

// ── K8 raw_material_summary ─────────────────────────────────────────────────

/**
 * Raw materials: stock (GET /api/inventory?buckets=rawMaterials), short for
 * open production orders (GET /api/mrp/plan, optional) and supplier price
 * changes in the period (GET /api/price-history, optional).
 */
export function summariseRawMaterials(inv: unknown, plan: unknown, prices: unknown, p: Period) {
  const rms = arr(obj(obj(inv).data ?? inv).rawMaterials).filter((r) => r.isActive !== false);
  const balShown = rms.some((r) => "balanceQty" in r);
  const bal = (r: Obj) => num(r.balanceQty);
  const byCode = new Map(rms.map((r) => [lc(r.itemCode), r] as const));
  const line = (r: Obj) => ({ code: str(r.itemCode), description: str(r.description), group: str(r.itemGroup), uom: str(r.baseUOM), balance: balShown ? bal(r) : null, min: num(r.minStock) });
  const groups: Record<string, number> = {};
  for (const r of rms) groups[str(r.itemGroup) || "Other"] = (groups[str(r.itemGroup) || "Other"] ?? 0) + 1;
  const out: Obj = {
    period: p.period,
    from: p.from,
    to: p.to,
    note: "Raw materials from the Inventory page. Low = below the item's own minimum stock. Short = needed by open production orders − stock − open PO quantity (the MRP page's rule). Price changes = supplier price changes recorded in the period (Price History), RM per the material's unit. Consumption this month is not given: the ERP has no bounded read of material issues.",
    stock: balShown
      ? {
          active: rms.length,
          byGroup: groups,
          negative: rms.filter((r) => bal(r) < 0).length,
          zero: rms.filter((r) => bal(r) === 0).length,
          belowMinimum: rms.filter((r) => num(r.minStock) > 0 && bal(r) >= 0 && bal(r) < num(r.minStock)).length,
          lowest: rms
            .filter((r) => num(r.minStock) > 0 && bal(r) < num(r.minStock))
            .sort((a, b) => bal(a) / num(a.minStock) - bal(b) / num(b.minStock))
            .slice(0, 10)
            .map(line),
        }
      : { active: rms.length, byGroup: groups, balancesHidden: "Stock balances are hidden for this person (the ERP treats balances as a money field for their role)." },
  };
  if (plan !== null && plan !== undefined) {
    const mats = arr(obj(obj(plan).data ?? plan).materials).filter((m) => num(m.short) > 0);
    out.shortForProduction = {
      count: mats.length,
      first: mats
        .sort((a, b) => str(a.firstNeedBy || "9").localeCompare(str(b.firstNeedBy || "9")))
        .slice(0, 8)
        .map((m) => ({ code: str(m.code), description: str(m.description), short: num(m.short), uom: str(m.uom), firstNeedBy: ymd(m.firstNeedBy) || null })),
    };
  }
  if (prices !== null && prices !== undefined) {
    const changes = listRows(prices)
      .map((h) => ({ h, d: ymd(h.effectiveFrom) || ymd(h.changedDate) }))
      .filter((x) => x.d >= p.from && x.d <= p.to && "newPrice" in x.h)
      .map(({ h, d }) => {
        const oldP = num(h.oldPrice);
        const newP = num(h.newPrice);
        const m = byCode.get(lc(h.materialCode));
        return {
          code: str(h.materialCode),
          description: m ? str(m.description) : "",
          date: d,
          oldRm: Math.round(oldP * 100) / 10_000,
          newRm: Math.round(newP * 100) / 10_000,
          changePct: oldP > 0 ? pctChange(newP, oldP) : null,
          status: str(h.approvalStatus) || null,
        };
      });
    out.priceChanges = {
      count: changes.length,
      materials: new Set(changes.map((c) => c.code)).size,
      biggestIncreases: changes.filter((c) => (c.changePct ?? 0) > 0).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 10),
      decreases: changes.filter((c) => (c.changePct ?? 0) < 0).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 5),
      latest: changes.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    };
  }
  return out;
}

// ── K9 gross_profit ─────────────────────────────────────────────────────────

export type GpBy = "product" | "customer" | "invoice";

function gpOf(costs: Obj | null) {
  const costOf = (code: string): { sen: number; missing: number } | null => {
    if (!costs) return null;
    const c = obj(costs[code]);
    return "totalSen" in c ? { sen: num(c.totalSen), missing: num(c.missingLines) } : null;
  };
  let revenue = 0;
  let covered = 0;
  let cost = 0;
  const noCost = new Map<string, number>();
  const groups = new Map<string, { revenue: number; covered: number; cost: number; qty: number; understated: boolean }>();
  return {
    add(by: GpBy, l: Obj) {
      const code = str(l.productCode);
      const sen = num(l.totalSen);
      const qty = num(l.quantity);
      revenue += sen;
      const key = by === "product" ? `${code} ${str(l.productName)}`.trim() : by === "customer" ? str(l.customerName) : str(l.invoiceNo);
      const g = groups.get(key) ?? { revenue: 0, covered: 0, cost: 0, qty: 0, understated: false };
      g.revenue += sen;
      g.qty += qty;
      const c = costOf(code);
      if (c && c.sen > 0) {
        covered += sen;
        cost += c.sen * qty;
        g.covered += sen;
        g.cost += c.sen * qty;
        if (c.missing > 0) g.understated = true;
      } else noCost.set(code || "(no product code)", (noCost.get(code || "(no product code)") ?? 0) + sen);
      groups.set(key, g);
    },
    totals() {
      const gp = covered - cost;
      return { revenueRm: rm(revenue), revenueWithCostRm: rm(covered), costRm: costs ? rm(cost) : null, grossProfitRm: costs ? rm(gp) : null, marginPct: costs && covered > 0 ? r1((gp / covered) * 100) : null };
    },
    groups,
    noCost,
  };
}

/**
 * GP for a period: invoice lines (GET /api/invoices/line-summary?from&to —
 * selling price) against each product's BOM cost (GET
 * /api/product-costing/summary — labour + priced materials, first fabric
 * tier). `costs` null = the person may not see costing: revenue only.
 */
export function summariseGrossProfit(by: GpBy, p: Period, lines: unknown, prevLines: unknown, costSummary: unknown) {
  const costs = costSummary === null || costSummary === undefined ? null : obj(obj(costSummary).data ?? costSummary);
  const costHidden = !!costs && Object.values(costs).length > 0 && !Object.values(costs).some((c) => "totalSen" in obj(c));
  const cs = costHidden ? null : costs;
  const cur = gpOf(cs);
  for (const l of listRows(lines)) cur.add(by, l);
  const out: Obj = {
    by,
    period: p.period,
    from: p.from,
    to: p.to,
    note: "Money in RM. Revenue = invoice lines dated in the period (cancelled invoices left out). Cost = today's BOM costing of the product (labour + materials with a price, fabric at the first price tier) × quantity — a standard cost, not the actual cost at the time. GP and margin count only lines whose product has a cost; products without a BOM cost are listed under noCost. Invoice lines carry no sales-order number, so GP per document is per invoice.",
    ...cur.totals(),
  };
  if (!cs) out.costHidden = "Product costs are hidden for this person (costing / product pricing permission), so only revenue is shown.";
  if (prevLines !== null && prevLines !== undefined) {
    const pv = gpOf(cs);
    for (const l of listRows(prevLines)) pv.add(by, l);
    const t = pv.totals();
    const c = cur.totals();
    out.previousPeriod = { from: p.prev.from, to: p.prev.to, ...t, revenueChangePct: pctChange(c.revenueRm, t.revenueRm), grossProfitChangePct: c.grossProfitRm !== null && t.grossProfitRm !== null ? pctChange(c.grossProfitRm, t.grossProfitRm) : null };
  }
  const rows = [...cur.groups.entries()].map(([name, g]) => ({
    [by]: name,
    revenueRm: rm(g.revenue),
    ...(by === "product" ? { qty: r1(g.qty) } : {}),
    costRm: cs ? rm(g.cost) : null,
    grossProfitRm: cs ? rm(g.covered - g.cost) : null,
    marginPct: cs && g.covered > 0 ? r1(((g.covered - g.cost) / g.covered) * 100) : null,
    ...(g.covered < g.revenue ? { partlyWithoutCost: true } : {}),
    ...(g.understated ? { costUnderstated: true } : {}),
  }));
  out.top = rows.sort((a, b) => num(b.revenueRm) - num(a.revenueRm)).slice(0, TOP);
  if (cs) out.lowestMargin = rows.filter((r) => r.marginPct !== null).sort((a, b) => num(a.marginPct) - num(b.marginPct)).slice(0, 5);
  out.noCost = [...cur.noCost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([product, sen]) => ({ product, revenueRm: rm(sen) }));
  return out;
}

// ── K10 production_lead_time ────────────────────────────────────────────────

/**
 * Days from a production order's start date to its completed date, per
 * product, over orders completed in the period (GET
 * /api/production-orders?status=COMPLETED&fields=minimal&include=none, newest
 * pages). Median and average; the period before for comparison.
 */
export function summariseLeadTimes(rows: Obj[], p: Period, query: string, truncated: boolean) {
  const k = lc(query);
  const want = (r: Obj) => !k || lc(r.productCode) === k || lc(r.productCode).includes(k) || lc(r.productName).includes(k);
  const days = (r: Obj) => {
    const s = ymd(r.startDate);
    const e = ymd(r.completedDate);
    return s && e && e >= s ? daysBetween(s, e) : null;
  };
  const inWin = (r: Obj, f: string, t: string) => ymd(r.completedDate) >= f && ymd(r.completedDate) <= t;
  const cur = rows.filter((r) => want(r) && inWin(r, p.from, p.to) && days(r) !== null);
  const prev = rows.filter((r) => want(r) && inWin(r, p.prev.from, p.prev.to) && days(r) !== null);
  const by = new Map<string, { name: string; cat: string; d: number[] }>();
  for (const r of cur) {
    const code = str(r.productCode);
    const g = by.get(code) ?? { name: str(r.productName), cat: str(r.itemCategory), d: [] };
    g.d.push(days(r) as number);
    by.set(code, g);
  }
  const all = cur.map((r) => days(r) as number);
  const pall = prev.map((r) => days(r) as number);
  return {
    period: p.period,
    from: p.from,
    to: p.to,
    ...(query ? { query } : {}),
    note: "Lead time = days from the production order's start date to its completed date, over orders completed in the period. Median is the typical order; average is pulled up by slow ones.",
    ordersCompleted: cur.length,
    medianDays: median(all),
    averageDays: avg(all),
    previousPeriod: { from: p.prev.from, to: p.prev.to, ordersCompleted: prev.length, medianDays: median(pall), averageDays: avg(pall) },
    byProduct: [...by.entries()]
      .map(([code, g]) => ({ product: `${code} ${g.name}`.trim(), category: g.cat || null, orders: g.d.length, medianDays: median(g.d), averageDays: avg(g.d), slowestDays: Math.max(...g.d), fastestDays: Math.min(...g.d) }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 20),
    ...(truncated ? { cut: "Only the newest completed production orders were read; an older period may be incomplete." } : {}),
  };
}

// ── K12 delivery_schedule (deliveries_due, extended) ────────────────────────

export type DeliveryRange = "today" | "week" | "next_week";

/** Delivery orders past their delivery date and still not delivered (the overdue half of the schedule). */
export function overdueDeliveries(dos: unknown, today: string, origin: string) {
  const late = listRows(dos)
    .filter((r) => ymd(r.deliveryDate) && ymd(r.deliveryDate) < today)
    .sort((a, b) => ymd(a.deliveryDate).localeCompare(ymd(b.deliveryDate)));
  return {
    count: late.length,
    oldest: late.slice(0, TOP).map((r) => ({
      do: str(r.doNo),
      customer: str(r.customerName),
      date: ymd(r.deliveryDate),
      daysLate: daysBetween(ymd(r.deliveryDate), today),
      status: str(r.status),
      url: `${origin}/delivery/${enc(str(r.id))}`,
    })),
  };
}

// ── company_report ──────────────────────────────────────────────────────────

export type ReportPeriod = "month" | "quarter" | "year";
const YM = /^\d{4}-\d{2}$/;

/** Months of the report and of the period before it. Anchor default = last closed month. */
export function reportMonths(period: ReportPeriod, anchorRaw: unknown, today: string): { months: string[]; prevMonths: string[]; label: string } {
  const lastClosed = shiftMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const a = YM.test(str(anchorRaw)) && str(anchorRaw) <= today.slice(0, 7) ? str(anchorRaw) : lastClosed;
  const span = (from: string, to: string) => {
    const out: string[] = [];
    for (let c = from; c <= to; c = shiftMonths(`${c}-01`, 1).slice(0, 7)) out.push(c);
    return out;
  };
  const sh = (ym: string, n: number) => shiftMonths(`${ym}-01`, n).slice(0, 7);
  if (period === "month") return { months: [a], prevMonths: [sh(a, -1)], label: a };
  if (period === "quarter") {
    const m = Number(a.slice(5, 7));
    const q = Math.floor((m - 1) / 3);
    const qs = `${a.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}`;
    const qe = sh(qs, 2) > a ? a : sh(qs, 2);
    return { months: span(qs, qe), prevMonths: span(sh(qs, -3), sh(qe, -3)), label: `${a.slice(0, 4)}-Q${q + 1}${qe < sh(qs, 2) ? " to date" : ""}` };
  }
  const ys = `${a.slice(0, 4)}-01`;
  return { months: span(ys, a), prevMonths: span(sh(ys, -12), sh(a, -12)), label: `${a.slice(0, 4)} (Jan to ${a})` };
}

const SLICE_KEYS = ["sales", "cogs", "materials", "labour", "overhead", "stockMovement", "gross", "otherIncome", "expenses", "staffCost", "otherOpex", "net"] as const;

function sumMonths(rows: Obj[], months: string[]) {
  const got = rows.filter((r) => months.includes(str(r.key)) && r.actual);
  const t: Record<string, number> = {};
  for (const k of SLICE_KEYS) t[k] = got.reduce((s, r) => s + num(obj(r.actual)[k]), 0);
  const cf = { operating: 0, investing: 0, financing: 0, net: 0 };
  let cfSeen = false;
  let prod = 0;
  let prodSeen = false;
  for (const r of got) {
    if (r.cashFlow) {
      cfSeen = true;
      for (const k of Object.keys(cf) as (keyof typeof cf)[]) cf[k] += num(obj(r.cashFlow)[k]);
    }
    if (r.productionRevenue) {
      prodSeen = true;
      prod += num(obj(r.productionRevenue).total);
    }
  }
  const last = [...got].sort((x, y) => str(x.key).localeCompare(str(y.key))).at(-1);
  return { got: got.map((r) => str(r.key)), t, cf: cfSeen ? cf : null, prod: prodSeen ? prod : null, last: last ?? null, estimated: got.some((r) => num(obj(r.actual).estimated) > 0 || r.partial === true) };
}

/**
 * The management report for a month / quarter / year from the Finance
 * dashboard's own monthly figures (GET /api/accounting/dashboard — the same
 * rows the Board Report is built from: P&L lines, cash flow, balance sheet,
 * production revenue, headcount) and the AR / AP ageing (GET
 * /api/accounting/aging), against the period before. Both need accounting:read.
 */
export function summariseCompanyReport(period: ReportPeriod, m: { months: string[]; prevMonths: string[]; label: string }, dash: unknown, aging: unknown) {
  const rows = arr(obj(obj(dash).data ?? dash).rows);
  const cur = sumMonths(rows, m.months);
  const prev = sumMonths(rows, m.prevMonths);
  const R = (x: number) => rm(x);
  const pl = (s: typeof cur) => ({
    revenueRm: R(s.t.sales),
    costOfSalesRm: R(s.t.cogs),
    grossProfitRm: R(s.t.gross),
    grossMarginPct: s.t.sales ? r1((s.t.gross / s.t.sales) * 100) : null,
    costs: { rawMaterialsRm: R(s.t.materials), directLabourRm: R(s.t.labour), factoryOverheadRm: R(s.t.overhead), stockMovementRm: R(s.t.stockMovement), staffCostRm: R(s.t.staffCost), otherOperatingRm: R(s.t.otherOpex) },
    otherIncomeRm: R(s.t.otherIncome),
    expensesRm: R(s.t.expenses),
    netProfitRm: R(s.t.net),
    netMarginPct: s.t.sales ? r1((s.t.net / s.t.sales) * 100) : null,
  });
  const bsOf = (s: typeof cur) => {
    const b = s.last ? obj(s.last.balanceSheet) : {};
    return Object.keys(b).length
      ? { asAt: str(s.last?.key), assetsRm: R(num(b.assets)), liabilitiesRm: R(num(b.liabilities)), equityRm: R(num(b.equity)), inventoryRm: R(num(b.inventory)), currentRatio: num(b.currentLiabilities) ? r2(num(b.currentAssets) / num(b.currentLiabilities)) : null }
      : null;
  };
  const head = (s: typeof cur) => {
    const h = s.last ? obj(s.last.labourBase).headcount : null;
    return h === null || h === undefined ? null : num(h);
  };
  const a = obj(obj(aging).data ?? aging);
  const buckets = ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"];
  const owed = (xs: Obj[]) => R(xs.reduce((t, r) => t + buckets.reduce((u, b) => u + num(r[b]), 0), 0));
  const over60 = (xs: Obj[]) => R(xs.reduce((t, r) => t + num(r.days60Sen) + num(r.days90Sen) + num(r.over90Sen), 0));
  const c = pl(cur);
  const p = pl(prev);
  const missing = m.months.filter((x) => !cur.got.includes(x));
  return {
    period,
    label: m.label,
    months: m.months,
    previousMonths: m.prevMonths,
    note: "Money in RM, from the Finance dashboard's monthly ledger figures (the source of the Board Report): revenue, cost of sales and gross profit, costs by type, net profit, cash flow and the balance sheet at the last month. AR / AP = what customers owe us and what we owe suppliers today (Accounting ageing). Production = production revenue (value of orders finished). Headcount = active workers at the last month.",
    ...(missing.length ? { monthsWithoutFigures: missing } : {}),
    ...(cur.estimated ? { estimated: "A month in this period is still running or carries estimated recurring costs; its figures will move." } : {}),
    profitAndLoss: c,
    previousPeriod: p,
    change: {
      revenuePct: pctChange(c.revenueRm, p.revenueRm),
      grossProfitPct: pctChange(c.grossProfitRm, p.grossProfitRm),
      netProfitPct: pctChange(c.netProfitRm, p.netProfitRm),
      grossMarginPts: c.grossMarginPct !== null && p.grossMarginPct !== null ? r1(c.grossMarginPct - p.grossMarginPct) : null,
    },
    cashFlow: cur.cf ? { operatingRm: R(cur.cf.operating), investingRm: R(cur.cf.investing), financingRm: R(cur.cf.financing), netRm: R(cur.cf.net), previousNetRm: prev.cf ? R(prev.cf.net) : null } : null,
    balanceSheet: bsOf(cur),
    ...(Object.keys(a).length ? { receivablesNow: { owedToUsRm: owed(arr(a.ar)), over60DaysRm: over60(arr(a.ar)) }, payablesNow: { weOweRm: owed(arr(a.ap)), over60DaysRm: over60(arr(a.ap)) } } : {}),
    production: { productionRevenueRm: cur.prod === null ? null : R(cur.prod), previousRm: prev.prod === null ? null : R(prev.prod), changePct: cur.prod !== null && prev.prod !== null ? pctChange(cur.prod, prev.prod) : null },
    headcount: { now: head(cur), previous: head(prev) },
  };
}
