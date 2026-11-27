// ---------------------------------------------------------------------------
// mcp-visibility.ts — AI Connector round 4c (platform quality, owner 2026-11-26).
//
//   P1 role-aware tools/list   TOOL_NEEDS: the endpoints each tool reads. A tool
//                              is listed only when the person passes the SAME
//                              module gate readValue applies (mcp-access.ts
//                              classifyPath → resources → read) for those
//                              endpoints — no connector-only rule. Write tools:
//                              listed only while their switches are on and the
//                              person holds the ERP permission the route checks.
//                              A hidden tool called directly still answers
//                              "no access" (callTool asks toolAllowed first).
//   P2 prompts per role        promptVisible: a prompt shows when one of its
//                              tools does.
//   P3 structured output       STRUCTURED_TOOLS get an open `outputSchema`, and
//                              their answers `structuredContent` (text kept).
//   P5 links + RM              withLinksAndRm: a top-level ERP page link on every
//                              quick answer, a record link on rows that carry a
//                              record id but no link, and any `…Sen` money key
//                              left in an answer turned into `…Rm`.
// ---------------------------------------------------------------------------
import { classifyPath } from "./mcp-access";

type Obj = Record<string, unknown>;

/** all: every endpoint must be readable; any: at least one must be. Endpoints only — the gate comes from classifyPath. */
export type ToolNeed = { all?: string[]; any?: string[] };

const DOC_APIS = ["/api/sales-orders", "/api/purchase-orders", "/api/delivery-orders", "/api/invoices"];

export const TOOL_NEEDS: Record<string, ToolNeed> = {
  sales_summary: { all: ["/api/dashboard/overview"] },
  production_summary: { all: ["/api/working-hour-entries/production-revenue"] },
  order_backlog: { all: ["/api/sales-orders/stats"] },
  receivables_summary: { all: ["/api/accounting/aging"] },
  material_shortages: { all: ["/api/mrp/plan"] },
  inventory_summary: { all: ["/api/inventory"] },
  purchasing_summary: { all: ["/api/purchase-orders/stats"] },
  payables_summary: { all: ["/api/accounting/aging"] },
  so_overdue: { all: ["/api/sales-orders"] },
  deliveries_due: { any: ["/api/delivery-orders", "/api/sales-orders"] },
  production_late: { all: ["/api/production-orders/board"] },
  attendance_today: { any: ["/api/attendance", "/api/leaves"] },
  po_overdue: { all: ["/api/purchase-orders/stats"] },
  supplier_lateness: { all: ["/api/purchase-orders/stats"] },
  uninvoiced_deliveries: { all: ["/api/delivery-orders"] },
  stock_check: { any: ["/api/inventory", "/api/products", "/api/inventory/fg-stock", "/api/procurement-reports/outstanding-lines"] },
  product_cost: { all: ["/api/products", "/api/product-costing/x"] },
  production_output: { all: ["/api/dashboard/floor-live/completed"] },
  worker_efficiency: { all: ["/api/dashboard/floor-live/completed"] },
  raw_material_summary: { all: ["/api/inventory"] },
  gross_profit: { all: ["/api/invoices/line-summary"] },
  production_lead_time: { all: ["/api/production-orders"] },
  company_report: { all: ["/api/accounting/dashboard"] },
  // round 4d: any one of its lists is enough (each part the person cannot read is left out).
  data_gaps: { any: ["/api/products", "/api/product-costing/x", "/api/sales-orders", "/api/workers", "/api/suppliers"] },
  document_flow: { any: [...DOC_APIS, "/api/production-orders"] },
  get_pdf: { any: DOC_APIS },
  erp_link: { any: DOC_APIS },
};

/** Endpoints → resources, through the same gate readValue uses. Unknown / blocked path → never readable. */
export function needResources(need: ToolNeed): { all: string[][]; any: string[][] } {
  const res = (p: string): string[] => {
    const d = classifyPath(p);
    return d.ok ? d.resources : [];
  };
  return { all: (need.all ?? []).map(res), any: (need.any ?? []).map(res) };
}

/** Is a read tool usable by someone whose read checks answer `canRead`? Tools with no entry are always listed. */
export async function readToolAllowed(name: string, canRead: (resource: string) => Promise<boolean>): Promise<boolean> {
  const need = TOOL_NEEDS[name];
  if (!need) return true;
  const r = needResources(need);
  const anyOf = async (rs: string[]) => {
    for (const x of rs) if (await canRead(x)) return true;
    return false;
  };
  for (const rs of r.all) if (!(await anyOf(rs))) return false;
  if (r.any.length) {
    for (const rs of r.any) if (await anyOf(rs)) return true;
    return false;
  }
  return true;
}

/** The resources a tool needs, for its "no access" message. */
export function needLabel(name: string): string {
  const need = TOOL_NEEDS[name];
  if (!need) return name;
  const r = needResources(need);
  return [...new Set([...r.all, ...r.any].map((x) => x[0]).filter(Boolean))].join(" / ") || name;
}

// ── P3: structured output ───────────────────────────────────────────────────

export const STRUCTURED_TOOLS = new Set([
  "sales_summary",
  "production_summary",
  "order_backlog",
  "receivables_summary",
  "material_shortages",
  "inventory_summary",
  "purchasing_summary",
  "payables_summary",
  "so_overdue",
  "deliveries_due",
  "production_late",
  "attendance_today",
  "daily_brief",
  "po_overdue",
  "supplier_lateness",
  "uninvoiced_deliveries",
  "stock_check",
  "product_cost",
  "production_output",
  "worker_efficiency",
  "raw_material_summary",
  "gross_profit",
  "production_lead_time",
  "company_report",
  "data_gaps",
]);

/** Open on purpose: summaries differ per tool and fields drop out for some roles. */
export const QUICK_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    erpLink: { type: "string", description: "The ERP page this answer comes from" },
    hiddenFields: { type: "array", items: { type: "string" }, description: "Fields the ERP hides from this person" },
    noAccess: { type: "array", items: { type: "string" } },
    couldNotRead: { type: "array", items: { type: "string" } },
  },
  additionalProperties: true,
} as const;

/** The JSON a quick answer's text carries (after an optional "Fields hidden…" line), or null. */
export function parseQuickText(t: string): { value: Obj; hidden: string[] } | null {
  let body = t;
  let hidden: string[] = [];
  const m = /^Fields hidden for this person: (.*)\.\n/.exec(t);
  if (m) {
    hidden = m[1].split(", ").filter(Boolean);
    body = t.slice(m[0].length);
  }
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? { value: v as Obj, hidden } : null;
  } catch {
    return null;
  }
}

// ── P5: links + RM ──────────────────────────────────────────────────────────

/** The ERP page each quick answer comes from. */
export const TOOL_PAGES: Record<string, string> = {
  sales_summary: "/dashboard",
  production_summary: "/dashboard",
  order_backlog: "/sales",
  receivables_summary: "/accounting",
  material_shortages: "/planning/mrp",
  inventory_summary: "/inventory",
  purchasing_summary: "/procurement",
  payables_summary: "/accounting",
  so_overdue: "/sales",
  deliveries_due: "/delivery",
  production_late: "/production",
  attendance_today: "/employees",
  daily_brief: "/dashboard",
  po_overdue: "/procurement",
  supplier_lateness: "/procurement/reports",
  uninvoiced_deliveries: "/delivery",
  stock_check: "/inventory",
  product_cost: "/products",
  production_output: "/production",
  worker_efficiency: "/production",
  raw_material_summary: "/inventory",
  gross_profit: "/invoices",
  production_lead_time: "/production",
  company_report: "/accounting",
  data_gaps: "/products",
};

/** A row's record id key → its ERP page. */
const ID_PAGES: [string, (id: string) => string][] = [
  ["soId", (id) => `/sales/${id}`],
  ["salesOrderId", (id) => `/sales/${id}`],
  ["poId", (id) => `/procurement/${id}`],
  ["purchaseOrderId", (id) => `/procurement/${id}`],
  ["doId", (id) => `/delivery/${id}`],
  ["deliveryOrderId", (id) => `/delivery/${id}`],
  ["invoiceId", (id) => `/invoices/${id}`],
  ["productId", (id) => `/products/${id}/costing`],
  ["supplierId", (id) => `/suppliers/${id}`],
  ["caseId", (id) => `/service-cases/${id}`],
];

const LINK_KEYS = ["url", "link", "erpLink", "href"];

/** Rounds sen → RM (2 dp). */
const senToRm = (v: number) => Math.round(v) / 100;

/**
 * P5 over one answer: top-level `erpLink`; rows with a record id but no link
 * get `url`; any numeric `…Sen` key becomes `…Rm` (null stays null — a hidden
 * figure is never turned into 0).
 */
export function withLinksAndRm(tool: string, value: Obj, origin: string): Obj {
  const walk = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, false));
    if (!v || typeof v !== "object") return v;
    const o = v as Obj;
    const out: Obj = {};
    for (const [k, x] of Object.entries(o)) {
      if (/[a-z]Sen$/.test(k) && (typeof x === "number" || x === null)) {
        const rk = k.replace(/Sen$/, "Rm");
        if (!(rk in o)) out[rk] = x === null ? null : senToRm(x);
        continue;
      }
      out[k] = walk(x, false);
    }
    if (!top && !LINK_KEYS.some((k) => typeof o[k] === "string" && o[k])) {
      for (const [key, page] of ID_PAGES) {
        const id = o[key];
        if (typeof id === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(id)) {
          out.url = `${origin}${page(encodeURIComponent(id))}`;
          break;
        }
      }
    }
    return out;
  };
  const out = walk(value, true) as Obj;
  if (!LINK_KEYS.some((k) => typeof out[k] === "string" && out[k]) && TOOL_PAGES[tool]) out.erpLink = `${origin}${TOOL_PAGES[tool]}`;
  return out;
}
