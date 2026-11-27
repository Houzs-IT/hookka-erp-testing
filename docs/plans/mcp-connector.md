# Hookka ERP MCP connector — plan

> **Last verified: 2026-11-27** — round 4d (morning brief email, urgent alerts, `data_gaps`) on `feat/mcp-4d` (§3f). Before that: v1 live (#1610); actions with confirmation, document flow and the SO PDF (§3b); round 3 quick answers, daily brief, Excel export, rate limit (§3c); round 4 Hookka K1–K12 + `company_report` (§3d); round 4b write actions + 4c platform quality on `feat/mcp-4bc` (§3e).

Owner 2026-11-25: 「我的全套系统都要有mcp」, staff (non-IT) should ask Claude / ChatGPT
questions about the ERP the way the owner asks in this session; 「按员工自己的权限」 —
what a person cannot see in the ERP, the AI cannot see either; the owner must be able to
see who connected and what they asked.

## 1. What it is

A remote MCP server at `https://<erp host>/api/mcp` (Streamable HTTP, JSON-RPC, stateless).
Any MCP client that supports custom connectors with OAuth (Claude Team / Enterprise / Pro,
ChatGPT plans with connectors) adds that URL; the person signs in with **their own ERP
account**; every question is answered by calling the ERP's existing read endpoints **as that
person**, so the existing RBAC (`requirePermission`, per-user overrides, tenant scope,
customer scope) decides what comes back. Nothing is re-implemented, so the AI's figures are
the page's figures.

## 2. Rules (non-negotiable)

1. **Read-only, except two confirmed actions.** An MCP token can only make `GET` requests
   (plus `POST /api/mcp` itself) — enforced in `auth-middleware.ts`, not in the tools, so no
   tool bug can write. The one exception (owner 2026-11-26, §3b): a meeting booking or an email
   the person confirmed, through the two routes in `ACTION_ALLOWLIST` (`mcp-inner.ts`), only
   while the admin switch is on.
2. **Own permissions.** The token carries the user's identity; role / override changes apply
   on the next call; a deactivated user or a password reset kills every MCP token.
3. **Opt-in per person.** New resource `ai-connector` (held back from every wildcard, like
   `meeting-rooms`): only admins, or people ticked in the per-user permission editor, may
   connect.
4. **Everything logged.** Each tool call writes `mcp_calls` (who, which client, tool, path,
   status, ms, when). Admin page shows it.
5. **Revocable.** Admin can disconnect a person (all their tokens) or one connection; a person
   can disconnect themselves.
6. **No secrets through the AI.** Auth/session/user-admin/internal/cron/MCP endpoints are
   blocked from the generic reader even for admins.

## 3. Tools (v1)

| Tool | What | Backed by |
| --- | --- | --- |
| `list_modules` | The ERP's modules and the read endpoints in each, with a one-line meaning | curated catalog + `app.routes` (GET only, blocklist removed) |
| `erp_get` | Read any allowed endpoint (`path` + `query`) and return its JSON (trimmed to a safe size) | in-process `app.fetch` with the caller's MCP token |
| `search` | Global search across SO / customers / products / POs … | `GET /api/search` |
| `whoami` | Who I am connected as, my role, what I may read | `/api/auth/me/permissions` |

**Quick answers (2026-11-25, owner: "search 资料有点慢").** `sales_summary {period}` and
`production_summary {from, to}` answer the commonest questions in ONE call with a summary of a
few hundred characters (before: list_modules → list_endpoints → erp_get, and a 24–60k-character
reply). They read the same endpoints the Dashboard reads, as the person, through `readValue`, so
the module gate and redaction are unchanged. `erp_get` also takes `fields` to keep only the keys
needed, and its cap dropped to 30k. The instructions now tell the AI to try a quick answer first.

**More quick answers (2026-11-26):** `order_backlog` (sales-orders/stats + the Dashboard's production block: orders and RM by status, not yet delivered, backlog days, overdue by customer), `receivables_summary` (accounting/aging, AR only: owed by age, top debtors, oldest unpaid), `material_shortages` (mrp/plan: short materials soonest-needed first, BOM gaps). Same `readValue` path, so each is refused for a role that may not open its source page.

**search / fetch (2026-11-25).** ChatGPT outside Developer Mode only accepts a connector with a
`search` and a `fetch` tool, and deep research uses only those two
(https://developers.openai.com/api/docs/mcp). `search {query}` returns `{results:[{id,title,url}]}`
from `/api/search` (id = `<kind>:<row id>`); `fetch {id}` opens the record at the kind's detail
endpoint (`FETCH_API`) through `readValue`. **Prompts:** `prompts/list` offers three ready-made
questions (monthly sales review, production vs last month, find a document).

## 3b. Actions with confirmation, document flow, SO PDF (2026-11-26)

Owner 2026-11-26: the connector may DO a few ordinary things for the signed-in person —
「等等一些普通功能」 — **book a meeting** and **send an email**, designed as 「先确认再做」
(confirm first, then do). Never orders, money, stock, approvals or deletes.

| Tool | What |
| --- | --- |
| `propose_meeting {title, start, end?, attendees[], room?, notes?}` | Reads `/api/meetings/bootstrap` as the person, resolves colleagues by name / email (an outside email becomes an emailed guest), the room by name, Malaysia times; warns early about clashes from `/api/meetings/calendar`. Stores a pending action, answers a summary + `confirmationId`. Nothing is booked. |
| `propose_email {to[], cc?[], subject, body, from_mailbox?}` | Checks `mail-center:create`, the compose route's recipient rules (`parseAddressList` / `invalidAddresses`), and that the From is one of the person's own mailboxes (`/api/mail-center/addresses`, already scoped). Stores a pending action. Nothing is sent. |
| `confirm_action {confirmationId}` | Switch on → under 30 confirmed actions today (Malaysia day) → single-use claim (`UPDATE … WHERE used_at IS NULL AND cancelled_at IS NULL AND expires_at > now AND token_id = ? AND user_id = ? RETURNING`) → ONE in-process POST to `POST /api/meetings/meetings` or `POST /api/mail-center/compose` **as the person** (`innerAction`), so the route's own permission check, mailbox scope, hub conflict check and audit trail apply. A hub 409 comes back as "it clashes: …". |
| `cancel_action {confirmationId}` | Drops a pending action. |
| `document_flow {number_or_id}` | Anchor from `/api/search` (or `kind:id`): sales / service order, production order, delivery order, invoice → its sales order(s) (a consolidated DO lists one per line) → `GET /api/sales-orders/:id` (`linkedPOs` + job cards, `linkedDOs`, `linkedInvoices`, `linkedPayments`) + `/:ref/footprint` (open job cards). Each link: type, number, status, date, amount (RM; null when redacted), ERP URL. All reads through `readValue`. |

**The write fence** (`mcp-inner.ts`, checked in `auth-middleware.ts`): a non-GET with an
`hkmcp_` token passes ONLY when (1) the per-isolate inner secret header is present, (2) the
`x-hookka-mcp-action` header names an action, (3) that action was armed by `confirm_action`
for this token + method + path within 30 s, right after it consumed the pending row in this
same request — one-shot, deleted on first use — and (4) method + path is in
`ACTION_ALLOWLIST` = `POST /api/meetings/meetings`, `POST /api/mail-center/compose`. Anything
else stays 403 "The AI connector is read-only" (unit test: a plain MCP-token POST is refused).

**Owner control:** Settings › AI Connector › "Allow AI actions (meetings, email)", default OFF,
stored in `kv_config['mcp_actions_enabled']`; while off, `propose_*` / `confirm_action` answer
"AI actions are switched off by your admin". Every proposal / confirmation / cancel is a row in
`mcp_calls` (target = kind + recipients / title + subject — never the email body) and shows in
Recent questions as "Proposed … / Confirmed …".

**Storage:** `mcp_pending_actions` (runtime self-apply, snake_case; `lib/mcp-actions.ts`):
id, token_id, user_id, kind, payload_json, summary, created_at, expires_at (10 min), used_at,
cancelled_at, result_status, result_note. `payload_json` is blanked as soon as the action ran,
was cancelled or expired, so an email body is kept only while it waits for the yes.

**PDFs:** `get_pdf` now renders **sales orders** server-side too — the SO page's Download PDF
already uses the same pdf-lib generator (`generate-so-pdf.ts` → `renderUnifiedSalesOrderBytes`
= `buildUnifiedSalesOrderData(salesOrderInputFromOrder(order, customer.companyAddress))`), and
the server calls those same functions with `GET /api/sales-orders/:id` and the customer's
company address (`GET /api/customers/:id`). **Purchase orders** still print through a
browser-only jsPDF + jspdf-autotable template (`generate-purchase-order-pdf.ts`, letterhead
drawing, ~450 lines); porting it to the Worker is not a clean port, so `get_pdf` returns the
ERP page link with "press PDF there".

**Untested live:** confirm against the real IT Hub and the real mail provider (only mocks /
unit tests so far); the SO PDF from a real order on prod.

## 3c. Round 3 — more quick answers, daily brief, Excel export, rate limit, speed (2026-11-26)

Owner-approved shared spec (Hookka / Houzs / Conts) + the owner's FAQ (one tool call per
question). Branch `feat/mcp-round3`. **RBAC rule unchanged:** every new tool reads ONLY
through `readValue` (module gate → inner GET as the person → `makeRedactor`); a 403 becomes
"You don't have access to X" and the rest of the answer still comes back. No connector-only
permission rules.

| Tool | Reads (all as the person, in parallel) | Notes |
| --- | --- | --- |
| `inventory_summary` | `/api/inventory?buckets=rawMaterials`, `/api/inventory/fg-stock` (optional) | negative / below own minimum / zero raw materials; FG units in stock + reserved |
| `purchasing_summary {view, days}` | `/api/purchase-orders/stats`, `/api/grn/stats` (overview / awaiting only) | views `overview`, `overdue` (P1), `awaiting` (P4), `suppliers` (P2: received date vs expected date over `days`, default 90) — open/overdue = the Procurement page's `isOverdue` incl. billed-in-full |
| `payables_summary` | `/api/accounting/aging` (AP half) | needs `accounting:read` (the ERP's finance permission); ERP ageing is by invoice month; past due + due in 7 days use the PI due dates |
| `so_overdue` | `/api/sales-orders?fields=orders-due&top=50` | Hookka SOs have no salesperson field — the answer says so; capped at the 50 soonest-due (`atLeast` flag) |
| `deliveries_due {range}` | `/api/delivery-orders?status=DRAFT,LOADED,DISPATCHED,IN_TRANSIT&page=1&limit=500`, orders-due | DOs by delivery date + SOs by Hookka expected date |
| `production_late` | `/api/production-orders/board` (snapshot, ~125 KB) | live orders past target end date, by current department / customer |
| `receivables_summary` (extended) | `/api/accounting/aging` + `/api/delivery-orders?status=LOADED,…,DELIVERED&page=1&limit=500` | adds "shipped but not invoiced" (newest 500 shipped DOs) |
| `attendance_today` | `/api/attendance?date=today`, `/api/leaves?status=APPROVED`, `/api/workers` | HR endpoints only; staff without attendance/leave read get "no access (HR only)" |
| `daily_brief` + prompt `daily-brief` | orders-due, PO stats, `/api/mail-center/threads?status=open&limit=100`, `/api/service-cases/approvals` (only with `service-cases:approve`), `/api/leaves?status=PENDING` (only with `leaves:update`) | ≤ 5 reads at once; each section = count + top 5 with links |
| `export_excel {list, search, status, from, to, fields}` | the list's own GET, `page/limit=500`, page 1 then the rest in parallel, cap 5,000 rows | lists: sales-orders, delivery-orders, invoices, purchase-orders, grn, production-orders, customers, suppliers, products, raw-materials, service-cases |
| `document_flow` (extended) | PO + `/api/grn?poId=` at once, then `/api/purchase-invoices?supplierId=` | P5: purchase order → GRNs → purchase invoices |

Decisions worth knowing:
- **Mail Center in the brief** reads `/api/mail-center/threads` through a FIXED read
  (`MAIL_THREADS_READ`, gate `mail-center:read`) — `/api/mail-center` is NOT added to the
  readable-module map, so `erp_get` still cannot read mail bodies. "Waiting for me" =
  open, last message inbound, and unread-for-me or assigned to me (first 100 open threads).
  The Mail Center PR's dedicated `/waiting-count` can replace this later.
- **Pending acknowledgements**: Hookka's announcement acks are worker-portal only (no ERP
  user list), so the brief has no acknowledgement section.
- **Ownership**: Hookka SOs / POs have no personal owner; the brief shows what the person's
  role can read.
- **export_excel**: SheetJS `xlsx` (already a dependency, already in the Worker bundle via
  `lib/assistant-exports.ts`); `…Sen` columns → "(RM)" ÷ 100 with `#,##0.00`; nested lines
  are left out; filters run on the fetched rows (newest 5,000 when truncated). Stored like
  `get_pdf`: `hookka-files/mcp-exports/<org>/`, 15-minute signed link
  (`uploadExportAndSign`). Logged in `mcp_calls` as `export:<list> rows=N [truncated]`.
- **Rate limit** (`lib/mcp-limits.ts`): `tools/call` only, 30 / minute and 600 / Malaysia
  day per person, one indexed count on `mcp_calls (user_id, created_at)` (the index
  `mcp_calls_user_idx` already self-applies in `ensureMcpTables`, so no new migration).
  Refused calls (status 429) and the leak check (`mcpc_leak_check`, which uses `runToolAs`
  and never hits the limit) are not counted. Over → ordinary tool result with `isError`.
  If the count query fails the call goes through (fail open).
- **Speed**: the six redactor permission checks are asked once per request + person
  (was once per read, sequential); quick answers read in parallel and use the narrow
  projections the pages already have (`buckets=rawMaterials`, `fields=orders-due`, `/board`,
  `/stats`); successful quick answers / daily brief are cached 30 s per person + role +
  arguments in the isolate (door still checks the token every request). The admin page's
  "Answer speed" card shows median / p95 per tool for the last 24 h against the 7 days before
  (from `mcp_calls.ms`, logged since launch) — the before/after for this release.

### FAQ → tool (owner 2026-11-26; Hookka)

| # | Question | Tool |
| --- | --- | --- |
| P1 | Which POs are overdue? | `po_overdue` (round 4; also `purchasing_summary {view: "overdue"}`) |
| P2 | Which suppliers are late most often? | `supplier_lateness {period}` (round 4; also `purchasing_summary {view: "suppliers"}`) |
| P3 | How much do we owe suppliers? | `payables_summary` (accounting permission) |
| P4 | What is still waiting to be received? | `purchasing_summary {view: "awaiting"}` |
| P5 | Show the flow of PO X | `document_flow` (purchase order → GRN → purchase invoice) |
| S1 | Which SOs are overdue? | `so_overdue` (no salesperson field in Hookka) |
| S2 | What is due for delivery today / this week / next week, and what is overdue? | `deliveries_due {range: "today" \| "week" \| "next_week"}` |
| S3 | Delivered not invoiced (with age); invoiced not paid? | `uninvoiced_deliveries`; `receivables_summary` |
| S4 | Sales by salesperson / outlet | not in Hookka (no salesperson / outlet data); totals and by customer: `sales_summary` |
| S5 | Show the flow of SO X | `document_flow` |
| M1 | Which production orders are late? | `production_late` |
| M2 | Which materials are short? | `material_shortages` |
| M3 | What is low or negative in stock? | `inventory_summary` |
| H5 | Who is on leave or absent today? | `attendance_today` (HR only) |
| E1 | What do I need to look at today? | `daily_brief` / prompt `daily-brief` |
| E2 | Export X to Excel | `export_excel` |
| K4 | Do we have stock of X? | `stock_check {query}` |
| K5 | What does product X cost to make? | `product_cost {product}` (costing permission) |
| K6 | What did each department / worker produce today / this week? | `production_output {period}` |
| K8 | Raw materials: low, short, price changes | `raw_material_summary {period}` |
| K9 | Gross profit by product / customer / invoice | `gross_profit {period, by}` (cost needs costing permission) |
| K10 | How long does product X take to make? | `production_lead_time {product, period}` |
| K11 | Who / which department is least efficient, and the labour cost? | `worker_efficiency {period}` |
| R1 | The company's management report for a month / quarter / year | `company_report {period, month}` (accounting permission) |

**Untested live (round 3):** every new tool against prod data and a real Claude / ChatGPT
client; the xlsx download through the signed link; the rate limit under real traffic.

"The whole system" = every module's GET endpoints, through `erp_get`; the catalog tells the
model which endpoint answers which question (production revenue, department output, MRP /
stock status, orders, delivery, invoices, payroll for those allowed, …).

## 3d. Round 4 — complete the connector (owner 2026-11-26)

Branch `feat/mcp-round4`. Code: `src/api/lib/mcp-round4.ts` (pure summaries), `routes/mcp.ts`
`round4Tool` (the reads), tests `tests/mcp-round4.test.mjs`. Same rule as before: every read
goes through `readValue` as the person (module gate → inner GET → `makeRedactor`); a refused
read becomes "You don't have access to X"; a money field the person may not see comes out as
`null` (never 0). At most 5 reads per answer, in parallel.

**Period** (every period tool): `period` = `today` | `week` (Monday → today) | `month` (to date)
| `last_month` | `quarter` (to date) | `year` (to date) | `custom` with `from` / `to`; the answer
carries the period before (same days of the previous week / month / quarter / year, or the
same length before a custom range) — `resolvePeriod`.

| Tool | Reads (as the person) | ERP permission that gates it (module gate → route) |
| --- | --- | --- |
| `po_overdue` (K1) | `/api/purchase-orders/stats` | `purchase-orders:read` → same. Houzs output shape. |
| `supplier_lateness {period \| days}` (K2) | `/api/purchase-orders/stats` | `purchase-orders:read`. Received date = set by the GRN that completed the PO. Default last 90 days. |
| `uninvoiced_deliveries` (K3) | `/api/delivery-orders?status=SIGNED,DELIVERED` (500 a page, ≤ 4 pages) | `delivery-orders:read` → same. |
| `stock_check {query}` (K4) | `/api/inventory?buckets=rawMaterials`, `/api/products?search=`, `/api/inventory/fg-stock`, `/api/procurement-reports/outstanding-lines` | `inventory:read` / `products:read` / `purchase-orders:read`, each optional. `balanceQty` is a "balance" key, so it is hidden for roles without pricing / accounting (existing redaction rule — reported, not changed). |
| `product_cost {product, tier}` (K5) | `/api/products?search=`, `/api/product-costing/:id` | gate `cost-ledger:read` OR `product-pricing:read` (route: `products:read`) — the connector is stricter than the page. Inside the gate costing money is shown (cost-ledger is a money module). |
| `production_output {period}` (K6) | `/api/dashboard/floor-live/completed` (period + period before), `/api/dashboard/floor-live/summary`, `/api/dashboard/floor-live` (live today) | gate `dashboard` / `dashboard-experimental` / `production-orders` read (route: `production-orders:read` or the Operations dashboard tab). Production value (`…Sen`) hidden without pricing. |
| `worker_efficiency {period}` (K11) | as K6 + `/api/accounting/dashboard` (whole-month periods, labour cost by department) | as K6; labour cost needs `accounting:read`, refused → left out. |
| `raw_material_summary {period}` (K8) | `/api/inventory?buckets=rawMaterials`, `/api/mrp/plan`, `/api/price-history` | `inventory:read` (needed), `mrp:read`, `price-history:read` (optional). |
| `gross_profit {period, by}` (K9) | `/api/invoices/line-summary` (period + period before), `/api/product-costing/summary` | `invoices:read` (needed); cost needs `cost-ledger` / `product-pricing` read, else revenue only. |
| `production_lead_time {product, period}` (K10) | `/api/production-orders?status=COMPLETED&include=none` (500 a page, ≤ 4 pages, newest first) | `production-orders:read`. |
| `deliveries_due {range}` (K12, extended) | unchanged reads; `range` adds `next_week`; adds `overdueDeliveryOrders` | `delivery-orders:read`, `sales-orders:read`. |
| `company_report {period, month}` | `/api/accounting/dashboard?granularity=month&from&to` (the Board Report's source rows), `/api/accounting/aging` | `accounting:read` → same. |

Decisions worth knowing:
- **K7 PO server PDF: skipped.** The PO prints through a browser-only jsPDF + autotable
  template; porting it is not cheap (see §3b). `get_pdf` for a PO still returns the page link.
- **K8 consumption this month: skipped** — the only source is `GET /api/cost-ledger?type=RM_ISSUE`,
  which returns the whole history (no date filter). Not read.
- **No warehouse split** in K4 / K8: Hookka has one balance per raw material and counts finished
  goods from production orders (`RmLot.warehouse` is always null).
- **GP cost** = today's BOM costing (labour + priced materials, first fabric tier) × quantity — a
  standard cost, flagged `costUnderstated` when the BOM has unpriced lines. Invoice lines carry no
  SO number, so "GP per document" is per invoice.
- **Efficiency** = Floor Live's earned ÷ clocked minutes, helpers left out; past days from Floor
  Live's saved copies + today live. Merging today into the saved days recomputes earned ÷ clocked
  (a helper-only day keeps the person unrated).
- **company_report** uses the Finance dashboard's monthly rows rather than the cached Board
  Report itself: the Board Report is one month at a time and may answer "building" (202).
- **Leak check** now also runs every round-4 tool as the chosen account (`LEAK_CHECK_TOOLS`,
  rows `tool:<name>`); RM fields left in a tool that is not a money module are flagged.

**Untested live (round 4):** every tool against prod data through a real client; the leak check
as a low-privilege account.

## 3e. Round 4b write actions + round 4c platform quality (owner 2026-11-26)

Branch `feat/mcp-4bc`. Code: `src/api/lib/mcp-write-actions.ts` (propose → confirm, pure + deps),
`src/api/lib/mcp-visibility.ts` (role-aware list, structured output, links + RM), fence in
`mcp-inner.ts`, switches in `mcp-actions.ts`, wiring in `routes/mcp.ts`; tests
`tests/mcp-4bc.test.mjs`.

**4b — write actions.** Same mechanism as §3b: `propose_*` stores one pending action (10 minutes,
single use, same token + person) and writes nothing; `confirm_action` → main switch → 30-a-day cap →
the action's own switch (peeked, so a switched-off action is refused without using up the id) →
single-use claim → **body fence** (`actionBodyAllowed`) → ONE in-process call to the ERP's own route as
the person (`innerAction`, armed one-shot). The route's own permission check, validation, reply guard /
stale-edit check and audit decide. Every proposal / confirmation is a row in `mcp_calls` (target = kind +
record, never the message or note text).

| Tool (args) | ERP endpoint (existing) | ERP permission the route checks | Switch | Audit trail |
| --- | --- | --- | --- | --- |
| `propose_mail_reply {thread_id, body, from_mailbox?}` | `POST /api/mail-center/threads/:id/reply` with `{text, afterMessageId, fromAddress?}` — `force` is never sent, so the reply guard refuses if a colleague replied after the proposal | `mail-center:create` + the thread must be in the person's mailbox scope | `mcp_action_mail_reply` | route's own `emitAudit` (mail-center reply) |
| `propose_note {target_type: purchase_order, number_or_id, note}` | `PUT /api/purchase-orders/:id` with `{notes, expectedUpdatedAt}` — one `[Note <date> <name> (via AI Connector): …]` line appended to the notes read at confirm time (the PO page's own annotation style) | `purchase-orders:update` | `mcp_action_note` | route's own `emitAudit` (PO update, before/after) |
| `propose_note {target_type: service_case, number_or_id, note}` | `PUT /api/service-cases/:id` with `{actionLog}` — one "Action taken" entry appended to the log read at confirm time (the case page's own body) | `service-cases:update` | `mcp_action_note` | the route writes none, so the connector writes one `audit_events` row (`emitAudit`, source `api`) |
| `propose_po_approval {number_or_id}` | `PUT /api/purchase-orders/:id` with `{status: "CONFIRMED", expectedUpdatedAt}` = the PO page's "Mark Confirmed"; only offered for a `SUBMITTED` PO; carries the stamp the person saw, so a PO changed since is refused (409) | `purchase-orders:update` + `purchase-orders:approve` | `mcp_action_po_approval` | route's own `emitAudit` |

- **Switches:** Settings › AI Connector › "AI write actions", one per row above, default OFF
  (`kv_config['mcp_action_<name>']`), Super Admin only (`POST /api/mcp-admin/admin/write-actions`),
  effective only while "Allow AI actions" (the main switch) is on.
- **Skipped — no note endpoint:** sales orders (only the full edit `PUT /api/sales-orders/:id`, which
  locks once production starts and rewrites the header + BOM check) and production orders (their
  `PUT` / `PATCH` has no notes field). Not a new write path, so not built.
- **The fence:** `ACTION_ALLOWLIST` is now six patterned routes (`:ref` = one safe id segment); the body
  per kind may carry only the keys the ERP screen sends for that action — a PO note can never carry
  items, prices, supplier or status; a PO approval only `status: "CONFIRMED"`. Payments, stock,
  prices, payroll and deletes stay unreachable.
- **Race handling:** notes are appended to what is stored at confirm time (a colleague's note added in
  between survives); the PO note carries that read's `updatedAt`.

**4c — quality.**
- **P1 role-aware tools/list:** each read tool lists the endpoints it reads (`TOOL_NEEDS`); it is
  listed only when the person passes the SAME module gate `readValue` applies (`classifyPath` →
  resources → `read`). E.g. `payables_summary` / `company_report` need `accounting`, `product_cost`
  needs `products` + (`product-costing` or `cost-ledger`). Write tools: switch on + the route's
  permission. A hidden tool called directly answers "You don't have access to this in the ERP".
- **P2 prompts per role:** `owner_morning_report`, `finance_review`, `purchasing_review`,
  `production_review`, `warehouse_review`, `sales_review` (plus the four before); `prompts/list` shows a
  prompt when one of its tools is listed (`PROMPT_TOOLS`).
- **P3 structured output:** the 24 quick answers carry an open `outputSchema`; their result carries
  `structuredContent` (the same JSON as the text, which stays).
- **P4 cache:** 60 s per person + role + arguments (was 30 s); `payables_summary`, `so_overdue`,
  `deliveries_due`, `production_late` added.
- **P5 links + RM:** every quick answer gets `erpLink` (its ERP page); a row with a record id but no
  link gets `url`; any `…Sen` key left in an answer becomes `…Rm` (a hidden figure stays null).
  Rows keyed only by a name (supplier in `supplier_lateness`, stock items) have no record page to point
  at and rely on `erpLink`.

**Untested live (4b / 4c):** every write action against prod through a real client (unit tests use a
faked ERP that applies the route's permission gate); `structuredContent` against Claude / ChatGPT's
validators; the filtered tools/list in a real client.

## 3f. Round 4d — morning brief email, urgent alerts, data gaps (owner 2026-11-26)

Owner: 「加 全部一起做」. Branch `feat/mcp-4d`. Code: `src/api/lib/mcp-proactive.ts` (pure: config, due
rules, alerts, debounce, data gaps, email HTML), `src/api/lib/mcp-proactive-store.ts` (tables),
`src/api/routes/mcp-proactive.ts` (tick, unsubscribe, the person's settings),
`src/pages/settings/AiBriefSettings.tsx` + `useAiBriefSettings.ts`; tests `tests/mcp-proactive.test.mjs`.
D3 (group monthly report) is built in IT Hub, not here.

**As the person, always.** Each run issues the person a connector token of their own (client
`mcpc_morning_brief`, "Morning brief" in the connections list for the seconds it lives) and revokes it in
`finally`. The brief is the `daily_brief` tool through `runToolAs`; Monday adds the `data_gaps` tool the
same way; the alert reads go through `readManyAsPerson` (`routes/mcp.ts`) — the same `readValue` path
(module gate, then the route's own permission check, then `makeRedactor`). No service account. A PO / SO
whose value the person's role hides is never value-alerted (a hidden figure cannot pass a threshold), so an
alert never reveals a figure they cannot see. The brief / test runs are tool calls in `mcp_calls` (client
"Morning brief"), excluded from the person's rate limit; the 30-minute alert reads are not logged as calls
(only the emails they send are).

**Who:** a person approved for AI Connector (or a Super Admin), active, with an email, who opted in on
Settings > AI Connector > "Morning brief & urgent alerts by email". Defaults: both OFF, 08:00, weekdays.

**Schedule.** No new cron infrastructure: `POST /api/internal/agents/heartbeat` (every 30 min from the
`hookka-agent-heartbeat` Cron Worker `*/30`, with the hourly GitHub `agent-heartbeat.yml` as fallback)
fires `POST /api/internal/mcp-proactive/tick` (CRON_SECRET) as a same-origin sub-request on its own
invocation, before the agents' kill-switch check (it is not an agent). Each tick:
- **briefs**: people whose time (Malaysia, half-hour steps) has come today and who have not had today's
  brief, within 4 h of their time; at most 15 a tick;
- **alerts**: 07:00-20:00 Malaysia time, people with alerts on, least recently checked first, none checked
  in the last 25 min; at most 15 a tick;
- a 20 s budget; people one at a time (the identity sits on the request context).
`?dryRun=1` answers the counts (subscribers, briefs due, alert checks due) and sends nothing.

**Idempotent.** `mcp_proactive_keys (user_id, alert_key, day)` is the ledger: the key `brief` is claimed
(`INSERT ... ON CONFLICT DO NOTHING RETURNING`) before the brief is built, so a second tick that day gets
nothing back and sends nothing; a build that fails gives the claim back so a later tick can retry. Alert
keys (`po:<id>`, `so:<id>`, `prod:<id>`, `mat:<code>`) are claimed before sending and dropped when sent
within their window (newly overdue: once; shortages: again after 7 days), never twice a day.

**Alert rules** (`PROACTIVE_CONFIG`, the one place; shown read-only on the settings page):

| Alert | Read (as the person) | Rule |
| --- | --- | --- |
| PO newly overdue | `GET /api/purchase-orders/stats` | open (not received / closed / cancelled / delivered in full), 1-2 days past its expected date, value >= RM 5,000 (500,000 sen) |
| SO newly overdue | `GET /api/sales-orders?fields=orders-due&top=50` | open, 1-2 days past its Hookka expected date, value >= RM 5,000 |
| Production newly late | `GET /api/production-orders/board` | live, 1-2 days past its target end date |
| Material newly short | `GET /api/mrp/plan` | short > 0 and first needed within 7 days |

One email per tick with every new alert (max 10 lines, the rest counted). Known limit: `orders-due`
returns the 50 sales orders due soonest, so with more than 50 older overdue orders a newly overdue one can
fall outside the read.

**Email.** Through the ERP's outbox (`enqueueEmail` into `outbox_emails`, drained to Brevo / Resend).
Clean English HTML + plain text: each brief section with its count and top 5, every line a link into the
ERP; Monday appends "data gaps to fill". Footer: settings link + unsubscribe link. Each send is a row in
`mcp_proactive_sends` (kind, items, outbox id, status), never the body or subject.

**Unsubscribe.** `GET /api/mcp-proactive/unsubscribe?t=<token>` shows one button; the `POST` turns brief
and alerts off. GET does nothing on purpose: mail scanners (Outlook Safe Links, Gmail) pre-open links. The
32-character random token is the only credential; no user id in the link.

**The person's own page:** `GET/PUT /api/mcp-admin/proactive/me` (settings), `GET /me/preview` (the brief
built as you, shown in a sandboxed frame, NOT sent), `POST /me/test` (a `[Test]` brief with data gaps to
your own email; at most once per 10 minutes).

**`data_gaps` tool (D4).** Read-only quick answer, listed when the person may read any of its lists; each
list they cannot read is left out (`noAccess`). Counts and the first five with links, no money:

| Gap | Read |
| --- | --- |
| products without a BOM / selling price | `GET /api/products/setup-incomplete` |
| BOMs with no material besides the fabric line (`otherLines = 0`); products whose BOM has lines without a price, or a zero cost | `GET /api/product-costing/summary` |
| open sales orders without a Hookka expected delivery date | `GET /api/sales-orders?page=1&limit=500` (the 500 newest) |
| active workers without a department | `GET /api/workers` |
| active suppliers with no material binding | `GET /api/suppliers` + `GET /api/supplier-materials` |

**Untested live:** a real brief / alert email on prod (no email was sent while building); the heartbeat
sub-request reaching the tick on prod; the unsubscribe page through a real mail client.

## 3g. Process help — how-to guides, flows, modules, glossary, errors (owner 2026-11-27)

Owner ask: staff who don't know how to do something (open a service case, create a PO…) ask
Claude and get click-by-click guidance. All read-only, no external AI, keyword scoring only.
Index of every guide / flow / module / term: [`docs/how-to/README.md`](../how-to/README.md).

| Tool | What it returns | Data |
| --- | --- | --- |
| `how_to {question?, topic?, company?}` | top 1–3 SOP guides (or one end-to-end flow, every step expanded click by click): sidebar path, exact labels, fields (required / rule / example), checks, result, warnings, undo, approvals, common mistakes, worked example, `?highlight=` step links, and `canDo` from the person's ERP permissions (false → "You don't have permission for this in the ERP — ask your supervisor or admin.") | `src/api/lib/howto/guides-*.ts`, `flows.ts` |
| `module_overview {module?}` | per sidebar section: purpose, key pages (link + `canOpen` from `nav-permissions.ts`), who uses it, links to other modules; no module → one line each | `howto/modules.ts` |
| `glossary {term?}` | plain-English definitions (SO, PO, GRN, DO, job card, WIP, FG, BOM, variant, fabric tier, MRP, QC, service case, delivery return, credit note, AR / AP aging, sen vs RM, Floor Live, efficiency %, PIC, ETA, MOQ, …) | `howto/glossary.ts` |
| `explain_error {text}` | meaning, cause and fix for real ERP error messages (each `match` is a verbatim string from `src/`) | `howto/errors.ts` |
| `onboarding {role}` | first-week reading path (sales, purchasing, production, warehouse, finance, after-sales) | `howto/flows.ts` `ONBOARDING` |

Prompts: `how_do_i`, `explain_module`, `what_does_it_mean`, `explain_this_error`, `my_first_week`.
Gap log: a help call with no match is logged in `mcp_calls` with note `no-guide` and the question
(emails / document numbers / phone numbers stripped, `scrubQuestion`); SYSTEM → AI Connector shows
"Questions with no guide yet" (last 30 days) so we know what to write next.
Companies: one tenant org; HOOKKA / OHANA etc. are letterhead / purchase-company / sales-org
choices and no flow is company-specific in the code, so every guide is tagged `ALL` and the
real differences (consignment, customer hubs, per-customer prices, purchase company) are
`variants`. Honesty tests: `tests/mcp-howto.test.mjs`.

### FAQ → tool (process help)

| Staff ask | Tool |
| --- | --- |
| "How do I create a PO?" / "开PO" / "macam mana buat PO" | `how_to` |
| "How do I open a service case?" / "开售后case" | `how_to` |
| "How do I receive goods?" / "收货" / "terima barang" | `how_to` |
| "What is the whole process from order to payment?" | `how_to` (returns the order-to-cash flow) |
| "What is the Procurement module for?" | `module_overview {module: "procurement"}` |
| "What does GRN / WIP / fabric tier mean?" | `glossary` |
| "I got 'You're not allowed to do that…' — what now?" | `explain_error` |
| "I'm new in purchasing, what should I read first?" | `onboarding {role: "purchasing"}` |

## 4. OAuth (what Claude / ChatGPT need)

- `/.well-known/oauth-protected-resource[/api/mcp]` and
  `/.well-known/oauth-authorization-server` (Pages Functions under `functions/.well-known/`).
- `POST /api/mcp/oauth/register` — dynamic client registration (public clients, PKCE).
- `GET /api/mcp/oauth/authorize` — uses the normal ERP login (redirects to `/login?next=…`),
  checks `ai-connector`, shows a consent page ("<client> will be able to READ Hookka ERP as
  <you>"), double-submit CSRF on Allow.
- `POST /api/mcp/oauth/token` — `authorization_code` (S256 PKCE) and rotating
  `refresh_token`. Access token `hkmcp_…` 24 h; refresh 90 days. Only SHA-256 hashes stored.
- Tables (runtime self-apply, snake_case): `mcp_oauth_clients`, `mcp_oauth_codes`,
  `mcp_tokens`, `mcp_calls`.

## 5. Admin + staff UI

`Settings › AI Connector` (`/settings/ai-connector`):
- the connector URL to copy + step-by-step "how to connect" for Claude and ChatGPT;
- admin: who is connected, which app, connected on, last used, calls; recent questions;
  Disconnect (one / all of a person);
- everyone else: their own connections + Disconnect.

## 6. Phases

1. **v1 (this branch):** server, OAuth, tools, logging, admin page, how-to. Verify end to end
   on prod with a real client before telling staff.
2. **v1.1:** richer catalog descriptions per module from what staff actually ask (read
   `mcp_calls`).
3. **Later, only if the owner asks:** any write tool (each one separately approved). The
   first two — meeting and email, with confirmation — were approved 2026-11-26 (§3b).

## 6b. Leak check (before any staff use)

`POST /api/mcp-admin/admin/leak-check` (Super Admin; `src/api/lib/mcp-leak-check.ts`, card on the AI Connector page): runs `tools/call erp_get` through the real `/api/mcp` as a chosen APPROVED staff account over every GET list endpoint of every readable module (side-effect-looking GETs skipped), 20 per request, 4 at a time, with a token issued for the run and revoked after. Reports only outcomes and field NAMES: opened / refused, the families hidden, and money / people keys still present (flagged unless the module is a money document). Never values.

## 7. Known limits / decisions

- A client's chat text stays on the AI vendor's side; we log only the ERP calls it made.
- Response size is trimmed (~60 KB per call); the model is told to narrow with query params.
- Binary endpoints (PDF / files) return a note, not bytes.
