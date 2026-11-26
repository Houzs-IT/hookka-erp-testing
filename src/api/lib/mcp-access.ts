// ---------------------------------------------------------------------------
// mcp-access.ts — what the MCP connector may read, for whom (docs/plans/mcp-connector.md).
//
// Owner 2026-11-25 「确保安全性问题，还有他们可以看到什么不会泄露吗？我担心是FE
// 而已」: some ERP pages hide a price or a cost in the BROWSER while the API still
// sends it. An AI reads the API, not the page — so the connector adds its own
// server-side locks on top of each route's own permission check:
//
//   1. MODULE GATE. Every readable path prefix maps to an RBAC resource; the
//      caller needs `<resource>:read` (or one of a list). A prefix not in the
//      map is not readable through the connector at all (fail closed), and the
//      BLOCKED list is never readable, not even by a Super Admin.
//   2. FIELD REDACTION. Cost, salary and price / revenue keys are removed from
//      every JSON reply unless the caller holds the matching permission —
//      whatever the route or the page does.
//   3. Read-only is enforced in auth-middleware.ts (an MCP token can only GET).
// ---------------------------------------------------------------------------

/** Never readable through the connector, for anyone. */
export const MCP_BLOCKED_PREFIXES = [
  "/api/auth",
  "/api/users",
  "/api/user-permissions",
  "/api/mcp",
  "/api/internal",
  "/api/public",
  "/api/worker-auth",
  "/api/worker",
  "/api/kv-config",
  "/api/admin",
  "/api/audit-events",
  "/api/push",
  "/api/sheets-sync",
  "/api/fe-rum",
  "/api/connect",
  "/api/agents",
  "/api/assistant",
  "/api/scan-queue",
  "/api/import",
  "/api/doc-import",
  "/api/datagrid-layouts",
  "/api/presence",
  "/api/maintenance-config",
  "/api/files",
];

/**
 * Readable path prefix → the resource(s) whose `read` opens it (any one).
 * Longest prefix wins. Keep in step with ALL_RESOURCES in role-policy.ts.
 */
export const MCP_PREFIX_RESOURCES: Record<string, string[]> = {
  // Sales & customers
  "/api/sales-orders": ["sales-orders"],
  "/api/delivery-orders": ["delivery-orders"],
  "/api/delivery-returns": ["delivery-returns"],
  "/api/packing-lists": ["delivery-orders"],
  "/api/invoices": ["invoices"],
  "/api/e-invoices": ["e-invoices"],
  "/api/credit-notes": ["credit-notes"],
  "/api/debit-notes": ["debit-notes"],
  "/api/payments": ["payments"],
  "/api/consignments": ["consignments"],
  "/api/consignment-orders": ["consignments"],
  "/api/consignment-notes": ["consignment-notes"],
  "/api/cn-packing-lists": ["consignment-notes"],
  "/api/customers": ["customers"],
  "/api/customer-hubs": ["customer-hubs"],
  "/api/customer-products": ["customer-products"],
  "/api/customer-crm": ["customers"],
  "/api/customer-quotation": ["quotations"],
  "/api/customer-maintenance": ["customers"],
  "/api/sales-leads": ["sales-pipeline"],
  "/api/promise-date": ["promise-date"],
  "/api/historical-sales": ["historical-sales"],
  "/api/price-history": ["price-history"],
  "/api/stock-allocations": ["sales-orders"],
  // Procurement
  "/api/purchase-orders": ["purchase-orders"],
  "/api/purchase-invoices": ["purchase-invoices"],
  "/api/purchase-returns": ["purchase-returns"],
  "/api/supplier-payments": ["payments"],
  "/api/suppliers": ["suppliers"],
  "/api/supplier-materials": ["supplier-materials"],
  "/api/supplier-scorecards": ["supplier-scorecards"],
  "/api/procurement-reports": ["purchase-orders"],
  "/api/grn": ["grn"],
  "/api/goods-in-transit": ["goods-in-transit"],
  "/api/three-way-match": ["three-way-match"],
  "/api/mrp": ["mrp"],
  // Production
  "/api/production-orders": ["production-orders"],
  "/api/production-folders": ["production-orders"],
  "/api/production/order-lines": ["production-orders"],
  "/api/production-leadtimes": ["production-leadtimes"],
  "/api/production/leadtimes": ["production-leadtimes"],
  "/api/job-cards": ["job-cards"],
  "/api/scheduling": ["scheduling"],
  "/api/planning": ["scheduling", "production-orders"],
  "/api/bom": ["bom"],
  "/api/bom-master-templates": ["bom-master-templates"],
  "/api/component-boms": ["bom"],
  "/api/outsource-issues": ["outsource-issues"],
  "/api/outsource-piece": ["outsource-issues"],
  "/api/department-performance": ["production-orders"],
  "/api/wip-times": ["production-orders"],
  "/api/departments": ["departments"],
  "/api/cnc-templates": ["cnc-templates"],
  // Quality & service
  "/api/qc-inspections": ["qc-inspections"],
  "/api/qc-pending": ["qc-inspections"],
  "/api/qc-templates": ["qc-inspections"],
  "/api/service-cases": ["service-cases"],
  "/api/service-orders": ["service-orders"],
  // Warehouse & stock
  "/api/inventory": ["inventory"],
  "/api/raw-materials": ["raw-materials"],
  "/api/rm-batches": ["rm-batches"],
  "/api/fg-units": ["fg-units"],
  "/api/stock": ["inventory", "stock-movements"],
  "/api/stock-adjustments": ["stock-movements"],
  "/api/stock-count": ["inventory"],
  "/api/stock-accounts": ["stock-accounts"],
  "/api/stock-value": ["stock-value"],
  "/api/warehouse": ["warehouse"],
  "/api/fabric-tracking": ["fabric-tracking"],
  "/api/fabrics": ["fabrics"],
  // Finance
  "/api/accounting": ["accounting"],
  "/api/cost-ledger": ["cost-ledger"],
  "/api/cash-flow": ["cash-flow"],
  "/api/dashboard/finance": ["accounting"],
  "/api/fx": ["accounting"],
  "/api/forecasts": ["forecasts"],
  // Products
  "/api/products": ["products"],
  "/api/product-configs": ["product-configs"],
  // Same gate as the ERP route (products:read, routes/product-costing.ts); the
  // money inside is then hidden by the cost / price families unless the person
  // holds cost-ledger / product-pricing / accounting read (owner 2026-11-26:
  // the connector follows the ERP's current RBAC, no stricter, no looser).
  "/api/product-costing": ["products"],
  "/api/sofa-combos": ["sofa-combos"],
  "/api/rd-projects": ["rd-projects"],
  // People
  "/api/workers": ["workers"],
  "/api/attendance": ["attendance"],
  "/api/working-hour-entries": ["workers", "attendance"],
  "/api/leaves": ["leaves"],
  "/api/payroll": ["payroll"],
  "/api/payslips": ["payslips"],
  "/api/pay-rules": ["payroll"],
  "/api/payroll-hour-deductions": ["payroll"],
  "/api/employee-advances": ["payroll"],
  "/api/worker-penalties": ["worker-penalties"],
  "/api/org-chart": ["workers"],
  // Fleet & equipment
  "/api/lorries": ["lorries"],
  "/api/drivers": ["drivers"],
  "/api/three-pl-vehicles": ["lorries"],
  "/api/three-pl-drivers": ["drivers"],
  "/api/three-pl-state-rates": ["lorries"],
  "/api/equipment": ["equipment"],
  "/api/maintenance-logs": ["maintenance-logs"],
  // Dashboards & reports
  "/api/dashboard/overview": ["dashboard", "dashboard-experimental"],
  "/api/dashboard/floor-live": ["dashboard", "dashboard-experimental", "production-orders"],
  "/api/reports": ["dashboard"],
  "/api/kpi": ["dashboard"],
  // Everyone
  "/api/announcements": ["announcements"],
  "/api/notifications": ["notifications"],
  "/api/search": ["sales-orders", "customers", "products", "production-orders", "purchase-orders"],
  "/api/organisations": ["organisations"],
  "/api/meetings": ["announcements"],
};

export type PathDecision =
  | { ok: true; path: string; resources: string[] }
  | { ok: false; reason: string };

/** Normalise and check a path the model asked for. Pure; no permission lookup. */
export function classifyPath(raw: string): PathDecision {
  let p = String(raw || "").trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.startsWith("/api/")) p = "/api" + p;
  if (p.includes("..") || p.includes("\\") || p.includes("//") || /[\s#?]/.test(p)) {
    return { ok: false, reason: "Invalid path. Give the path without a query string, e.g. /api/sales-orders" };
  }
  const lower = p.toLowerCase();
  for (const b of MCP_BLOCKED_PREFIXES) {
    if (lower === b || lower.startsWith(b + "/")) return { ok: false, reason: "This part of the system is not available to the AI connector." };
  }
  let best: string | null = null;
  for (const pre of Object.keys(MCP_PREFIX_RESOURCES)) {
    if ((lower === pre || lower.startsWith(pre + "/")) && (!best || pre.length > best.length)) best = pre;
  }
  if (!best) return { ok: false, reason: "Unknown module. Call list_modules to see what can be read." };
  return { ok: true, path: p, resources: MCP_PREFIX_RESOURCES[best] };
}

// ── field redaction ─────────────────────────────────────────────────────────

/** A key family, the permissions that unlock it (any one), and its matcher. */
export const REDACTION_RULES: { family: string; unlock: string[]; test: (k: string) => boolean }[] = [
  {
    family: "salary",
    unlock: ["payroll:read", "payslips:read"],
    test: (k) => /(salary|wage|payroll|payslip|basicpay|basic_pay|allowance|epf|socso|\beis\b|_eis|eis_|otpay|ot_pay|hourlyrate|hourly_rate|dailyrate|daily_rate|monthlyrate|grosspay|gross_pay|netpay|net_pay|commission|bonus|incentive|deduction|advance)/i.test(k),
  },
  {
    family: "cost",
    unlock: ["cost-ledger:read", "accounting:read"],
    test: (k) => /(cost|cogs|landed|margin|markup|profit)/i.test(k),
  },
  {
    family: "price",
    unlock: ["product-pricing:read", "revenue-figures:read", "accounting:read"],
    test: (k) => /(price|revenue|amount|subtotal|grandtotal|grand_total|totalsen|total_sen|valuesen|value_sen|surcharge|discount|balance|outstanding|paid|payable|receivable|creditlimit|credit_limit|\bsen$|sen$|_rm$|rm$)/i.test(k),
  },
];

/**
 * Modules whose whole point is money: a reader of these sees their amounts
 * (the module gate already proved they may read them). Cost and salary rules
 * still apply inside them.
 */
export const PRICE_MODULE_RESOURCES = new Set([
  "sales-orders", "delivery-orders", "invoices", "e-invoices", "credit-notes", "debit-notes", "payments",
  "consignments", "consignment-notes", "quotations", "purchase-orders", "purchase-invoices", "purchase-returns",
  "accounting", "cash-flow", "cost-ledger", "price-history", "historical-sales", "supplier-materials",
  "three-way-match", "stock-value",
]);

/** Keys that hold a count or quantity, never an amount of money. */
export const QTY_KEY = /(qty|quantity|quantities|units|pcs|count)$/i;

export type Redactor = (v: unknown) => { value: unknown; removed: Set<string> };

/**
 * A redactor for one caller. `can(perm)` answers "resource:action".
 * `moduleResources` are the resources that opened this path.
 */
export function makeRedactor(can: (perm: string) => boolean, moduleResources: string[]): Redactor {
  const priceModule = moduleResources.some((r) => PRICE_MODULE_RESOURCES.has(r));
  const active = REDACTION_RULES.filter((rule) => {
    if (rule.family === "price" && priceModule) return false;
    return !rule.unlock.some(can);
  });
  return (input: unknown) => {
    const removed = new Set<string>();
    const walk = (v: unknown, depth: number): unknown => {
      if (depth > 40) return null;
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          // A key belongs to the FIRST family it matches (salary, then cost,
          // then price): "basicSalarySen" is salary, unlocked by payroll alone.
          // A quantity is never money: "balanceQty" / "outstandingQty" stay for
          // anyone who may read the module (owner 2026-11-26: a storekeeper sees
          // stock quantities, the amounts stay hidden).
          const fam = QTY_KEY.test(k) ? undefined : REDACTION_RULES.find((rule) => rule.test(k));
          if (fam && active.includes(fam)) {
            removed.add(fam.family);
            continue;
          }
          out[k] = walk(val, depth + 1);
        }
        return out;
      }
      return v;
    };
    return { value: walk(input, 0), removed };
  };
}

/** Readable modules, grouped, for the list_modules tool. */
export function moduleCatalog(): { prefix: string; resources: string[] }[] {
  return Object.entries(MCP_PREFIX_RESOURCES)
    .map(([prefix, resources]) => ({ prefix, resources }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}
