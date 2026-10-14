// ---------------------------------------------------------------------------
// overview-trend.ts (pure) — the Finance Overview, month by month (owner
// 2026-10-14 「overview 主要显示…」→「做」): sales orders vs sales invoices, gross
// and net profit, raw-material and direct-labour cost as a share of sales, and
// the most-produced models (top 5, Sofa and Bedframe apart, a model's variants
// counted together). The P&L figures are the P&L page's own (computePnlWindow);
// nothing here derives a figure the statement does not show. Shared by the
// /overview-trend route (builds it) and the Overview tab (draws it).
// ---------------------------------------------------------------------------
import type { PnlWindowLike } from "./pnl-matrix";
import { acctName } from "./finance-names";

export type DocSum = { count: number; sen: number };
export type ModelQty = { model: string; qty: number; orders: number };
export type TopModels = { SOFA: ModelQty[]; BEDFRAME: ModelQty[] };

/** One month of the P&L, broken down the way the Overview explains it. */
export type OverviewPnl = {
  netSalesSen: number;
  cogsSen: number;
  grossProfitSen: number;
  otherIncomeSen: number;
  expenseSen: number;
  netProfitSen: number;
  rm: {
    openingSen: number; purchasesSen: number; closingSen: number; usedSen: number;
    /** Each material group's use (opening + purchases − closing), largest first. */
    groups: { name: string; usedSen: number }[];
  };
  labourSen: number;
  /** The running month's estimated costs inside the figures (owner 2026-10-13) … */
  estSen: number;
  /** … of which factory overhead — the part inside cost of goods sold, so gross profit. */
  estOverheadSen: number;
};

export type OverviewMonth = {
  ym: string;
  /** The month is still running (figures so far; costs may include estimates). */
  running: boolean;
  /** Sales orders raised in the month, before SST (an order carries none). */
  so: DocSum;
  /** Sales invoices issued in the month, before SST. */
  inv: DocSum;
  /** null = a month before the books opened with no history keyed for it. */
  pnl: OverviewPnl | null;
  top: TopModels;
};

export const TOP_MODELS = 5;

/** A model's series: "1003(A)(HF)(W)" → "1003", "2038(A)-(SK)" → "2038" (owner: variants count together). */
export function modelSeries(model: string | null | undefined): string {
  const s = String(model ?? "").trim();
  const cut = s.indexOf("(");
  return (cut > 0 ? s.slice(0, cut) : s).trim().replace(/[-\s]+$/, "");
}

/** The `n` months ending with `endYm`, oldest first. */
export function lastMonths(endYm: string, n: number): string[] {
  const [y, m] = endYm.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return out;
}

/** Documents counted and summed per month (only the months asked for). */
export function sumByMonth(docs: { ym: string; sen: number }[], months: string[]): Map<string, DocSum> {
  const out = new Map<string, DocSum>(months.map((ym) => [ym, { count: 0, sen: 0 }]));
  for (const d of docs) {
    const s = out.get(d.ym);
    if (!s) continue;
    s.count += 1;
    s.sen += Math.round(Number(d.sen) || 0);
  }
  return out;
}

/**
 * The most-produced models per month: production orders completed in the
 * month, quantities added up per model series, Sofa and Bedframe apart; ties
 * by name so the order is stable. Service charges are not goods.
 */
export function topModelsByMonth(
  orders: { ym: string; category: string | null; model: string | null; qty: number }[],
  months: string[],
  n: number = TOP_MODELS,
): Map<string, TopModels> {
  const acc = new Map<string, { SOFA: Map<string, ModelQty>; BEDFRAME: Map<string, ModelQty> }>(
    months.map((ym) => [ym, { SOFA: new Map(), BEDFRAME: new Map() }]),
  );
  for (const o of orders) {
    const m = acc.get(o.ym);
    if (!m) continue;
    const cat = String(o.category ?? "").toUpperCase();
    if (cat !== "SOFA" && cat !== "BEDFRAME") continue;
    const model = modelSeries(o.model);
    if (!model || /SERVICE\s*CHARGE/i.test(model)) continue;
    const bucket = m[cat];
    const cur = bucket.get(model) ?? { model, qty: 0, orders: 0 };
    cur.qty += Math.max(1, Number(o.qty) || 1);
    cur.orders += 1;
    bucket.set(model, cur);
  }
  const rank = (b: Map<string, ModelQty>) =>
    [...b.values()].sort((a, c) => c.qty - a.qty || a.model.localeCompare(c.model)).slice(0, n);
  return new Map([...acc].map(([ym, b]) => [ym, { SOFA: rank(b.SOFA), BEDFRAME: rank(b.BEDFRAME) }]));
}

/** A material group as the Overview names it: "PURCHASE - B.M FABRIC" → "B.M Fabric". */
export function materialName(description: string): string {
  return acctName(String(description ?? "").replace(/^\s*PURCHASES?\s*-\s*/i, "").trim());
}

/** The Overview's view of one month's P&L window — the statement's own totals, nothing re-derived. */
export function overviewPnl(w: PnlWindowLike): OverviewPnl {
  const rm: OverviewPnl["rm"] = { openingSen: 0, purchasesSen: 0, closingSen: 0, usedSen: Math.round(w.rmConsumedSen), groups: [] };
  for (const g of w.rmGroups) {
    rm.openingSen += Math.round(g.openingSen);
    rm.purchasesSen += Math.round(g.purchasesSen);
    rm.closingSen += Math.round(g.closingSen);
    const used = Math.round(g.openingSen + g.purchasesSen - g.closingSen);
    if (used !== 0) rm.groups.push({ name: materialName(g.description || g.group), usedSen: used });
  }
  rm.groups.sort((a, c) => c.usedSen - a.usedSen || a.name.localeCompare(c.name));
  const estOverheadSen = w.overheadLines.reduce((sum, l) => sum + (l.estSen ?? 0), 0);
  const estSen = estOverheadSen + w.expenseLines.reduce((sum, l) => sum + (l.estSen ?? 0), 0);
  return {
    netSalesSen: Math.round(w.netSalesSen),
    cogsSen: Math.round(w.cogsSen),
    grossProfitSen: Math.round(w.grossProfitSen),
    otherIncomeSen: Math.round(w.otherIncomeSen),
    expenseSen: Math.round(w.expenseSen),
    netProfitSen: Math.round(w.netProfitSen),
    rm,
    labourSen: Math.round(w.labourSen),
    estSen: Math.round(estSen),
    estOverheadSen: Math.round(estOverheadSen),
  };
}

// 1,234.56 for a note line (the boxes render amounts with <Amount>).
const fmtSen = (sen: number) => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A share of net sales in percent; null when there are no sales to divide by. */
export function shareOfSales(sen: number, netSalesSen: number): number | null {
  return netSalesSen > 0 ? (sen / netSalesSen) * 100 : null;
}

export type OverviewMetric = "orders" | "gp" | "np" | "rm" | "dl";

/** One line of "how this figure is made", shown on hover (chart and table alike). */
export type ExplainLine = { label: string; sen?: number; pct?: number | null; note?: string; total?: boolean };

/**
 * How a month's figure is made, in the statement's own terms (owner 2026-10-14
 * 「指向那个 amount 或 line 的话…显示这个 amount 的 detail 怎样来」). The lines
 * add up exactly: gross profit = net sales − cost of goods sold; net profit =
 * gross profit + other income − operating expenses; raw materials used =
 * opening + purchases − closing (computePnlWindow).
 */
export function explainMonth(m: OverviewMonth, metric: OverviewMetric): ExplainLine[] {
  if (metric === "orders") {
    return [
      { label: `Sales orders (${m.so.count})`, sen: m.so.sen },
      { label: `Sales invoices (${m.inv.count})`, sen: m.inv.sen },
      { label: "Invoiced, of the orders", pct: m.so.sen > 0 ? (m.inv.sen / m.so.sen) * 100 : null, total: true },
    ];
  }
  const p = m.pnl;
  if (!p) return [{ label: "No P&L for this month", note: "before the books opened" }];
  // Estimates: gross profit carries the factory overhead ones only (they sit in
  // cost of goods sold); net profit carries them all.
  const estNote = "recurring costs not recorded yet, at last month's amount";
  const estGp = p.estOverheadSen !== 0 ? [{ label: "incl. estimated factory overhead", sen: p.estOverheadSen, note: estNote }] : [];
  const est = p.estSen !== 0 ? [{ label: "incl. estimated costs", sen: p.estSen, note: estNote }] : [];
  if (metric === "gp") {
    return [
      { label: "Net sales", sen: p.netSalesSen },
      { label: "− Cost of goods sold", sen: -p.cogsSen },
      { label: "= Gross profit", sen: p.grossProfitSen, total: true },
      { label: "of sales", pct: shareOfSales(p.grossProfitSen, p.netSalesSen) },
      ...estGp,
    ];
  }
  if (metric === "np") {
    return [
      { label: "Gross profit", sen: p.grossProfitSen },
      { label: "+ Other income", sen: p.otherIncomeSen },
      { label: "− Operating expenses", sen: -p.expenseSen },
      { label: "= Net profit", sen: p.netProfitSen, total: true },
      { label: "of sales", pct: shareOfSales(p.netProfitSen, p.netSalesSen) },
      ...est,
    ];
  }
  if (metric === "rm") {
    // Owner 2026-10-14 「指的时候是每个 raw material 的 detail (包含 amount 和 percentage)」.
    return [
      ...p.rm.groups.map((g) => ({ label: g.name, sen: g.usedSen, pct: shareOfSales(g.usedSen, p.netSalesSen) })),
      {
        label: "= Raw materials used", sen: p.rm.usedSen, pct: shareOfSales(p.rm.usedSen, p.netSalesSen), total: true,
        note: `opening ${fmtSen(p.rm.openingSen)} + purchases ${fmtSen(p.rm.purchasesSen)} − closing ${fmtSen(p.rm.closingSen)}`,
      },
      { label: "Net sales", sen: p.netSalesSen },
    ];
  }
  return [
    { label: "Direct labour", sen: p.labourSen },
    { label: "÷ Net sales", sen: p.netSalesSen },
    { label: "= of sales", pct: shareOfSales(p.labourSen, p.netSalesSen), total: true },
  ];
}

/**
 * A chart axis with round ticks (0, 50k, 100k …), always through 0, with room
 * above the tallest bar and below the deepest loss for their labels.
 */
export function niceAxis(values: number[], padTop = 1.15, padBottom = 1.35): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  const hi = Math.max(0, ...finite) * padTop;
  const lo = Math.min(0, ...finite) * padBottom;
  if (hi === 0 && lo === 0) return { domain: [0, 1], ticks: [0, 1] };
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag;
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 1000; t += step) ticks.push(Math.round(t * 100) / 100);
  return { domain: [bottom, top], ticks };
}
