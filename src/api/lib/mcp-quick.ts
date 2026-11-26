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
  {
    name: "daily-brief",
    title: "What do I need to look at today?",
    description: "Your overdue and due-soon orders, mail waiting for you and approvals waiting for you, with links.",
    arguments: [],
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
  if (name === "daily-brief") {
    return "What do I need to look at today? Use daily_brief. Start with the most urgent (overdue first), give each item's link, and keep it short, in plain language. If a section says I don't have access, mention it in one line.";
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

// ── round 3 (owner 2026-11-26): inventory, purchasing, attendance, daily brief ─

const ymd = (v: unknown): string => String(v ?? "").slice(0, 10);

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when to < from. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The rows of a list reply: a bare array, {data: [...]}, {data: {rows}} or {rows}. */
export function listRows(body: unknown): Obj[] {
  if (Array.isArray(body)) return arr(body);
  const o = obj(body);
  if (Array.isArray(o.data)) return arr(o.data);
  const d = obj(o.data);
  for (const k of ["rows", "items", "results"]) if (Array.isArray(d[k])) return arr(d[k]);
  for (const k of ["rows", "items", "results"]) if (Array.isArray(o[k])) return arr(o[k]);
  return [];
}

/**
 * Stock levels from GET /api/inventory?buckets=rawMaterials (the Inventory
 * page's raw-material list) and, when readable, GET /api/inventory/fg-stock
 * (the page's finished-goods on-hand figure). Low = below its own minimum.
 */
export function summariseInventory(inv: unknown, fg: unknown) {
  const rms = arr(obj(obj(inv).data ?? inv).rawMaterials).filter((r) => r.isActive !== false);
  const bal = (r: Obj) => num(r.balanceQty);
  const line = (r: Obj) => ({
    code: String(r.itemCode ?? ""),
    description: String(r.description ?? ""),
    group: String(r.itemGroup ?? ""),
    uom: String(r.baseUOM ?? ""),
    balance: bal(r),
    min: num(r.minStock),
  });
  const negative = rms.filter((r) => bal(r) < 0).sort((a, b) => bal(a) - bal(b));
  const low = rms
    .filter((r) => num(r.minStock) > 0 && bal(r) >= 0 && bal(r) < num(r.minStock))
    .sort((a, b) => bal(a) / num(a.minStock) - bal(b) / num(b.minStock));
  const zero = rms.filter((r) => bal(r) === 0).length;
  const lowByGroup: Record<string, number> = {};
  for (const r of low) {
    const g = String(r.itemGroup ?? "") || "Other";
    lowByGroup[g] = (lowByGroup[g] ?? 0) + 1;
  }
  const fgD = obj(obj(fg).data ?? fg);
  const fgRows = [...arr(fgD.counts), ...arr(fgD.dyn)];
  return {
    note: "Raw materials from the Inventory page. Low = below the item's own minimum stock (items with no minimum are never low). Negative = more issued than received: a stock count or a missing GRN.",
    rawMaterials: {
      active: rms.length,
      negative: negative.length,
      belowMinimum: low.length,
      zero,
      belowMinimumByGroup: lowByGroup,
      mostNegative: negative.slice(0, 10).map(line),
      lowest: low.slice(0, 15).map(line),
    },
    ...(Object.keys(fgD).length
      ? {
          finishedGoods: {
            productsWithStock: fgRows.filter((r) => num(r.stockQty) > 0).length,
            unitsInStock: fgRows.reduce((s, r) => s + num(r.stockQty), 0),
            unitsReserved: fgRows.reduce((s, r) => s + num(r.reservedQty), 0),
          },
        }
      : {}),
  };
}

const PO_DONE = ["RECEIVED", "CLOSED", "CANCELLED"];
const PO_AWAITING = ["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"];

/** A purchase order still to be received (the Procurement page's rule, incl. billed-in-full). */
const poOpen = (p: Obj) => !PO_DONE.includes(String(p.status ?? "")) && p.deliveredInFull !== true;

/**
 * Purchasing from GET /api/purchase-orders/stats (every PO header, the list
 * page's widgets) and, when readable, GET /api/grn/stats (receipts still on
 * their way). Overdue = the page's isOverdue: expected date before today,
 * not received / closed / cancelled / billed in full.
 */
export function summarisePurchasing(poStats: unknown, grnStats: unknown, today: string, origin: string, view: PurchasingView = "overview", days = 90) {
  const pos = listRows(poStats);
  const open = pos.filter(poOpen);
  const byStatus: Record<string, { orders: number; rm: number }> = {};
  for (const p of open) {
    const st = String(p.status ?? "");
    const e = byStatus[st] ?? { orders: 0, rm: 0 };
    e.orders += 1;
    e.rm = Math.round((e.rm + rm(p.totalSen)) * 100) / 100;
    byStatus[st] = e;
  }
  const line = (p: Obj) => ({
    poNo: String(p.poNo ?? ""),
    supplier: String(p.supplierName ?? ""),
    status: String(p.status ?? ""),
    expected: ymd(p.expectedDate),
    rm: rm(p.totalSen),
    link: `${origin}/procurement/${encodeURIComponent(String(p.id ?? ""))}`,
  });
  const byExpected = (a: Obj, b: Obj) => ymd(a.expectedDate).localeCompare(ymd(b.expectedDate));
  const overdue = open.filter((p) => ymd(p.expectedDate) && ymd(p.expectedDate) < today).sort(byExpected);
  const awaiting = open.filter((p) => PO_AWAITING.includes(String(p.status ?? "")));
  const next7 = open.filter((p) => ymd(p.expectedDate) >= today && ymd(p.expectedDate) <= addDays(today, 7)).sort(byExpected);
  const bySupplier = new Map<string, number>();
  for (const p of overdue) bySupplier.set(String(p.supplierName ?? ""), (bySupplier.get(String(p.supplierName ?? "")) ?? 0) + 1);
  const grns = listRows(grnStats).filter((g) => String(g.status ?? "") === "DRAFT");
  const arrival: Record<string, number> = {};
  for (const g of grns) {
    const a = String(g.arrival_state ?? g.arrivalState ?? "UNKNOWN");
    arrival[a] = (arrival[a] ?? 0) + 1;
  }
  const sumRm = (xs: Obj[]) => rm(xs.reduce((s, p) => s + num(p.totalSen), 0));
  const overdueBlock = (top: number) => ({
    count: overdue.length,
    rm: sumRm(overdue),
    bySupplier: [...bySupplier.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([supplier, orders]) => ({ supplier, orders })),
    oldest: overdue.slice(0, top).map((p) => ({ ...line(p), daysLate: daysBetween(ymd(p.expectedDate), today) })),
  });
  const note = "Money in RM. Open = not received, closed, cancelled or billed in full (the Procurement page's rule). Awaiting GRN = submitted, confirmed or partly received.";

  if (view === "overdue") return { view, note, overdue: overdueBlock(15) };

  if (view === "awaiting") {
    const partly = (p: Obj) => (String(p.status) === "PARTIAL_RECEIVED" ? 0 : 1);
    const list = awaiting.slice().sort((a, b) => partly(a) - partly(b) || byExpected(a, b));
    return {
      view,
      note,
      awaitingGrn: {
        count: awaiting.length,
        partlyReceived: awaiting.filter((p) => String(p.status) === "PARTIAL_RECEIVED").length,
        rm: sumRm(awaiting),
        orders: list.slice(0, 20).map((p) => ({ ...line(p), late: !!ymd(p.expectedDate) && ymd(p.expectedDate) < today })),
      },
      ...(grnStats !== null && grnStats !== undefined ? { draftGrns: { count: grns.length, byArrivalState: arrival } } : {}),
    };
  }

  if (view === "suppliers") {
    const since = addDays(today, -Math.max(1, Math.min(400, days)));
    const received = pos.filter((p) => ["RECEIVED", "CLOSED"].includes(String(p.status ?? "")) && ymd(p.receivedDate) >= since && ymd(p.receivedDate) <= today && ymd(p.expectedDate));
    const acc = new Map<string, { received: number; late: number; daysLate: number; openOverdue: number }>();
    const get = (n: string) => acc.get(n) ?? { received: 0, late: 0, daysLate: 0, openOverdue: 0 };
    for (const p of received) {
      const n = String(p.supplierName ?? "");
      const e = get(n);
      e.received += 1;
      const late = daysBetween(ymd(p.expectedDate), ymd(p.receivedDate));
      if (late > 0) {
        e.late += 1;
        e.daysLate += late;
      }
      acc.set(n, e);
    }
    for (const p of overdue) {
      const n = String(p.supplierName ?? "");
      const e = get(n);
      e.openOverdue += 1;
      acc.set(n, e);
    }
    const suppliers = [...acc.entries()]
      .map(([supplier, e]) => ({
        supplier,
        receivedOrders: e.received,
        deliveredLate: e.late,
        onTimePct: e.received ? Math.round(((e.received - e.late) / e.received) * 100) : null,
        avgDaysLate: e.late ? Math.round((e.daysLate / e.late) * 10) / 10 : 0,
        overdueNow: e.openOverdue,
      }))
      .filter((x) => x.deliveredLate || x.overdueNow)
      .sort((a, b) => b.deliveredLate + b.overdueNow - (a.deliveredLate + a.overdueNow) || b.avgDaysLate - a.avgDaysLate)
      .slice(0, 15);
    return {
      view,
      from: since,
      to: today,
      note: "Late = the PO's received date after its expected date (POs received in the window). Overdue now = still open past its expected date. Avg days late counts only late deliveries.",
      receivedOrdersInWindow: received.length,
      deliveredLateInWindow: received.filter((p) => daysBetween(ymd(p.expectedDate), ymd(p.receivedDate)) > 0).length,
      suppliers,
    };
  }

  return {
    view: "overview",
    note,
    openOrders: open.length,
    openRm: sumRm(open),
    byStatus,
    overdue: overdueBlock(5),
    awaitingGrn: { count: awaiting.length, rm: sumRm(awaiting) },
    expectedNext7Days: { count: next7.length, first: next7.slice(0, 5).map(line) },
    ...(grnStats !== null && grnStats !== undefined ? { draftGrns: { count: grns.length, byArrivalState: arrival } } : {}),
  };
}

export type PurchasingView = "overview" | "overdue" | "awaiting" | "suppliers";
export const PURCHASING_VIEWS: PurchasingView[] = ["overview", "overdue", "awaiting", "suppliers"];

/**
 * What we owe suppliers, from GET /api/accounting/aging (the AP half, same as
 * Accounting › Creditor Aging; accounting:read, so money follows the ERP's
 * finance permission). Ageing is the ERP's own: by invoice month.
 */
export function summarisePayables(aging: unknown, today: string) {
  const ap = arr(obj(obj(aging).data ?? aging).ap);
  const buckets = ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"] as const;
  const total = (r: Obj) => buckets.reduce((t, b) => t + num(r[b]), 0);
  const sum = (b: (typeof buckets)[number]) => ap.reduce((t, r) => t + num(r[b]), 0);
  const weekEnd = addDays(today, 7);
  const docs = ap.flatMap((r) =>
    arr(r.docs).map((d) => ({ supplier: String(r.supplierName ?? ""), invoice: String(d.no ?? ""), date: ymd(d.date), due: ymd(d.due), rm: rm(d.amountSen) })),
  ).filter((d) => d.rm > 0);
  const pastDue = docs.filter((d) => d.due && d.due < today).sort((a, b) => a.due.localeCompare(b.due));
  const dueThisWeek = docs.filter((d) => d.due && d.due >= today && d.due <= weekEnd).sort((a, b) => a.due.localeCompare(b.due));
  const sumDocs = (xs: { rm: number }[]) => Math.round(xs.reduce((s, d) => s + d.rm, 0) * 100) / 100;
  return {
    note: "Money in RM. Unpaid supplier invoices, aged by invoice month (current = this month, 30 = last month, …), same as Accounting › Creditor Aging. Due dates are the purchase invoices' own.",
    totalOwedRm: rm(ap.reduce((t, r) => t + total(r), 0)),
    byAgeRm: { current: rm(sum("currentSen")), days30: rm(sum("days30Sen")), days60: rm(sum("days60Sen")), days90: rm(sum("days90Sen")), over90: rm(sum("over90Sen")) },
    pastDue: { invoices: pastDue.length, rm: sumDocs(pastDue), oldest: pastDue.slice(0, 5) },
    dueNext7Days: { invoices: dueThisWeek.length, rm: sumDocs(dueThisWeek), first: dueThisWeek.slice(0, 10) },
    suppliers: ap
      .map((r) => ({ supplier: String(r.supplierName ?? ""), owedRm: rm(total(r)), over60Rm: rm(num(r.days60Sen) + num(r.days90Sen) + num(r.over90Sen)), invoices: arr(r.docs).length }))
      .filter((s) => s.owedRm)
      .sort((a, b) => b.owedRm - a.owedRm)
      .slice(0, 10),
  };
}

const soLine = (r: Obj, origin: string) => ({
  so: String(r.companySOId ?? r.companySO ?? ""),
  customer: String(r.customerName ?? ""),
  status: String(r.status ?? ""),
  due: ymd(r.hookkaExpectedDD),
  rm: rm(r.totalSen),
  link: `${origin}/sales/${encodeURIComponent(String(r.id ?? ""))}`,
});

/**
 * Overdue sales orders from GET /api/sales-orders?fields=orders-due&top=50
 * (the Dashboard's "orders due" list: not delivered / invoiced / closed /
 * cancelled, soonest Hookka expected delivery date first).
 */
export function summariseOverdueSales(due: unknown, today: string, origin: string) {
  const rows = listRows(due).filter((r) => ymd(r.hookkaExpectedDD));
  const overdue = rows.filter((r) => ymd(r.hookkaExpectedDD) < today);
  const byCustomer = new Map<string, { orders: number; sen: number }>();
  for (const r of overdue) {
    const k = String(r.customerName ?? "");
    const e = byCustomer.get(k) ?? { orders: 0, sen: 0 };
    e.orders += 1;
    e.sen += num(r.totalSen);
    byCustomer.set(k, e);
  }
  return {
    note: "Money in RM. Overdue = open sales order (not delivered, invoiced, closed or cancelled) past its Hookka expected delivery date. Hookka sales orders carry no salesperson, so there is no per-salesperson split.",
    overdueOrders: overdue.length,
    ...(rows.length >= BRIEF_SO_TOP && overdue.length === rows.length ? { atLeast: true, why: `only the ${BRIEF_SO_TOP} orders due soonest are read` } : {}),
    overdueRm: rm(overdue.reduce((s, r) => s + num(r.totalSen), 0)),
    byCustomer: [...byCustomer.entries()].sort((a, b) => b[1].orders - a[1].orders).slice(0, 10).map(([customer, e]) => ({ customer, orders: e.orders, rm: rm(e.sen) })),
    orders: overdue.slice(0, 15).map((r) => ({ ...soLine(r, origin), daysLate: daysBetween(ymd(r.hookkaExpectedDD), today) })),
  };
}

/**
 * Deliveries due today / this week: delivery orders not yet delivered
 * (GET /api/delivery-orders?status=DRAFT,LOADED,DISPATCHED,IN_TRANSIT) by their
 * delivery date, and sales orders whose Hookka expected date falls in the range
 * (GET /api/sales-orders?fields=orders-due). Either part may be null (no access).
 */
export function summariseDeliveriesDue(range: "today" | "week", dos: unknown, soDue: unknown, today: string, origin: string) {
  const end = range === "today" ? today : addDays(today, 6);
  const inRange = (d: string) => !!d && d >= today && d <= end;
  const out: Obj = { range, from: today, to: end, note: "Delivery orders by their delivery date (not yet delivered); sales orders by their Hookka expected delivery date (no DO yet or not fully delivered)." };
  if (dos !== null && dos !== undefined) {
    const rows = listRows(dos);
    const due = rows.filter((r) => inRange(ymd(r.deliveryDate))).sort((a, b) => ymd(a.deliveryDate).localeCompare(ymd(b.deliveryDate)));
    const late = rows.filter((r) => ymd(r.deliveryDate) && ymd(r.deliveryDate) < today);
    out.deliveryOrders = {
      count: due.length,
      byStatus: due.reduce<Record<string, number>>((m, r) => ((m[String(r.status)] = (m[String(r.status)] ?? 0) + 1), m), {}),
      pastDateNotDelivered: late.length,
      first: due.slice(0, 15).map((r) => ({
        do: String(r.doNo ?? ""),
        customer: String(r.customerName ?? ""),
        hub: String(r.hubName ?? ""),
        date: ymd(r.deliveryDate),
        status: String(r.status ?? ""),
        lorry: String(r.lorryName ?? r.vehicleNo ?? ""),
        link: `${origin}/delivery/${encodeURIComponent(String(r.id ?? ""))}`,
      })),
    };
  }
  if (soDue !== null && soDue !== undefined) {
    const rows = listRows(soDue).filter((r) => inRange(ymd(r.hookkaExpectedDD)));
    out.salesOrdersDue = { count: rows.length, first: rows.slice(0, 15).map((r) => soLine(r, origin)) };
  }
  return out;
}

/**
 * Shipped but not invoiced, from GET /api/delivery-orders?status=LOADED,
 * DISPATCHED,IN_TRANSIT,SIGNED,DELIVERED (each row carries its live invoiceNo).
 */
export function summariseShippedNotInvoiced(dos: unknown, today: string, origin: string) {
  const rows = listRows(dos).filter((r) => !String(r.invoiceNo ?? "").trim() && String(r.status ?? "") !== "INVOICED");
  const sorted = rows.slice().sort((a, b) => ymd(a.deliveryDate).localeCompare(ymd(b.deliveryDate)));
  return {
    count: rows.length,
    oldest: sorted.slice(0, 10).map((r) => ({
      do: String(r.doNo ?? ""),
      customer: String(r.customerName ?? ""),
      status: String(r.status ?? ""),
      deliveryDate: ymd(r.deliveryDate),
      daysSince: ymd(r.deliveryDate) ? daysBetween(ymd(r.deliveryDate), today) : null,
      link: `${origin}/delivery/${encodeURIComponent(String(r.id ?? ""))}`,
    })),
  };
}

const DEPT_LABEL = (d: unknown) => DEPT_NAMES[String(d ?? "")] ?? String(d ?? "");

/**
 * Late production orders from GET /api/production-orders/board (every live
 * order: not completed or cancelled): target end date before today.
 */
export function summariseProductionLate(board: unknown, today: string, origin: string) {
  const b = obj(board);
  const items = Array.isArray(obj(b.data).items) ? arr(obj(b.data).items) : listRows(board);
  const live = items.filter((r) => !["COMPLETED", "CANCELLED", "TRANSFERRED"].includes(String(r.status ?? "")));
  const late = live.filter((r) => ymd(r.targetEndDate) && ymd(r.targetEndDate) < today).sort((x, y) => ymd(x.targetEndDate).localeCompare(ymd(y.targetEndDate)));
  const count = (key: (r: Obj) => string) => {
    const m = new Map<string, number>();
    for (const r of late) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name, orders]) => ({ name: name || "—", orders }));
  };
  return {
    note: "Late = a live production order (not completed, cancelled or transferred) past its target end date. Department = where it is now (its current job card).",
    liveOrders: live.length,
    lateOrders: late.length,
    byDepartment: count((r) => DEPT_LABEL(r.currentDepartment)),
    byCustomer: count((r) => String(r.customerName ?? "")),
    oldest: late.slice(0, 15).map((r) => ({
      po: String(r.poNo ?? ""),
      so: String(r.companySOId ?? ""),
      customer: String(r.customerName ?? ""),
      product: `${String(r.productCode ?? "")} ${String(r.productName ?? "")}`.trim(),
      target: ymd(r.targetEndDate),
      daysLate: daysBetween(ymd(r.targetEndDate), today),
      department: DEPT_LABEL(r.currentDepartment),
      status: String(r.status ?? ""),
      link: `${origin}/production/${encodeURIComponent(String(r.id ?? ""))}`,
    })),
  };
}

/** A leave (startDate..endDate, YYYY-MM-DD) covering `day`. */
const leaveCovers = (l: Obj, day: string) => ymd(l.startDate) <= day && day <= (ymd(l.endDate) || ymd(l.startDate));

/**
 * Who is away today, from the HR endpoints only: GET /api/attendance?date=…,
 * GET /api/leaves?status=APPROVED and (when readable) GET /api/workers for
 * "no attendance record yet". A part the person may not read is passed as null.
 */
export function summariseAttendance(day: string, att: unknown, leaves: unknown, workers: unknown) {
  const rows = att === null || att === undefined ? null : listRows(att);
  const onLeave =
    leaves === null || leaves === undefined
      ? null
      : listRows(leaves).filter((l) => String(l.status ?? "APPROVED") === "APPROVED" && leaveCovers(l, day));
  const byStatus: Record<string, number> = {};
  for (const r of rows ?? []) byStatus[String(r.status ?? "UNKNOWN")] = (byStatus[String(r.status ?? "UNKNOWN")] ?? 0) + 1;
  const away = (rows ?? []).filter((r) => ["ABSENT", "MEDICAL_LEAVE", "ANNUAL_LEAVE", "HALF_DAY"].includes(String(r.status ?? "")));
  let notIn: { count: number; first: { name: string; department: string }[] } | null = null;
  if (workers !== null && workers !== undefined && rows) {
    const seen = new Set(rows.map((r) => String(r.employeeId ?? "")));
    const leaveIds = new Set((onLeave ?? []).map((l) => String(l.workerId ?? "")));
    const missing = listRows(workers).filter(
      (w) => String(w.status ?? "ACTIVE").toUpperCase() === "ACTIVE" && !seen.has(String(w.id ?? "")) && !leaveIds.has(String(w.id ?? "")),
    );
    notIn = { count: missing.length, first: missing.slice(0, 30).map((w) => ({ name: String(w.name ?? ""), department: String(w.departmentCode ?? "") })) };
  }
  return {
    date: day,
    note: "From Attendance and Leave. No record yet = an active worker with no attendance row today and no approved leave; early in the day that is normal.",
    ...(rows
      ? {
          attendanceRecords: rows.length,
          byStatus,
          awayOrAbsent: away.slice(0, 40).map((r) => ({ name: String(r.employeeName ?? ""), department: String(r.departmentName ?? r.departmentCode ?? ""), status: String(r.status ?? "") })),
        }
      : {}),
    ...(onLeave
      ? {
          onApprovedLeave: {
            count: onLeave.length,
            people: onLeave.slice(0, 40).map((l) => ({ name: String(l.workerName ?? ""), type: String(l.type ?? ""), from: ymd(l.startDate), to: ymd(l.endDate) })),
          },
        }
      : {}),
    ...(notIn ? { noAttendanceRecordYet: notIn } : {}),
  };
}

// ── daily brief ─────────────────────────────────────────────────────────────

export type BriefInputs = {
  today: string;
  origin: string;
  userId: string;
  /** GET /api/sales-orders?fields=orders-due&top=50; null when not readable. */
  salesDue: unknown;
  /** GET /api/purchase-orders/stats; null when not readable. */
  poStats: unknown;
  /** GET /api/mail-center/threads?status=open&limit=100; null when not readable. */
  mailThreads: unknown;
  /** GET /api/service-cases/approvals; null unless the person may approve. */
  serviceApprovals: unknown;
  /** GET /api/leaves?status=PENDING; null unless the person may approve leave. */
  leaveApprovals: unknown;
  noAccess: string[];
};

export const BRIEF_TOP = 5;
export const BRIEF_SO_TOP = 50;
export const BRIEF_MAIL_LIMIT = 100;

const cut = (s: unknown, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** "What do I need to look at today?": per section a count plus the top lines with links. */
export function buildDailyBrief(b: BriefInputs) {
  const soon = addDays(b.today, 3);
  const sections: Record<string, { count: number } & Obj> = {};
  const has = (v: unknown) => v !== null && v !== undefined;

  if (has(b.salesDue)) {
    const rows = listRows(b.salesDue).filter((r) => ymd(r.hookkaExpectedDD));
    const capped = rows.length >= BRIEF_SO_TOP;
    const line = (r: Obj) => ({
      so: String(r.companySOId ?? r.companySO ?? ""),
      customer: String(r.customerName ?? ""),
      status: String(r.status ?? ""),
      due: ymd(r.hookkaExpectedDD),
      link: `${b.origin}/sales/${encodeURIComponent(String(r.id ?? ""))}`,
    });
    const overdue = rows.filter((r) => ymd(r.hookkaExpectedDD) < b.today);
    const dueSoon = rows.filter((r) => ymd(r.hookkaExpectedDD) >= b.today && ymd(r.hookkaExpectedDD) <= soon);
    sections.salesOrdersOverdue = {
      count: overdue.length,
      ...(capped && overdue.length === rows.length ? { atLeast: true } : {}),
      top: overdue.slice(0, BRIEF_TOP).map((r) => ({ ...line(r), daysLate: daysBetween(ymd(r.hookkaExpectedDD), b.today) })),
    };
    sections.salesOrdersDueIn3Days = {
      count: dueSoon.length,
      ...(capped && overdue.length + dueSoon.length === rows.length ? { atLeast: true } : {}),
      top: dueSoon.slice(0, BRIEF_TOP).map(line),
    };
  }

  if (has(b.poStats)) {
    const open = listRows(b.poStats).filter(poOpen);
    const byExpected = (x: Obj, y: Obj) => ymd(x.expectedDate).localeCompare(ymd(y.expectedDate));
    const line = (p: Obj) => ({ po: String(p.poNo ?? ""), supplier: String(p.supplierName ?? ""), expected: ymd(p.expectedDate), link: `${b.origin}/procurement/${encodeURIComponent(String(p.id ?? ""))}` });
    const overdue = open.filter((p) => ymd(p.expectedDate) && ymd(p.expectedDate) < b.today).sort(byExpected);
    const dueSoon = open.filter((p) => ymd(p.expectedDate) >= b.today && ymd(p.expectedDate) <= soon).sort(byExpected);
    sections.purchaseOrdersOverdue = { count: overdue.length, top: overdue.slice(0, BRIEF_TOP).map((p) => ({ ...line(p), daysLate: daysBetween(ymd(p.expectedDate), b.today) })) };
    sections.purchaseOrdersDueIn3Days = { count: dueSoon.length, top: dueSoon.slice(0, BRIEF_TOP).map(line) };
  }

  if (has(b.mailThreads)) {
    const threads = listRows(b.mailThreads);
    const mine = (t: Obj) => String(t.assignedToUserId ?? "") === b.userId;
    const waiting = threads.filter((t) => String(t.lastDirection ?? "inbound") === "inbound" && (t.unread === true || mine(t)));
    sections.mailWaitingForYou = {
      count: waiting.length,
      ...(threads.length >= BRIEF_MAIL_LIMIT ? { countedFrom: `the ${BRIEF_MAIL_LIMIT} most recent open threads` } : {}),
      top: waiting.slice(0, BRIEF_TOP).map((t) => ({
        subject: cut(t.subject),
        from: cut(t.counterpartyName || t.counterpartyEmail, 60),
        assignedToYou: mine(t),
        unread: t.unread === true,
        at: String(t.lastMessageAt ?? ""),
        link: `${b.origin}/mail-center/${encodeURIComponent(String(t.id ?? ""))}`,
      })),
    };
  }

  if (has(b.serviceApprovals)) {
    const rows = listRows(b.serviceApprovals);
    sections.serviceCaseApprovals = {
      count: rows.length,
      top: rows.slice(0, BRIEF_TOP).map((r) => ({
        case: String(r.caseNo ?? ""),
        customer: String(r.customerName ?? ""),
        issue: cut(r.issue),
        requested: ymd(r.requestedAt),
        link: `${b.origin}/service-cases/${encodeURIComponent(String(r.id ?? ""))}`,
      })),
    };
  }

  if (has(b.leaveApprovals)) {
    const rows = listRows(b.leaveApprovals).filter((l) => String(l.status ?? "PENDING") === "PENDING");
    sections.leaveApprovals = {
      count: rows.length,
      top: rows.slice(0, BRIEF_TOP).map((l) => ({ name: String(l.workerName ?? ""), type: String(l.type ?? ""), from: ymd(l.startDate), to: ymd(l.endDate), days: num(l.days), link: `${b.origin}/employees` })),
    };
  }

  const total = Object.values(sections).reduce((s, v) => s + v.count, 0);
  return {
    date: b.today,
    note: "What needs a look today, from the lists this person may read. Overdue / due within 3 days use the sales order's Hookka expected delivery date and the PO's expected date. Hookka orders and POs have no personal owner, so these are the ones this person's role covers.",
    itemsNeedingAttention: total,
    sections,
    ...(b.noAccess.length ? { noAccess: b.noAccess.map((x) => `You don't have access to ${x}.`) } : {}),
  };
}
