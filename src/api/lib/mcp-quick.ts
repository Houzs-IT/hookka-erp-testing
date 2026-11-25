// ---------------------------------------------------------------------------
// mcp-quick.ts — the AI Connector's quick answers (routes/mcp.ts sales_summary,
// production_summary). Owner 2026-11-25: searching felt slow — the AI walked
// list_modules → list_endpoints → erp_get and then read replies of 60,000+
// characters (production-revenue alone is cut at the cap). A quick answer is
// ONE tool call that reads the same endpoints the Dashboard reads, as the
// person (so their permissions apply), and returns a few hundred characters.
//
// Pure functions over the endpoints' JSON; money in, money out as RM (2 dp).
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);

/** Sen → RM, 2 dp. */
export const rm = (sen: unknown): number => Math.round(num(sen)) / 100;

/** Percent change, 1 dp; null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^(\d{4})(-(\d{2}|Q[1-4]))?$/;

/** "YYYY-MM" | "YYYY-Qn" | "YYYY", defaulting to the current Malaysia month. */
export function normalisePeriod(raw: unknown, today: string): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return PERIOD.test(s) ? s : today.slice(0, 7);
}

/** Today in Malaysia (UTC+8) as YYYY-MM-DD. */
export function myToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * The same days one month earlier, for a fair comparison: 1–25 Nov → 1–25 Oct.
 * Clamped to the end of the earlier month (31 Mar → 28/29 Feb).
 */
export function sameDaysPrevMonth(from: string, to: string): { from: string; to: string } {
  const shift = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  return { from: shift(from), to: shift(to) };
}

/** Validate a from/to range (YYYY-MM-DD, from <= to, at most 400 days). */
export function validRange(from: unknown, to: unknown): { from: string; to: string } | null {
  const f = String(from ?? "");
  const t = String(to ?? "");
  if (!YMD.test(f) || !YMD.test(t) || f > t) return null;
  if ((Date.parse(t) - Date.parse(f)) / 86_400_000 > 400) return null;
  return { from: f, to: t };
}

// ── sales ────────────────────────────────────────────────────────────────────

/** Sales answer from GET /api/dashboard/overview?period=… (the Dashboard's own numbers). */
export function summariseSales(ov: unknown, period: string) {
  const o = obj(ov);
  const monthly = arr(o.monthlyRevenue);
  const thisIdx = monthly.findIndex((m) => String(m.month) === period);
  const prev = thisIdx > 0 ? monthly[thisIdx - 1] : null;
  const sales = num(o.salesThisMonthSen);
  const aov = obj(o.aovCompany);
  const top = obj(o.topSellers);
  return {
    period,
    note: "Money in RM. Sales = sales orders + consignment orders by order date (same figure as the Dashboard).",
    salesOrdersRm: rm(sales),
    deliveredRm: rm(o.deliveredThisMonthSen),
    invoicedRm: rm(o.invoicesThisMonthSen),
    previousMonth: prev
      ? { month: String(prev.month), salesOrdersRm: rm(prev.salesOrderSen), changePct: pctChange(sales, num(prev.salesOrderSen)) }
      : null,
    unitsSold: { bedframeUnits: num(aov.bedframeUnits), sofaSets: num(aov.sofaSets) },
    averageOrderValueRm: { bedframe: rm(aov.bedframeAvgSen), sofaSet: rm(aov.sofaAvgSen) },
    byCustomer: arr(o.aovByCustomer)
      .map((c) => ({ customer: String(c.customerName ?? ""), salesRm: rm(c.totalSen), bedframeUnits: num(c.bedframeUnits), sofaSets: num(c.sofaSets) }))
      .sort((a, b) => b.salesRm - a.salesRm)
      .slice(0, 10),
    topBedframes: arr(top.BEDFRAME)
      .slice(0, 5)
      .map((p) => ({ product: `${String(p.productCode ?? "")} ${String(p.productName ?? "")}`.trim(), qty: num(p.qtySold), salesRm: rm(p.valueSen) })),
    topSofaModels: arr(top.SOFA)
      .slice(0, 5)
      .map((p) => ({ model: String(p.model ?? ""), sets: num(p.setsSold), salesRm: rm(p.valueSen) })),
    // "weeklyRevenue" is keyed by DAY (one row per date of the period).
    daily: arr(o.weeklyRevenue)
      .filter((d) => num(d.salesOrderSen) || num(d.invoiceSen))
      .map((d) => ({ date: String(d.week ?? ""), salesOrdersRm: rm(d.salesOrderSen), invoicedRm: rm(d.invoiceSen) })),
    trend: monthly.slice(-6).map((m) => ({ month: String(m.month), salesOrdersRm: rm(m.salesOrderSen), invoicedRm: rm(m.invoiceSen) })),
  };
}

// ── production ───────────────────────────────────────────────────────────────

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

/** Department revenue from production-revenue's byDeptCategory ("DEPT|CATEGORY" → sen). */
export function deptRevenue(byDeptCategory: unknown): { dept: string; rm: number; byCategoryRm: Record<string, number> }[] {
  const acc = new Map<string, { total: number; cats: Record<string, number> }>();
  for (const [key, sen] of Object.entries(obj(byDeptCategory))) {
    const [dept, cat = "OTHER"] = key.split("|");
    const e = acc.get(dept) ?? { total: 0, cats: {} };
    e.total += num(sen);
    e.cats[cat] = (e.cats[cat] ?? 0) + rm(sen);
    acc.set(dept, e);
  }
  return [...acc.entries()]
    .map(([dept, e]) => ({ dept: DEPT_NAMES[dept] ?? dept, rm: rm(e.total), byCategoryRm: e.cats }))
    .sort((a, b) => b.rm - a.rm);
}

/** Production revenue rows (one per finished item) rolled up by day and by product. */
function rollRows(rows: Obj[]) {
  const byDay = new Map<string, number>();
  const byProduct = new Map<string, { name: string; sen: number; qty: number }>();
  for (const r of rows) {
    const sen = num(r.totalPriceSen ?? r.totalSen ?? r.revenueSen);
    const d = String(r.date ?? "");
    if (d) byDay.set(d, (byDay.get(d) ?? 0) + sen);
    const code = String(r.productCode ?? "");
    if (code) {
      const p = byProduct.get(code) ?? { name: String(r.productName ?? ""), sen: 0, qty: 0 };
      p.sen += sen;
      p.qty += num(r.qty ?? r.quantity ?? 1);
      byProduct.set(code, p);
    }
  }
  return {
    daily: [...byDay.entries()].sort().map(([date, sen]) => ({ date, rm: rm(sen) })),
    topProducts: [...byProduct.entries()]
      .sort((a, b) => b[1].sen - a[1].sen)
      .slice(0, 5)
      .map(([code, p]) => ({ product: `${code} ${p.name}`.trim(), qty: p.qty, rm: rm(p.sen) })),
  };
}

/**
 * Production answer from GET /api/working-hour-entries/production-revenue for
 * the range and for the same days one month earlier, plus the Dashboard's
 * live production block (backlog, completed units, capacity) when given.
 */
export function summariseProduction(
  range: { from: string; to: string },
  cur: unknown,
  prevRange: { from: string; to: string } | null,
  prev: unknown,
  overview: unknown,
) {
  const c = obj(obj(cur).data ?? cur);
  const p = obj(obj(prev).data ?? prev);
  const total = num(c.totalSen);
  const prevTotal = num(p.totalSen);
  const rolled = rollRows(arr(c.rows));
  const prod = obj(obj(overview).production);
  const completed = arr(prod.completedLast7).filter((d) => String(d.date ?? "") >= range.from && String(d.date ?? "") <= range.to);
  const capacity = arr(prod.capacityDays).filter((d) => String(d.date ?? "") >= range.from && String(d.date ?? "") <= range.to);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);
  return {
    from: range.from,
    to: range.to,
    note: "Money in RM. Production revenue = the value of orders whose last Upholstery card finished in the range; department revenue books an order's full value on the day that department's last card for it closed (same rules as the Dashboard).",
    productionRevenueRm: rm(total),
    byCategoryRm: { sofa: rm(c.SOFA), bedframe: rm(c.BEDFRAME), accessory: rm(c.ACCESSORY) },
    sameDaysLastMonth: prevRange
      ? { from: prevRange.from, to: prevRange.to, productionRevenueRm: rm(prevTotal), changePct: pctChange(total, prevTotal) }
      : null,
    byDepartment: deptRevenue(c.byDeptCategory),
    daily: rolled.daily,
    topProducts: rolled.topProducts,
    ...(completed.length
      ? {
          unitsCompleted: {
            bedframeUnits: completed.reduce((s, d) => s + num(d.bedframeUnits), 0),
            sofaSets: completed.reduce((s, d) => s + num(d.sofaSets), 0),
          },
        }
      : {}),
    ...(capacity.length
      ? {
          workforce: {
            avgWorkersPerDay: avg(capacity.map((d) => num(d.workers))),
            outsourceMinutes: capacity.reduce((s, d) => s + num(d.outsourceMinutes), 0),
            totalMinutes: capacity.reduce((s, d) => s + num(d.minutes), 0),
          },
        }
      : {}),
    ...(Object.keys(prod).length
      ? {
          backlogNow: {
            days: num(prod.backlogDays),
            activeBedframeUnits: num(obj(prod.activeJobs).bedframeUnits),
            activeSofaSets: num(obj(prod.activeJobs).sofaSets),
            slowestDepartments: arr(prod.backlogByDept)
              .slice(0, 3)
              .map((d) => ({ dept: String(d.dept ?? ""), backlogDays: num(d.backlogDays) })),
          },
        }
      : {}),
  };
}

/** Keep only the named keys at every object level (rows stay rows). Empty list = unchanged. */
export function pickFields(v: unknown, fields: string[]): unknown {
  if (!fields.length) return v;
  const keep = new Set(fields);
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 20) return x;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x && typeof x === "object") {
      const out: Obj = {};
      for (const [k, val] of Object.entries(x as Obj)) {
        if (keep.has(k)) out[k] = val;
        else if (val && typeof val === "object") {
          const inner = walk(val, depth + 1);
          if (inner && typeof inner === "object" && Object.keys(inner as Obj).length) out[k] = inner;
        }
      }
      return out;
    }
    return x;
  };
  return walk(v, 0);
}

// ── search / fetch (the shape ChatGPT requires) ─────────────────────────────
// ChatGPT outside Developer Mode only accepts a connector with a `search` and a
// `fetch` tool, and deep research uses only those two: search returns
// {results:[{id,title,url}]}, fetch returns one {id,title,text,url,metadata}.

/** Search kind → its detail endpoint (fetch reads the document there). */
export const FETCH_API: Record<string, string> = {
  sales_order: "/api/sales-orders",
  service_order: "/api/sales-orders",
  delivery_order: "/api/delivery-orders",
  invoice: "/api/invoices",
  purchase_order: "/api/purchase-orders",
  purchase_invoice: "/api/purchase-invoices",
  grn: "/api/grn",
  production_order: "/api/production-orders",
  customer: "/api/customers",
  product: "/api/products",
  supplier: "/api/suppliers",
  service_case: "/api/service-cases",
  delivery_return: "/api/delivery-returns",
};

export type SearchHit = { id: string; title: string; url: string; text: string };

/** /api/search's grouped reply → flat ChatGPT results; id = "<kind>:<row id>". */
export function searchResults(body: unknown, origin: string): SearchHit[] {
  const groups = arr(obj(obj(body).data).groups);
  const out: SearchHit[] = [];
  for (const g of groups) {
    const kind = String(g.kind ?? "");
    for (const it of arr(g.items)) {
      const rid = String(it.id ?? "");
      if (!kind || !rid) continue;
      const href = String(it.href ?? "");
      const sub = Array.isArray(it.sub) ? (it.sub as unknown[]).map(String).filter(Boolean) : [];
      out.push({
        id: `${kind}:${rid}`,
        title: `${String(g.group ?? kind)}: ${String(it.label ?? rid)}`,
        url: href.startsWith("/") ? origin + href : href || origin,
        text: sub.join(" · "),
      });
    }
  }
  return out;
}

/** "sales_order:abc" → { kind, rowId } (null for anything else). */
export function parseFetchId(raw: unknown): { kind: string; rowId: string } | null {
  const m = /^([a-z_]{2,40}):([A-Za-z0-9._-]{1,80})$/.exec(String(raw ?? "").trim());
  return m ? { kind: m[1], rowId: m[2] } : null;
}

/** A readable title for a fetched document. */
export function docTitle(kind: string, doc: unknown): string {
  const d = obj(obj(doc).data ?? doc);
  const no = d.soNo ?? d.doNo ?? d.invoiceNo ?? d.poNo ?? d.piNo ?? d.grnNo ?? d.code ?? d.productCode ?? d.name ?? d.customerName ?? d.id;
  return `${kind.replace(/_/g, " ")} ${String(no ?? "")}`.trim();
}

// ── prompts (ready-made questions shown in the AI app) ──────────────────────

export const PROMPTS = [
  {
    name: "monthly_sales_review",
    title: "Monthly sales review",
    description: "Sales for a month: total vs last month, customers, top products, notable days.",
    arguments: [{ name: "period", description: "YYYY-MM (default this month)", required: false }],
  },
  {
    name: "production_vs_last_month",
    title: "Production vs last month",
    description: "Production revenue for a range against the same days last month, by department, with workforce and backlog.",
    arguments: [
      { name: "from", description: "YYYY-MM-DD (default 1st of this month)", required: false },
      { name: "to", description: "YYYY-MM-DD (default today)", required: false },
    ],
  },
  {
    name: "find_document",
    title: "Find a document",
    description: "Find a sales order, delivery order, invoice, PO or customer by number or name and summarise it.",
    arguments: [{ name: "number", description: "Document number, customer or product name", required: true }],
  },
];

/** The message a prompt expands to (prompts/get). Unknown name → null. */
export function promptText(name: string, a: Record<string, unknown>): string | null {
  const v = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : "");
  if (name === "monthly_sales_review") {
    return `Review our sales for ${v("period") || "this month"} using sales_summary. Give the total against last month (RM and %), the top customers and products, and anything unusual in the daily figures. Keep it short, in plain language.`;
  }
  if (name === "production_vs_last_month") {
    const range = v("from") && v("to") ? `from ${v("from")} to ${v("to")}` : "this month to date";
    return `Using production_summary, compare production revenue ${range} with the same days last month. Explain the change by department and by category, and relate it to workforce (workers, outsourcing) and the backlog. Plain language, short.`;
  }
  if (name === "find_document") {
    return `Find "${v("number")}" with search, open the best match with fetch, and summarise it: status, customer, items, amounts and dates. Give the ERP link.`;
  }
  return null;
}

// ── orders / receivables / materials (owner 2026-11-26: "快捷查询继续") ─────

/** Order backlog from /api/sales-orders/stats + the Dashboard's production block. */
export function summariseOrders(stats: unknown, overview: unknown) {
  const s = obj(stats);
  const byStatus = obj(s.byStatus);
  const rev = obj(s.revenueByStatus);
  const prod = obj(obj(overview).production);
  const overdue = arr(prod.activeJobsByMonth)
    .filter((r) => String(r.month) === "overdue")
    .map((r) => ({ customer: String(r.customer ?? ""), bedframeUnits: num(r.bedframeUnits), sofaSets: num(r.sofaSets) }))
    .filter((r) => r.bedframeUnits || r.sofaSets);
  const order = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED", "CANCELLED"];
  const idx = (st: string) => (order.includes(st) ? order.indexOf(st) : 99);
  const statuses = Object.keys(byStatus).sort((a, b) => idx(a) - idx(b));
  return {
    note: "Money in RM. Counts are sales orders (stock orders and service orders excluded, as on the Sales list).",
    byStatus: statuses.map((st) => ({ status: st, orders: num(byStatus[st]), rm: rm(rev[st]) })),
    inProductionRm: rm(rev.IN_PRODUCTION),
    readyToShipRm: rm(rev.READY_TO_SHIP),
    notYetDeliveredRm: rm(s.outstandingItemsSen),
    ...(Object.keys(prod).length
      ? {
          production: {
            backlogDays: num(prod.backlogDays),
            activeBedframeUnits: num(obj(prod.activeJobs).bedframeUnits),
            activeSofaSets: num(obj(prod.activeJobs).sofaSets),
            overdueByCustomer: overdue,
          },
        }
      : {}),
  };
}

/** Debtor ageing from /api/accounting/aging (the AR half only). */
export function summariseReceivables(aging: unknown) {
  const ar = arr(obj(obj(aging).data ?? aging).ar);
  const buckets = ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"] as const;
  const total = (r: Obj) => buckets.reduce((t, b) => t + num(r[b]), 0);
  const sum = (b: (typeof buckets)[number]) => ar.reduce((t, r) => t + num(r[b]), 0);
  const oldest = ar
    .flatMap((r) => arr(r.docs).map((d) => ({ customer: String(r.customerName ?? ""), invoice: String(d.no ?? ""), date: String(d.date ?? ""), months: num(d.mo), rm: rm(d.amountSen) })))
    .filter((d) => d.months >= 2 && d.rm > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);
  return {
    note: "Money in RM. Ageing by invoice month (current = this month, 30 = last month, …), same as Accounting › Debtor Aging.",
    totalOwedRm: rm(ar.reduce((t, r) => t + total(r), 0)),
    byAgeRm: { current: rm(sum("currentSen")), days30: rm(sum("days30Sen")), days60: rm(sum("days60Sen")), days90: rm(sum("days90Sen")), over90: rm(sum("over90Sen")) },
    customers: ar
      .map((r) => ({
        customer: String(r.customerName ?? ""),
        owedRm: rm(total(r)),
        over60Rm: rm(num(r.days60Sen) + num(r.days90Sen) + num(r.over90Sen)),
        invoices: arr(r.docs).length,
      }))
      .filter((c) => c.owedRm)
      .sort((a, b) => b.owedRm - a.owedRm)
      .slice(0, 10),
    oldestUnpaid: oldest,
  };
}

/** Material shortages from /api/mrp/plan (the MRP page's own calculation). */
export function summariseShortages(plan: unknown) {
  const p = obj(obj(plan).data ?? plan);
  const mats = arr(p.materials);
  const short = mats.filter((m) => num(m.short) > 0).sort((a, b) => String(a.firstNeedBy ?? "9").localeCompare(String(b.firstNeedBy ?? "9")) || num(b.short) - num(a.short));
  const po = obj(p.productionOrders);
  return {
    note: "Short = needed by open production orders − stock − open PO quantity (the MRP page's rule). Sorted by the date first needed.",
    calculatedAt: String(p.calculatedAt ?? ""),
    materialsShort: short.length,
    materialsPlanned: mats.length,
    shortages: short.slice(0, 15).map((m) => ({
      code: String(m.code ?? ""),
      description: String(m.description ?? ""),
      uom: String(m.uom ?? ""),
      short: num(m.short),
      needed: num(m.needed),
      stock: num(m.stock),
      onOrder: num(m.poOutstanding),
      firstNeedBy: String(m.firstNeedBy ?? ""),
      mainSupplier: m.mainSupplier ? String(m.mainSupplier) : null,
      ordersAffected: arr(m.orders).length,
    })),
    productionOrders: { open: num(po.open), withoutBom: num(po.noBom) },
    bomLinesNotMapped: arr(p.unresolved).length,
  };
}
