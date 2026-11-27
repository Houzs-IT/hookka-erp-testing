# How-to guides (AI Connector process help)

> **Last generated: 2026-11-27** by `scripts/gen-howto-index.mjs` from `src/api/lib/howto/`.

Staff ask Claude "how do I…" and the AI Connector answers from these guides (owner ask 2026-11-27).
The guides are **data**, not prose: `src/api/lib/howto/`. This index is generated from that data — edit the data, then run `node --import tsx/esm scripts/gen-howto-index.mjs`.

- Tools: `how_to {question?, topic?, company?}`, `module_overview {module?}`, `glossary {term?}`, `explain_error {text}`, `onboarding {role}` (logic `src/api/lib/mcp-howto.ts`, wired in `src/api/routes/mcp.ts`). Prompts: `how_do_i`, `explain_module`, `what_does_it_mean`, `explain_this_error`, `my_first_week`.
- Honesty tests: `tests/mcp-howto.test.mjs` (+ `tests/_howto-check.mjs`) — every page path is in the router, every double-quoted UI label is in `src/`, every error fragment is real, every guide has a company tag, canDo follows RBAC.
- Writing a guide: follow `src/api/lib/howto/types.ts` (SOP fields). Read the real page + API route; cite each enforced business rule in a code comment (`// src/...:line`), never in user text; never invent a rule (there are no written approval limits). Check one file: `node --import tsx/esm scripts/check-howto-fragment.mjs src/api/lib/howto/guides-<area>.ts`.
- Companies: Hookka is ONE tenant org; the organisations registry holds HOOKKA and sister companies (e.g. OHANA). They change the letterhead / purchase company / sales org; accounting stays HOOKKA. No flow in the code is company-specific today, so every guide is tagged `ALL`; customer-type differences (consignment, customer hubs, per-customer prices, purchase company, sales org) are `variants`.
- Gap log: help questions with no guide are logged in `mcp_calls` (note `no-guide`, emails / numbers stripped) and listed on SYSTEM → AI Connector → "Questions with no guide yet".

## Task guides (33)

| id | title | module | page | permission |
| --- | --- | --- | --- | --- |
| `create-sales-order` | Create a sales order | Sales | `/sales` | sales-orders:create, sales-orders:confirm |
| `create-delivery-order` | Create a delivery order from a sales order | Delivery | `/delivery` | delivery-orders:create, delivery-orders:update |
| `create-invoice` | Create an invoice from a delivery order | Invoices | `/invoices` | invoices:create, invoices:post |
| `record-customer-payment` | Record a customer payment (receipt) against invoices | Finance | `/accounting` | payments:create |
| `delivery-return` | Record a delivery return | Delivery | `/delivery-returns` | delivery-returns:update |
| `print-documents` | Print or download sales documents and stickers | Sales | `/sales` | any of sales-orders:read / delivery-orders:read / invoices:read / production-orders:read |
| `create-purchase-order` | Create a purchase order (PO) and send it to the supplier | Procurement | `/procurement/create` | purchase-orders:create |
| `receive-goods-grn` | Receive goods against a PO (GRN) | Procurement | `/procurement/grn` | grn:create, grn:update |
| `record-purchase-invoice` | Record a supplier (purchase) invoice | Procurement | `/procurement/pi/create` | purchase-invoices:create, purchase-invoices:update |
| `mrp-shortages-to-po` | Check material shortages (MRP) and raise POs from them | Procurement | `/planning/mrp` | mrp:read, purchase-orders:create |
| `add-po-note` | Add or change a note on a purchase order | Procurement | `/procurement` | purchase-orders:update |
| `record-supplier-payment` | Pay a supplier (AP Payment) | Finance | `/accounting` | accounting:create |
| `create-production-order` | Create production orders and job cards, then view and print the job cards | Production | `/sales` | production-orders:read, any of sales-orders:confirm / consignments:create |
| `worker-scan-job-card` | Worker: log in on the phone and scan a job card to complete a department task | Production | `/worker/login` | worker-portal:use |
| `complete-qc` | Complete a quality check (QC) — on the office QC page or the worker phone | Quality | `/quality` | qc-inspections:create |
| `fg-scan` | Scan finished-goods units (Pack / Load / Deliver / Return) on the FG Unit Scan page | Production | `/production/fg-scan` | fg-units:create |
| `production-planning` | Schedule job-card due dates with Planning → Schedule Proposals | Production | `/planning` | production-orders:update |
| `outsource-work` | Issue work to an outsourced worker and approve it when it comes back | Production | `/production/outsource-issue` | outsource-issues:create |
| `create-product` | Create a new product (finished good SKU) | Products & BOM | `/inventory` | products:create, inventory:read |
| `create-variant` | Add variants: new sizes / compartments of a model, and default fabric / height settings | Products & BOM | `/inventory` | products:create, products:update |
| `edit-bom` | Create or edit a product's BOM (bill of materials) | Products & BOM | `/bom` | bom:update |
| `product-costing` | View or edit a product's costing (labour + materials, margin) | Products & BOM | `/products/:id/costing` | products:read, any of product-costing:read / cost-ledger:read |
| `set-selling-price` | Set or change a product's selling price (master price and customer price) | Products & BOM | `/products` | products:update, product-pricing:read |
| `stock-adjustment` | Make a stock adjustment (correct on-hand quantity) | Warehouse | `/inventory/adjustments` | inventory:create, stock-movements:read |
| `stock-take` | Do a month-end stock take (stock count) | Warehouse | `/inventory/stock-take` | inventory:create |
| `open-service-case` | Open a service case (customer complaint / after-sales issue) | Quality / After-sales | `/service-cases` | service-cases:create |
| `move-service-case-stage` | Move a service case through its stages to closed | Quality / After-sales | `/service-cases` | service-cases:update |
| `add-case-note` | Add a note (action log entry) to a service case | Quality / After-sales | `/service-cases` | service-cases:update |
| `create-service-order` | Create a Service Order (aftersales rework / replacement order) | Quality / After-sales | `/service-order` | sales-orders:create |
| `mail-center-reply` | Reply to an email in Mail Center | Mail Center | `/mail-center` | mail-center:create |
| `apply-leave` | Apply for leave (currently not available in the ERP) | HR / Employees | `/employees` | leaves:create |
| `attendance-working-hours` | Record and check attendance and working hours | HR / Employees | `/employees` | attendance:read |
| `maintenance-log` | Log equipment maintenance | HR & Operations / Maintenance | `/maintenance` | equipment:update |

## End-to-end flows

- **Order to cash: sales order to customer payment** (`flow-order-to-cash`): `create-sales-order` (Sales / sales admin) → `create-production-order` (Sales admin (confirms the SO) / production planner) → `worker-scan-job-card` (Floor workers (worker app PIN login)) → `complete-qc` (QC inspector / department leader) → `fg-scan` (Packing / warehouse) → `create-delivery-order` (Logistics / delivery admin) → `create-invoice` (Logistics marks delivered; finance checks / sends invoices) → `record-customer-payment` (Finance)
- **Procure to pay: material shortage to supplier payment** (`flow-procure-to-pay`): `mrp-shortages-to-po` (Purchasing) → `create-purchase-order` (Purchasing) → `receive-goods-grn` (Warehouse / store keeper) → `record-purchase-invoice` (Finance / purchasing admin) → `record-supplier-payment` (Finance)
- **Product setup: new product to selling price** (`flow-product-setup`): `create-product` (R&D / admin) → `create-variant` (R&D / admin) → `edit-bom` (R&D / production planner) → `product-costing` (Admin / Finance / R&D only) → `set-selling-price` (Admin / sales manager)
- **After-sales: delivery return and service case to close** (`flow-after-sales`): `delivery-return` (Logistics / after-sales) → `open-service-case` (After-sales / customer service) → `add-case-note` (After-sales / service agent) → `move-service-case-stage` (After-sales) → `create-service-order` (After-sales / sales admin)
- **Payroll inputs: attendance and working hours to payroll** (`flow-payroll-inputs`): `worker-scan-job-card` (Floor workers) → `attendance-working-hours` (HR / supervisors) → `apply-leave` (Workers / HR)

## First-week reading paths (`onboarding`)

- **Sales / sales admin** (`sales`): `flow-order-to-cash`, `create-sales-order`, `set-selling-price`, `create-production-order`, `create-delivery-order`, `print-documents`, `mail-center-reply`
- **Purchasing** (`purchasing`): `flow-procure-to-pay`, `mrp-shortages-to-po`, `create-purchase-order`, `add-po-note`, `receive-goods-grn`, `record-purchase-invoice`, `mail-center-reply`
- **Production / factory** (`production`): `flow-order-to-cash`, `create-production-order`, `worker-scan-job-card`, `complete-qc`, `production-planning`, `outsource-work`, `fg-scan`, `maintenance-log`, `attendance-working-hours`
- **Warehouse / store** (`warehouse`): `receive-goods-grn`, `stock-adjustment`, `stock-take`, `fg-scan`, `create-delivery-order`, `delivery-return`, `print-documents`
- **Finance / accounts** (`finance`): `flow-order-to-cash`, `flow-procure-to-pay`, `create-invoice`, `record-customer-payment`, `record-purchase-invoice`, `record-supplier-payment`, `product-costing`, `flow-payroll-inputs`
- **After-sales / customer service** (`after-sales`): `flow-after-sales`, `open-service-case`, `add-case-note`, `move-service-case-stage`, `create-service-order`, `delivery-return`, `mail-center-reply`

## Modules (`module_overview`)

- **OVERVIEW** — Dashboard, the daily Hookka Report, notifications, announcements and the shared Mail Center.
- **SALES & CUSTOMERS** — Sales orders, delivery orders, delivery returns, invoices, consignment, customers and the sales pipeline.
- **PRODUCTION** — Production orders and job cards per department, planning, outsource work and folders.
- **PRODUCTS & BOM** — Products, CNC templates, BOMs, WIP times, component kits and sofa combos.
- **WAREHOUSE** — Inventory, fabrics, stock value, stock adjustments, stock take and warehouse racks.
- **PROCUREMENT** — Purchase orders, goods receipts, purchase invoices, purchase returns, MRP, suppliers and procurement reports.
- **R&D** — R&D projects and R&D maintenance.
- **QUALITY** — QC / Quality inspections, service cases and service orders.
- **FINANCE** — Accounting reports, receipts and payment vouchers, journals, debtors (AR), creditors (AP), e-Invoice and setup.
- **FORECASTING** — Finance dashboard, forecast P&L and the board report.
- **HR & OPERATIONS** — Employees (workers, attendance, working hours, payroll) and equipment maintenance.
- **SYSTEM** — Organisations (companies), the AI Connector and system settings.

## Glossary and errors

- `glossary`: 39 terms (SO, PO, Stock PO, GRN, PI, DO, Invoice, Job card, Production order, WIP, FG, BOM, Variant, Fabric tier, MRP, QC, Service case, Service order, Delivery return, Purchase return, Credit note, Debit note, AR aging, AP aging, Receipt, Payment voucher, e-Invoice, Sen vs RM, Floor Live, Efficiency %, PIC, ETA, MOQ, Consignment, Customer hub, Purchase company, Stock adjustment, Stock take, Outsource).
- `explain_error`: 68 real ERP messages (`src/api/lib/howto/errors.ts`).

## Screen map (`explain_screen`, `where_is`)

- 157 router pages (48 in full detail), 1206 buttons / tabs / menu items — `src/api/lib/howto/screens-*.ts`. Links carry `?highlight=<label>`, which outlines that element in the ERP.
