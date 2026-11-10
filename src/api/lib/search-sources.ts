// ---------------------------------------------------------------------------
// search-sources — the catalogue behind GET /api/search.
//
// The Ctrl+K palette used to fan out SIX separate HTTP calls from the browser
// (sales orders, customers, products, delivery orders, invoices, consignment
// notes) on every keystroke, and covered only those six things. Everything
// else in the ERP — purchase orders, GRNs, purchase invoices, suppliers,
// production orders, job cards, service orders, service cases, employees,
// leads, journal entries — was simply not findable from search.
//
// This file is the single list of what is searchable and how. Keeping it as
// DATA rather than code means adding a module to global search is one entry,
// and the endpoint, the permission gate and the tests all pick it up.
//
// Pure and dependency-free so the SQL it produces can be unit-tested without a
// database — the parts that go wrong here (an identifier reaching SQL from
// user input, a missing org filter leaking another company's rows) are exactly
// the parts worth pinning.
// ---------------------------------------------------------------------------

export type SearchSource = {
  /** Stable discriminator returned to the client. */
  kind: string;
  /** Human label for the result group. */
  groupLabel: string;
  table: string;
  /** Column holding the row id used to build the link. */
  idCol: string;
  /** Column shown as the result's title. */
  labelCol: string;
  /** Columns shown under the title, in order. Missing ones render blank. */
  subCols: string[];
  /** Columns matched against the search term. */
  searchCols: string[];
  /** Column used to scope to the caller's org, when the table has one. */
  orgCol: string | null;
  /** RBAC resource this source belongs to; the caller must have `read`. */
  resource: string;
  /** Path prefix; the row id is appended (or the label — see `hrefBy`). */
  hrefPrefix: string;
  /**
   * What is appended to `hrefPrefix`. "id" (default) for a detail page;
   * "label" for a list whose grid search is URL-kept (`?<gridId>.q=`), so the
   * link opens the list filtered to that document; "none" for a list page
   * that has no deep link at all (the result still names the document).
   */
  hrefBy?: "id" | "label" | "none";
  /** Search columns holding a document number: also matched ignoring case,
   *  spaces, dashes and slashes ("so2610001" finds "SO-2610-001"). Review
   *  pass 2 C2-9 / H3-11. Must be a subset of `searchCols`. */
  compactCols?: string[];
  /** Search columns holding a phone number: also matched on digits only, with
   *  a leading Malaysian 60 read as 0, so "+60 12-345 6789", "012-3456789" and
   *  "0123456789" all find each other. Must be a subset of `searchCols`. */
  phoneCols?: string[];
};

// Ordered by how often people look for the thing. The endpoint returns groups
// in this order, so the list itself is the ranking.
export const SEARCH_SOURCES: SearchSource[] = [
  {
    kind: "sales_order", groupLabel: "Sales Orders", table: "sales_orders",
    idCol: "id", labelCol: "company_so_id",
    subCols: ["customer_name", "customer_po_id", "status"],
    searchCols: ["company_so_id", "customer_so_id", "customer_po_id", "customer_name", "reference"],
    compactCols: ["company_so_id", "customer_so_id", "customer_po_id"],
    orgCol: "org_id", resource: "sales_orders", hrefPrefix: "/sales/",
  },
  {
    kind: "customer", groupLabel: "Customers", table: "customers",
    idCol: "id", labelCol: "name",
    subCols: ["code", "phone", "email"],
    searchCols: ["name", "code", "phone", "email"],
    phoneCols: ["phone"],
    orgCol: "org_id", resource: "customers", hrefPrefix: "/customers?id=",
  },
  {
    kind: "product", groupLabel: "Products", table: "products",
    idCol: "id", labelCol: "code",
    subCols: ["name", "category"],
    searchCols: ["code", "name"],
    orgCol: "org_id", resource: "products", hrefPrefix: "/products?id=",
  },
  {
    kind: "delivery_order", groupLabel: "Delivery Orders", table: "delivery_orders",
    idCol: "id", labelCol: "do_no",
    subCols: ["customer_name", "status"],
    searchCols: ["do_no", "customer_name", "contact_phone"],
    compactCols: ["do_no"],
    phoneCols: ["contact_phone"],
    orgCol: "org_id", resource: "delivery_orders", hrefPrefix: "/delivery/",
  },
  {
    kind: "invoice", groupLabel: "Invoices", table: "invoices",
    idCol: "id", labelCol: "invoice_no",
    subCols: ["customer_name", "status"],
    searchCols: ["invoice_no", "customer_name", "customer_phone"],
    compactCols: ["invoice_no"],
    phoneCols: ["customer_phone"],
    orgCol: "org_id", resource: "invoices", hrefPrefix: "/invoices/",
  },
  {
    // Preserves the note search the palette had before the unified endpoint —
    // noteNumber folds to note_number; the CN page deep-links via ?focus=id.
    kind: "consignment_note", groupLabel: "Consignment Notes", table: "consignment_notes",
    idCol: "id", labelCol: "note_number",
    subCols: ["customer_name", "branch_name", "status"],
    searchCols: ["note_number", "customer_name", "branch_name"],
    compactCols: ["note_number"],
    orgCol: "org_id", resource: "consignment", hrefPrefix: "/consignment/note?focus=",
  },
  // ── everything below was NOT searchable before ──
  {
    kind: "purchase_order", groupLabel: "Purchase Orders", table: "purchase_orders",
    idCol: "id", labelCol: "po_no",
    subCols: ["supplier_name", "status"],
    searchCols: ["po_no", "supplier_name"],
    compactCols: ["po_no"],
    orgCol: "org_id", resource: "procurement", hrefPrefix: "/procurement/",
  },
  {
    kind: "purchase_invoice", groupLabel: "Purchase Invoices", table: "purchase_invoices",
    idCol: "id", labelCol: "pi_no",
    subCols: ["supplier_name", "supplier_invoice_no", "status"],
    searchCols: ["pi_no", "supplier_name", "supplier_invoice_no"],
    compactCols: ["pi_no", "supplier_invoice_no"],
    orgCol: "org_id", resource: "procurement", hrefPrefix: "/procurement/pi/",
  },
  {
    // The column is grn_number (folds from grnNumber), NOT grn_no — confirmed
    // against grn.ts and reported by /api/search's sourcesSkipped.
    kind: "grn", groupLabel: "Goods Receipts", table: "grns",
    idCol: "id", labelCol: "grn_number",
    subCols: ["supplier_name", "status"],
    searchCols: ["grn_number", "supplier_name"],
    compactCols: ["grn_number"],
    orgCol: "org_id", resource: "procurement", hrefPrefix: "/procurement/grn/",
  },
  {
    kind: "supplier", groupLabel: "Suppliers", table: "suppliers",
    idCol: "id", labelCol: "name",
    subCols: ["code", "phone"],
    searchCols: ["name", "code", "phone", "mobile", "phone2"],
    phoneCols: ["phone", "mobile", "phone2"],
    orgCol: "org_id", resource: "procurement", hrefPrefix: "/suppliers/",
  },
  {
    kind: "production_order", groupLabel: "Production Orders", table: "production_orders",
    idCol: "id", labelCol: "po_no",
    subCols: ["product_code", "current_department", "status"],
    searchCols: ["po_no", "product_code"],
    compactCols: ["po_no"],
    orgCol: "org_id", resource: "production", hrefPrefix: "/production/",
  },
  {
    kind: "service_order", groupLabel: "Service Orders", table: "sales_orders",
    idCol: "id", labelCol: "company_so_id",
    subCols: ["customer_name", "status"],
    searchCols: ["company_so_id", "customer_name"],
    compactCols: ["company_so_id"],
    orgCol: "org_id", resource: "service_orders", hrefPrefix: "/service-order/",
  },
  {
    kind: "service_case", groupLabel: "Service Cases", table: "service_cases",
    idCol: "id", labelCol: "case_no",
    subCols: ["customer_name", "status"],
    searchCols: ["case_no", "customer_name"],
    compactCols: ["case_no"],
    orgCol: "org_id", resource: "service_cases", hrefPrefix: "/service-cases/",
  },
  {
    // The table is `workers`, not `employees` (the UI label is Employees but
    // the storage kept the original name — see workers.ts). emp_no folds from
    // empNo. orgCol is declared but degrades to no filter if the column is
    // absent (buildSourceSql guards on availableCols).
    kind: "employee", groupLabel: "Employees", table: "workers",
    idCol: "id", labelCol: "name",
    subCols: ["emp_no", "department_code", "position"],
    searchCols: ["name", "emp_no", "phone"],
    phoneCols: ["phone"],
    orgCol: "org_id", resource: "employees", hrefPrefix: "/employees?id=",
  },
  {
    // The table is `sales_leads` (sales-leads.ts), and its RBAC resource is
    // `customers` — the same gate the leads route itself uses.
    kind: "lead", groupLabel: "Sales Pipeline", table: "sales_leads",
    idCol: "id", labelCol: "name",
    subCols: ["company", "stage"],
    searchCols: ["name", "company", "phone", "email"],
    phoneCols: ["phone"],
    orgCol: "org_id", resource: "customers", hrefPrefix: "/leads?id=",
  },
  {
    kind: "journal_entry", groupLabel: "Journal Entries", table: "journal_entries",
    idCol: "id", labelCol: "entry_no",
    subCols: ["description", "status"],
    searchCols: ["entry_no", "description"],
    compactCols: ["entry_no"],
    orgCol: "org_id", resource: "accounting", hrefPrefix: "/accounting?tab=journals&id=",
  },
  // ── review pass 2 (C2-10 / H3-11): returns, notes, receipts, vouchers ──
  // Each is gated on the SAME read permission its own route checks. The list
  // pages without a detail route open filtered to the document through the
  // grid's URL-kept search (`?<gridId>.q=`, src/lib/grid-url-state.ts).
  {
    kind: "delivery_return", groupLabel: "Delivery Returns", table: "delivery_returns",
    idCol: "id", labelCol: "return_no",
    subCols: ["customer_name", "do_no", "status"],
    searchCols: ["return_no", "do_no", "company_so_id", "customer_name"],
    compactCols: ["return_no", "do_no", "company_so_id"],
    orgCol: "org_id", resource: "delivery-returns", hrefPrefix: "/delivery-returns/",
  },
  {
    kind: "credit_note", groupLabel: "Credit Notes", table: "credit_notes",
    idCol: "id", labelCol: "note_number",
    subCols: ["customer_name", "invoice_number", "status"],
    searchCols: ["note_number", "invoice_number", "customer_name", "customer_phone"],
    compactCols: ["note_number", "invoice_number"],
    phoneCols: ["customer_phone"],
    orgCol: "org_id", resource: "credit-notes",
    hrefPrefix: "/invoices/credit-notes?credit-notes.q=", hrefBy: "label",
  },
  {
    kind: "debit_note", groupLabel: "Debit Notes", table: "debit_notes",
    idCol: "id", labelCol: "note_number",
    subCols: ["customer_name", "invoice_number", "status"],
    searchCols: ["note_number", "invoice_number", "customer_name", "customer_phone"],
    compactCols: ["note_number", "invoice_number"],
    phoneCols: ["customer_phone"],
    orgCol: "org_id", resource: "debit-notes",
    hrefPrefix: "/invoices/debit-notes?debit-notes.q=", hrefBy: "label",
  },
  {
    kind: "purchase_return", groupLabel: "Purchase Returns", table: "purchase_returns",
    idCol: "id", labelCol: "return_no",
    subCols: ["supplier_name", "grn_no", "status"],
    searchCols: ["return_no", "supplier_name", "grn_no", "pi_no", "supplier_cn_ref"],
    compactCols: ["return_no", "grn_no", "pi_no", "supplier_cn_ref"],
    orgCol: "org_id", resource: "purchase-returns", hrefPrefix: "/purchase-returns", hrefBy: "none",
  },
  {
    // The route's create gate is inventory; its list carries no gate of its own
    // beyond the org, so search asks for inventory read — never looser.
    kind: "stock_adjustment", groupLabel: "Stock Adjustments", table: "stock_adjustments",
    idCol: "id", labelCol: "adj_no",
    subCols: ["item_code", "item_name", "reason"],
    searchCols: ["adj_no", "item_code", "item_name"],
    compactCols: ["adj_no"],
    orgCol: "org_id", resource: "inventory", hrefPrefix: "/inventory/adjustments", hrefBy: "none",
  },
  {
    kind: "payment_receipt", groupLabel: "Payment Receipts", table: "payment_records",
    idCol: "id", labelCol: "receipt_number",
    subCols: ["customer_name", "method", "status"],
    searchCols: ["receipt_number", "customer_name", "reference"],
    compactCols: ["receipt_number", "reference"],
    orgCol: "org_id", resource: "payments",
    hrefPrefix: "/invoices/payments?payments.q=", hrefBy: "label",
  },
  {
    // official_receipts / payment_vouchers carry no org column (the Accounting
    // routes read them unscoped too — accounting.ts "have no org_id column"),
    // so search shows exactly what the Accounting page shows: no more.
    kind: "official_receipt", groupLabel: "Official Receipts", table: "official_receipts",
    idCol: "id", labelCol: "or_no",
    subCols: ["received_from", "date", "status"],
    searchCols: ["or_no", "received_from", "description"],
    compactCols: ["or_no"],
    orgCol: null, resource: "accounting",
    hrefPrefix: "/accounting?tab=receipts&accounting-receipts.q=", hrefBy: "label",
  },
  {
    kind: "payment_voucher", groupLabel: "Payment Vouchers", table: "payment_vouchers",
    idCol: "id", labelCol: "pv_no",
    subCols: ["payee", "date", "status"],
    searchCols: ["pv_no", "payee", "reference", "description"],
    compactCols: ["pv_no", "reference"],
    orgCol: null, resource: "accounting",
    hrefPrefix: "/accounting?tab=payments&accounting-payments.q=", hrefBy: "label",
  },
];

/** Sources whose table has no org column (checked by the tests): they are read
 *  unscoped by their own pages too. Anything else must carry `orgCol`. */
export const UNTENANTED_SEARCH_TABLES: ReadonlySet<string> = new Set(["official_receipts", "payment_vouchers"]);

/** The three forms of one search term. `compact` / `phone` are null when the
 *  term has nothing to match in that form, so no always-true LIKE '%%' is
 *  ever sent. */
export type SearchTerms = { like: string; compact: string | null; phone: string | null };

/** Document-number form: lower case, letters and digits only. */
export function compactTerm(term: string): string {
  return term.toLowerCase().replace(/[^0-9a-z]/g, "");
}

/** Phone form: digits only, a leading Malaysian 60 read as 0. Null unless the
 *  term looks like a phone (digits and + - space ( ) . only, 4+ digits). */
export function phoneDigits(term: string): string | null {
  const t = term.trim();
  if (!/^[+\d\s\-().]+$/.test(t)) return null;
  let d = t.replace(/\D/g, "");
  // "+60…" always; a bare "60…" only when long enough to be a full number
  // (Malaysian numbers are 9–11 digits with the 0), so a typed "601" stays.
  if (d.startsWith("60") && (t.startsWith("+") || d.length >= 10)) d = "0" + d.slice(2);
  return d.length >= 4 ? d : null;
}

export function searchTerms(term: string): SearchTerms {
  const compact = compactTerm(term);
  const phone = phoneDigits(term);
  return {
    like: `%${term}%`,
    compact: compact.length >= 3 ? `%${compact}%` : null,
    phone: phone ? `%${phone}%` : null,
  };
}

/** The link for one result row. */
export function resultHref(source: SearchSource, id: string, label: string): string {
  const by = source.hrefBy ?? "id";
  if (by === "none") return source.hrefPrefix;
  return `${source.hrefPrefix}${encodeURIComponent(by === "label" ? label : id)}`;
}

/** A source is usable only when its table and every column it names exist. */
export function isSourceUsable(
  source: SearchSource,
  columnsByTable: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const cols = columnsByTable.get(source.table);
  if (!cols) return false;
  const needed = [source.idCol, source.labelCol, ...source.searchCols];
  return needed.every((c) => cols.has(c));
}

/**
 * The SELECT for one source.
 *
 * Every identifier comes from SEARCH_SOURCES — a hard-coded module constant —
 * and is additionally filtered against the live column list before it gets
 * here, so no caller-supplied string is ever interpolated. Only the search
 * term and the org id are bound, and they are bound as PARAMETERS.
 *
 * Columns listed in `subCols` that the table does not actually have are
 * dropped rather than failing the query, so a source stays searchable when a
 * cosmetic column is missing.
 */
export type SearchBind = "like" | "compact" | "phone" | "org";

export function buildSourceSql(
  source: SearchSource,
  availableCols: ReadonlySet<string>,
  limit: number,
  forms: { compact?: boolean; phone?: boolean } = {},
): { sql: string; bindCount: number; binds: SearchBind[] } {
  const subs = source.subCols.filter((c) => availableCols.has(c));
  const subSelect = [0, 1, 2]
    .map((i) => (subs[i] ? `${subs[i]}` : `NULL`) + ` AS sub${i + 1}`)
    .join(", ");
  const binds: SearchBind[] = [];
  const preds: string[] = [];
  for (const c of source.searchCols) {
    preds.push(`COALESCE(${c}::text,'') ILIKE ?`);
    binds.push("like");
  }
  // Only columns that are ALSO search columns (so already checked against the
  // live schema by isSourceUsable) get the extra forms.
  if (forms.compact) {
    for (const c of (source.compactCols ?? []).filter((x) => source.searchCols.includes(x))) {
      preds.push(`regexp_replace(lower(COALESCE(${c}::text,'')),'[^0-9a-z]','','g') LIKE ?`);
      binds.push("compact");
    }
  }
  if (forms.phone) {
    for (const c of (source.phoneCols ?? []).filter((x) => source.searchCols.includes(x))) {
      preds.push(`regexp_replace(regexp_replace(COALESCE(${c}::text,''),'[^0-9]','','g'),'^60','0') LIKE ?`);
      binds.push("phone");
    }
  }
  const orgClause = source.orgCol && availableCols.has(source.orgCol)
    ? ` AND (${source.orgCol} = ? OR ${source.orgCol} IS NULL)`
    : "";
  if (orgClause) binds.push("org");
  const sql =
    `SELECT ${source.idCol} AS rid, ${source.labelCol}::text AS label, ${subSelect}` +
    ` FROM ${source.table}` +
    ` WHERE (${preds.join(" OR ")})${orgClause}` +
    ` LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`;
  return { sql, bindCount: binds.length, binds };
}
