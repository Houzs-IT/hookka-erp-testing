> **Last verified: 2026-11-10** against Houzs-Century/Houzs-ERP #4387–#5567 and hookka-dev/Conts-ERP #1–#820 (all titles; ~520 generic PR bodies read, mostly the opening of each body) and Hookka origin/main. Nothing run; prod effects UNMEASURED.

# Cross-system review, pass 2 — items the first pass (2026-11-10-cross-system-review.md) missed

Five read-only reviewers, one PR range each. Only items that are generic, not already in Hookka and not in pass 1 are listed. Owner-rejected items (credit-note cap from delivery returns, MRP stale-plan refusal, partial DO/invoice discount share) are excluded.

**Triage (main session, 2026-11-10):** batches A1–A4 below are low-risk and being built without approval; everything marked *needs approval* waits for the owner (listed in tasks/HANDOFF.md).

- **A1 documents/PDF:** H1-1, H1-6, H3-4, H3-8, H3-9, H3-10, C2-3, H3 B7
- **A2 procurement:** H1-5, H2-2/C2-5, H2-3/C2-7, H2-8, H2-9/C2-6, C2-4, C2-8, H2 B1 (code only; data repair needs approval)
- **A3 forms, navigation, search:** H1-4, H3-1/C2-2, C2-1, C1-8, C1-11, H3-11/C2-9/C2-10, H2-10/C1-9
- **A4 reliability & security bugs:** H3 B1–B6, B8, C1-7, C2-11, H3-7, H1-7
- **Needs owner approval:** H1-2/H2-7 stock count workflow · H1-3 separate Post GRN right · H1-8 charge-only invoice without DO · H2-1 merge duplicate item codes · H2-4 planned payment date on supplier bills · H2 B2 bank-reco date limit · H2 B3 future-dated supplier price applied today · H2 B4 maintenance surcharge config not company-scoped · H3-2 enforce must-change-password · H3-3 TOTP replay + encrypted secret · C1-1 session max lifetime · C1-2 admin signs a person out everywhere · C1-3 admin password reset rules · C1-4 staging view-as · H3-5 purchase return replacement question · H3-6 per-company default bank · C1-6 purchase-return shortfall prompt · C1-10 payroll bank-transfer export · C2-12 selfie required for clock-in · C2-13 expense claims / petty cash · C2-14 limit users to product categories · H2-5 supplier delay score · H2-6 outstanding PO lines ageing report



---

## Range H1

Scope: 374 merged PRs (merged 2026-10-01 to 2026-10-22). All 374 titles read. 161 were skipped on the title alone as Houzs's own business (POS, PMS/events/fairs/Project Overview/Event Commission, delivery sheet/Delivery Planning/Connect/chat-callback, fleet/TMS/lorries, AutoCount, sofa drawings on PO PDFs, scan-GR/scan-SO tuning, 2990 company items, consignment/PC Order, payment requests/欠正式单, Product Profit, CI/docs chores). For the other 213 I read the PR body, but only its first 330–480 characters (the symptom, cause and fix summary). No diffs read, nothing run. Hookka was checked with targeted greps under `src/` (branch `feat/leads-products-shared-grid`, pulled 2026-11-10).

Left out on purpose: anything already in Hookka, anything in `docs/plans/2026-11-10-cross-system-review.md` (including its "Not applicable" list: AR/AP aging rewrite, URGENT on PO PDFs, scan rules, RBAC rebuild), and the three items the owner rejected.

**Prod effect of every item and bug below: UNMEASURED.**

## New items

| id | What it does for the user | Source PR(s) | Hookka today | Size | Risk |
|---|---|---|---|---|---|
| H1-1 | Supplier, customer and item names with accented or Chinese characters (KŌRI, 广州…) print correctly on every PDF instead of as "?" or garbled letters | Houzs#4697, #4705 (embed a Noto subset that covers Latin Extended-A), #4777 (give the font files content-hashed names so a long browser cache cannot serve the old font) | The jsPDF generators only use built-in `helvetica` (`src/lib/generate-purchase-order-pdf.ts:178`). The worker renderer swaps anything it cannot encode for "?" (`src/api/lib/unified-do-invoice-pdf.ts` `winAnsi()`). The only `embedFont` call loads StandardFonts (`src/lib/pod-photos-pdf.ts:113`). Hookka now handles CNY suppliers, so Chinese names are likely. Unverified whether any real record has such characters today | M | low |
| H1-2 | A stock count you can work through: create a count sheet per warehouse or rack (optionally only items that have stock), print it, key the counts or read the paper back, add a note per line, see each line's gain or loss in RM, then post the variances as one adjustment | Houzs#4496 (several assignees, only-with-stock, add line, RM gain/loss), #4498 (read the counted sheet back, move goods to the counted rack when posted), #4502 (text rack box: 704 lines × 77 rack dropdowns froze the page), #4622 (note per line) | Hookka's "Stock Take" is a finance valuation import, a count file priced at the latest purchase (`src/lib/stock-take-import.ts`, `StockTakeTab` in `src/pages/accounting/index.tsx`). Adjustments are single-item, immediate entries (`src/api/routes/stock-adjustments.ts:2-23`). No warehouse count document was found under `src/pages/inventory` or `src/pages/warehouse.tsx` | L | money/stock/payroll — needs owner approval |
| H1-3 | Store staff receive goods as a draft GRN, and only someone with a separate "Post GRN" right puts the stock in | Houzs#4413 (`scm.grn.post` capability, checked on every path that posts) | GRN create and edit are gated only by `grn:create` / `grn:update` (`src/api/routes/grn.ts:1415`, `:1923`). Manual create posts straight away (CODEBASE-MAP "No-Draft on MANUAL create") | M | money/stock/payroll — needs owner approval |
| H1-4 | Arrow keys (and Enter) move between line fields on every document editor (SO, PO, GRN, PI, DO), like a spreadsheet, so typing a column of quantities needs no mouse | Houzs#4491 (one document-level listener, `lineGridNav`) | `src/lib/grid-keys.ts` does exactly this, but only `src/pages/forecast.tsx` uses it | M | low |
| H1-5 | When one goods receipt covers several POs, each line shows which PO it came from, on the detail page and in the list's side panel | Houzs#4387, #4762 | The create page shows the owning PO per line (`src/pages/procurement/grn/create.tsx:1141`). The detail page shows only a header "Linked PO", which is "—" for a multi-PO receipt (`src/pages/procurement/grn-detail.tsx:783-791`), and its line table has no PO column (`:954-962`) | S | low |
| H1-6 | A printed or reprinted sales invoice lists each payment received against it (date, receipt number, amount) and the balance still due | Houzs#4486 (each payment listed, never just "Deposit") | `src/lib/generate-invoice-pdf.ts` prints only the terms text (`:591-606`). No paid or balance figure was found there or in `src/api/lib/unified-do-invoice-pdf.ts`. Display only: no posting changes | S–M | low |
| H1-7 | Service cases get a target number of days per stage that the office can edit. The list flags overdue cases and the stage tabs count the overdue ones. A changed target applies to open cases straight away | Houzs#4754 | The service-case list shows days in stage (`src/pages/service-cases/index.tsx:237` `stageDaysLabel`) but has no target or overdue flag. No `sla` / `target` found in `src/api/routes/service-cases.ts` | M | low |
| H1-8 | Raise a sales invoice for a charge-only order (transport, storage, extra charge after delivery) without first making a delivery order | Houzs#4599 | `POST /api/invoices` refuses without `deliveryOrderId` (`src/api/routes/invoices.ts:1703-1708`). Hookka has Debit Notes, which may already cover extra charges. Owner to decide whether this is needed at all | M | money/stock/payroll — needs owner approval |

Looked at and dropped because Hookka already has it or something close: DB caps on convert chains (Houzs#4606/#4613/#4617/#4620/#4625; Hookka has an atomic guarded `receivedQty` update at `grn.ts:826`, a CHECK on `grn_items.invoiced_qty` at `purchase-invoices.ts:144` and an advisory lock on DO creation); an invoiced DO can't be cancelled (#4607; Hookka refuses at `delivery-orders/_helpers.ts:~1060`, and its invoice is one-DO, so the multi-DO hole does not apply); config in effect today with tie-break (#4504; `maintenance-config.ts:151`); default variant per model (#4512; `products.ts` `defaultVariants`); supplier CN knock-off (#4411/#4415; Supplier Discount allocations); Enter picks in SearchableSelect (#4757); phone money keyboard (#4545; `MoneyInput` `inputMode="decimal"`); mail center, IT Support, numbered stock adjustments (`adjNo`), aging as at a date.

Not verified, so not listed: DO "item not ready" warning (#4485), whether a deactivated product is still offered on new SOs (#4421/#4746), dead/excess finished-goods rule (#4674/#4726; Hookka has a dead-stock block in `hookka-report-editions.tsx`, rule not read), state-name aliases (PENANG/KL) for city and postcode lists (#4716).

## Bugs Hookka probably shares

| Bug (sister fix) | Where the same pattern sits in Hookka | Risk |
|---|---|---|
| A phone pasted as `60123456789` under the +60 picker is stored as `+60 60123456789`, so messages and calls go to a dead number (Houzs#4582, #4603; #4584 left alone numbers that are too short to be real) | `normalizeLocalNumber` in `src/lib/contact-format.ts:53-70` strips a leading `+60` and a trunk `0`, but not a bare `60`. `joinPhone` (`:99`) then stacks it. A guard needs a real Malaysian number shape (mobile `1x` + 7–8 digits), as Houzs#4584 found | low |
| Cancelling an SO does not release its stock allocation (Houzs#4687) | `sales-orders/_helpers.ts:979-995` cancels every non-completed production order with this `salesOrderId`. That includes stock-built orders allocated to the SO, which are cancelled instead of going back to the stock pool. A COMPLETED stock piece keeps `sales_order_id` = the cancelled SO, so `loadAvailability` (`src/api/lib/stock-allocations.ts:229-238`) counts it as allocated for good. Release happens only through the manual `POST /api/stock-allocations/release` (`routes/stock-allocations.ts:344`). Unverified whether the UI asks for a release before the cancel | money/stock/payroll — needs owner approval |
| A file the browser hands over with an empty MIME type is refused (Houzs#4669: a PDF attach showed nothing) | `src/api/routes/files.ts:249-251` turns an empty `file.type` into `application/octet-stream`, which is not in `ALLOWED_MIME`, so the upload is rejected. The fix is to take the type from the extension and then still check the magic bytes, which happen right after (`:256-261`). How often browsers send an empty type to Hookka is unmeasured (it happens on Windows for extensions it does not recognise, e.g. `.heic`) | low |


---

## Range H2

Checked 2026-11-10 against the Hookka source after `git pull` (branch `feat/leads-products-shared-grid`). Read-only. No diffs run, no tests run, nothing measured on prod. **Every prod-state statement below is UNMEASURED.**

Scope: there are 375 merged PRs in the range. I read all titles. I read 82 bodies in full: every PR that was not clearly Houzs-only business (POS, PMS/fairs/events, Event Commission, Delivery Planning board, Last Mile, fleet, WhatsApp/Connect, AutoCount, delivery sheet, sofa drawings, merchant/bank finance redesign, 2990 specifics, HR ported from Hookka, RBAC rebuild, Supabase/PostgREST perf). For #5027 I also read the file list, because its body describes a different change.

Left out:
- Anything already in Hookka.
- Anything the first review (`docs/plans/2026-11-10-cross-system-review.md`) already lists: G2/G4/G8/G9, D2, sticky header, idempotency key, and similar.
- Anything the owner rejected.

## New items

| id | What it does for the user | Source PR(s) | Hookka today | Size | Risk |
|---|---|---|---|---|---|
| H2-1 | Merge duplicate item codes into one from the item master. You pick the code to keep and add the old ones. **Check** writes nothing and lists refusals and line counts. **Merge** moves stock lots across with their own date and cost, and keeps an undo trail | #4956, #5003, #5011, #5012 | No merge route or button. I searched `src/api/routes/raw-materials.ts`, `products.ts` and `pages/products`. Duplicates today are fixed by script, if at all | L | money/stock/payroll — needs owner approval |
| H2-2 | "Copy as new" on a Purchase Order: the supplier and lines are copied. The number, dates, status, received qty and SO link are not | #4892. Follow-ups: #5026 drops one-off promo/reward lines, #5034 re-checks inactive items on the copy | SO and Consignment Order already have **Clone** (`src/pages/sales/detail.tsx:1103,1394`, `src/pages/consignment/detail.tsx:681,908`). The PO detail and create pages have none (`src/pages/procurement/detail.tsx`, `create.tsx`) | S | low |
| H2-3 | The PO list shows each PO's GRN number(s) and GRN date, so nobody has to open the PO, then its map, then the GRN | #5045 | The PO list columns stop at Total and Status, with no GRN column (`src/pages/procurement/index.tsx:1617-1700`) | S | low |
| H2-4 | Finance sets a **planned payment date** on each posted supplier bill, next to the supplier's due date and never instead of it. Bills still owed sort by plan. The calendar shows each bill on its planned day. Overdue still counts by due date | #5169 (also #5167, bill page) | A PI has only `dueDate` (`src/api/routes/purchase-invoices.ts:1728`, fixed next-month term). Cash Position has a free-text `planned_payments` table with no link to a bill (`src/api/routes/accounting.ts:19254`) | M | low (nothing posts) |
| H2-5 | One supplier delay score (0–100) on the last 90 days. It weights on-time %, how late, the share of what is still to come that is overdue, and quality cases. It also shows "overdue RM × days". Worst first; a click opens that supplier's overdue PO lines | #5089, #5091 | `src/api/routes/supplier-scorecards.ts` gives on-time rate, defect rate and average lead days per supplier. It has no weighted score, no overdue value and no RM × days. How much of this the existing scorecard UI already covers is unverified | M | low |
| H2-6 | Every outstanding PO **line** in one list, by category or supplier, layered Over 30 / 15–30 / 8–14 / 4–7 / 1–3 days late / not yet due, sortable and exportable to Excel. Separately, the full dead and buffer stock list, sortable and exportable | #5076, #5081, #5075, #5086 | The PO list has PO-level overdue buckets only (`src/pages/procurement/index.tsx:1494-1505`). Dead stock appears only in the Hookka Report editions (`src/pages/hookka-report-editions.tsx:38`) | M | low |
| H2-7 | A physical stock count sheet per warehouse. Count on paper or on screen, delete any line with Undo before Save, export to Excel (variance = counted − system), then post the variances as adjustments | #4831, #4862, #4930, #4933, #4935 | I found no count-sheet module. Accounting's Stock Take is a priced closing-stock upload (CODEBASE-MAP lines 74 and 125, `StockTakeTab`). Inventory has adjustments (`src/pages/inventory/adjustments.tsx`). **Unverified**: I searched by keyword only | L | money/stock/payroll — needs owner approval |
| H2-8 | A PO keeps every delivery date the supplier gives (Date 1, then revised Date 2/3/4). A recorded date can't be overwritten, so the slip history stays | #5035 (the feature itself is #4571, outside this range) | A PO has `expectedDate` only (`src/pages/procurement/index.tsx:1665`). No supplier-date fields in `src/api/routes/purchase-orders.ts` or `pages/procurement` | M | low |
| H2-9 | A document opened from another page (a report, a map, another document) has a Back button that returns to that page, in the same spot, and is labelled with its name | #4822 (same idea for create flows: #4975) | `src/lib/workspaceTabs.ts` keeps no opener. Detail pages hard-code their list (`src/pages/delivery/detail.tsx:452`, `src/pages/invoices/detail.tsx:441`). The first review's G2 covers list state on Back, not returning to the page you came from | S–M | low |
| H2-10 | The IT Support form accepts .zip files (logs, many screenshots). Samuel asked for this on every system | #4946 (needed hub PR Houzs-IT/houzs-hub#42 deployed first) | `FILE_ACCEPT` has no zip (`src/pages/it-support/index.tsx:117`). The server forwards whatever it gets (`src/api/routes/it-support.ts:108-126`). Whether the hub takes zip from Hookka is unverified | S | low |

## Bugs Hookka probably shares

| # | Sister-repo fix | The same pattern in Hookka | Risk |
|---|---|---|---|
| B1 | **More than one "main supplier" per item.** Houzs#5077 makes every bind path demote the old main first. Houzs#5085 adds `UNIQUE (…, item) WHERE is_main_supplier` | POST sets `isMainSupplier` without clearing the item's other main (`src/api/routes/supplier-materials.ts:293`). PUT does the same (`:461-464`, `:505`). Readers then pick whichever main they meet last: MRP `mainBindingByCode` (`src/api/routes/mrp.ts:773-775`) and the PO price hint (`src/api/routes/accounting.ts:20970`). How many items have two mains today is UNMEASURED | Code fix low. A data repair changes which supplier MRP proposes: money/stock/payroll — needs owner approval |
| B2 | **Bank reconciliation: a later month's bank line removes an earlier month's outstanding entry.** Houzs#5134: only lines dated on or before the month end may clear an entry for that month | `GET /bank-reco` marks a leg `matched` if **any** statement line matched it, whatever its date (`src/api/routes/accounting.ts:18143-18150`). The screen's "Book — not yet in the bank" list is built from that flag (`src/pages/accounting/index.tsx:16809`, `:17326`). Example: a June voucher the bank paid in July drops off June's outstanding list once July is matched. The A4 report (`computeBankRecoReport`, `clearedOn` dates, `accounting.ts:19050-19054`) is date-aware, so screen and report can disagree for a past month. Effect on real months is UNMEASURED | Display-only fix, but finance: owner should see it |
| B3 | **A future-dated supplier price is charged from today.** Houzs#5065 / #4973 price a PO from the newest price dated on or before the PO date | The SKU form accepts any Effective From date (`src/pages/procurement/sku-form-dialog.tsx:417-422`). The PUT then overwrites the binding's `unitPrice` straight away (`src/api/routes/supplier-materials.ts:436-437`, `:497-505`; history row only at `:532-548`). New POs read the binding's current `unitPrice` (`src/pages/procurement/create.tsx:224-232`). Whether anyone has keyed a future-dated price is UNMEASURED | money/stock/payroll — needs owner approval |
| B4 | **Master maintenance (variant surcharge) config is not company-scoped.** Houzs#4824 / #4861 / #5031: one company's surcharges leaked into another company's SO and PO prices | `maintenance_config_history` has no org column (`migrations/0071_maintenance_config_history.sql:21-29`). The resolver reads by `scope` only (`src/api/routes/maintenance-config.ts:77-86`, `:145-153`), while `products` is org-scoped (`src/api/routes/products.ts:468-478`). This only bites if a second organisation prices on its own. Whether any second org has live SOs is UNMEASURED | money/stock/payroll — needs owner approval |

## Checked and dropped (already in Hookka or not applicable)
- Admin sets a new password (#4848): `src/api/routes/users.ts:651`, `src/pages/settings/Users.tsx:883`.
- CSV UTF-8 BOM (#4979): `src/lib/export-csv.ts:49`, `src/lib/csv-cell.ts:39`, `src/lib/export-report.ts:41`.
- Paged reads without ORDER BY (#4894, #4903, #5132): Hookka's LIMIT/OFFSET reads all order by a key. Hookka does not read through PostgREST.
- Daily AI cost to the IT Hub (#4996): `src/api/lib/ai-usage.ts`.
- Unit cost on found stock (#4913): `src/pages/inventory/adjustments.tsx:264`.
- PageHeader wrap (#4918): `src/components/ui/page-header.tsx:75` already has `max-w-full flex-wrap`.
- PO picker hides inactive items (#4899): `src/pages/procurement/create.tsx:201`. The server does not re-check this. That is a minor gap, not listed.
- "NOT changed" after a timeout (#4992): Hookka's "Nothing was saved" appears only on HTTP refusals.
- Not applicable:
  - DateField fixes (#4951, #4991): Hookka uses native date inputs.
  - Receipts following payment edits (#5044, #5046): Hookka's receipt is the payment itself.
  - Delivery-return cancel cap (#5036 C): a Hookka DR does not reopen SO qty.
  - Purchase-return REPAIR hold (#5027): Hookka has no REPAIR return.
  - Pull SO lines into an existing DO (#4877, #5029): a Hookka DO has one SO and no add-line route.
  - MRP snapshot refresh (#5122): Hookka MRP is run-based.
  - Mobile-SO line dates and Processing Date (#4809, #5019, #5130, #4976): no such concept in Hookka.
  - Model rename (#5118, #5120): Hookka keys on `baseModel` per product, no model entity. Unverified.
- Unverified and not listed:
  - Sales Report margin on goods only (#4872): I could not confirm whether Hookka sells delivery/installation as zero-cost lines.
  - Quality donut drill (#4798).
  - SO picker search by customer ref (#5101).


---

## Range H3

Checked 2026-11-10 against Hookka `origin/main` (4f7da1663). The local `git pull --ff-only` refused ("Cannot fast-forward to multiple branches"), so `git fetch origin main` was used and every Hookka ref below is from `origin/main`. Nothing was run, no diffs were read, and every claim about production state is **UNMEASURED**.

## Coverage

- 379 merged PRs in range. All titles were read.
- 101 PR bodies were read (about the first 1,000 characters each; #5402 in full). #5403's body is a copy of #5402's, so only its title was used.
- 278 were skipped on title. They were Houzs-only work: the Finance redesign batch steps, POS, PMS/fairs/events, fleet/lorries/last-mile/delivery planning, sofa costing, scan-GR/PI/SO matching, merchant/card reconciliation, AutoCount, Venture Portal, product-merge tickets, staging/CI chores. Others were already in the first review (`docs/plans/2026-11-10-cross-system-review.md`), such as #5342, #5359, #5404, #5409, #5414, #5415, #5423, #5435, #5461–#5467, #5477, #5478, #5482, #5484–#5493, #5499, #5501, #5508–#5510, #5515–#5517 and #5520.
- Many in-range bodies are ports from Hookka ("Sister fix: Hookka #604 / #937 / #268 / #680 / #675 / #289 / #528 / #890"). Hookka already has those and they are not listed.
- Checked and **already in Hookka**, so not listed:
  - MoneyInput select-on-focus (`money-input.tsx:33`)
  - Number-box wheel guard (`src/lib/number-input-wheel-guard.ts`)
  - Staging sanitise (`sync-staging.yml` + `scripts/sanitize-staging.mjs`)
  - Secret scan (`secret-hygiene.yml`)
  - GRN status compare-and-set (`grn.ts:855-872`)
  - GRN supplier ≠ PO supplier refusal (`grn.ts:1589`)
  - Multi-PO GRN lock (`grn.ts:997` `GRN_OF_PO_SQL`)
  - Duplicate supplier bill refusal (`purchase-invoices.ts:643`, `:1471`)
  - No 500-row cap on bill lists
  - Held SO excluded from allocation (`stock-allocations.ts:242`)
  - PV approve posts in one batch, so "approved but not posted" cannot happen
  - Bank line → journal (`/bank-reco/book-line`)
  - Credit note applied to invoice (`credit-notes.ts:138`)
  - Chart-of-accounts audit (`accounting.ts` `emitAudit` on `/coa`)
  - Header-account refusal
  - PDF split by page (`scan-engine.ts:1488`)
  - Ordered paged reads (#1207)
  - In-flight cache fix (`cached-fetch.ts:421`)
  - Searchable-select keyboard
  - Projects-attachment key leak: no Hookka route streams a file by caller-supplied key; `files.ts` reads by id + orgId
- Not applicable to Hookka: PO/GRN/DO warehouses (#5211, #5333, #5421, #5422; Hookka's PO/GRN carry no warehouse), payment requests (#5255), SO amendments (#5470, #5541), the SO lock once a supplier PO is raised (#5444; Hookka SOs feed production orders), DO short-stock re-ask (#5533; Hookka DOs are driven by FG units).

## New items (generic, not in Hookka, not in the first review)

| id | What it does for the user | Source PR(s) | Hookka today | Size | Risk |
|---|---|---|---|---|---|
| H3-1 | Leaving a half-filled SO, PO, GRN or payment form by menu, link, Back or phone swipe first asks "Leave without saving?" | Houzs#5539 | `src/lib/use-nav-guard.ts` (in-app guard) exists but is used on only 5 pages (customers, forecast, PI detail, products, service-case detail). `sales/create.tsx:694` and `sales/edit.tsx` use `useUnsavedChanges`, which only covers closing the tab or refreshing (`use-unsaved-changes.ts:11-13` says in-app route changes are deliberately not guarded). `procurement/create.tsx`, `procurement/detail.tsx`, the GRN create pages and supplier payments have no guard. | S | low |
| H3-2 | An admin-created account must choose its own password at first sign-in. An admin can "Require password change", which also signs that person out on every device. | Houzs#5530 | **The toggle does nothing today.** `add-user-drawer.tsx:43` defaults "must change password" ON, `users.ts:138` stores it, and `auth.ts:103-121` returns `mustChangePassword`. But no screen, route guard or server check reads it (grep over `src/pages`, `src/lib`, `src/components`). Only the change-password route clears it (`auth.ts:740`). | M | low (auth; owner picks the rollout time) |
| H3-3 | A 6-digit sign-in code works once (no replay within its ~90 s window), and the authenticator secret is encrypted at rest | Houzs#5560 | `src/api/lib/totp.ts:10` says the secret is "Stored *unencrypted*". `verifyTotp` (`totp.ts:206-219`) accepts ±1 step and keeps no last-used step. | S–M | low (needs a Worker secret for the key) |
| H3-4 | Delivery photos upload the moment they are taken. They come back after the phone reloads the page under the camera, each can be retried or removed, and the user can pick from the photo library. | Houzs#5397, Houzs#5526 | `src/pages/m/components/PodSheet.tsx:24,69-78` keeps photos as raw (uncompressed) data URLs in page memory and sends them all at Complete. `:178` `capture="environment"` forces the camera. `.slice(0, 5 - photos.length)` drops extra photos without telling the user. Desktop `POD-dialog.tsx` compresses but also submits everything at the end. | M | low |
| H3-5 | A purchase return asks "Will the supplier send a replacement?". Answering "No" keeps the PO received, so it does not reappear in Purchase Outstanding. | Houzs#5452 | `src/api/lib/purchase-return-create.ts:574-578` always gives the returned qty back to the PO line (`:659` `receivedQty - ?`) on the assumption that a replacement is coming | M | stock — needs owner approval |
| H3-6 | Each company sets its own default bank for money in and for money out (for example, receive in Maybank, pay from Hong Leong) | Houzs#5241 | `src/lib/default-bank.ts:8-12` hard-codes a Hong Leong regex as the default for every receipt, voucher and payment form. It is not configurable. | S | money — needs owner approval (pre-fill only, posting unchanged) |
| H3-7 | A preparer can press "Remind approver" on a checked payment voucher. The approver gets an in-app notification, at most once an hour per voucher. | Houzs#5232 | PV ladder `accounting.ts:13795` (`pvApprovalCore`). No reminder exists (no "remind" under `src/pages/accounting` or `src/pages/invoices`). `src/api/routes/notifications.ts` exists to carry it. | S | low |
| H3-8 | "Undo delivered" keeps the first, wrong POD (photos, signature, time) as "Earlier delivery attempt" instead of losing it when the real POD is taken | Houzs#5529 | The reversal `delivery-orders/_helpers.ts:1384-1390` resets status and `deliveredAt` but leaves `proofOfDelivery`. The next POD write replaces it (overwrite path not traced) | S–M | low |
| H3-9 | PDFs about 10× smaller, so they send faster on WhatsApp and email | Houzs#5552 | 11 of 19 `new jsPDF(` calls pass `compress: true`. Missing: `generate-credit-note-pdf.ts:23`, `generate-debit-note-pdf.ts:16`, `generate-delivery-return-pdf.ts:52`, `generate-packing-pdf.ts:38`, `generate-supplier-quotation-pdf.ts:98`, `generate-customer-quotation-pdf-v2.ts:230`, `generate-service-case-pdf.ts:115`, `generate-product-catalogue-pdf.ts:288`, `export-report.ts:105` | S | low |
| H3-10 | In a batch print, each document numbers its own pages ("Page 1 of 2"), not the whole file | Houzs#5552 | `generate-do-pdf.ts:301-305,725-746`: the consolidated DO run numbers the whole document **on purpose** (comment says so). This is an owner call, not a bug. | S | low |
| H3-11 | Top search finds a phone number however it was typed (012-345 6789 vs +60123456789). It also finds credit/debit notes, delivery and purchase returns, receipts and payment vouchers. | Houzs#5426 (B17), Houzs#5549 | `src/api/lib/search-sources.ts:54-160`: phone is a raw ILIKE column (no digit normalisation), and there are no sources for credit notes, returns, receipts or PVs | S–M | low |

## Bugs Hookka probably shares

Each one below is a pattern that a sister-repo fix removed and that is visible in Hookka code. None was reproduced.

| # | Bug | Sister fix | Hookka evidence | Risk |
|---|---|---|---|---|
| B1 | A late "Delivered/Dispatched" tap can bring a cancelled DO back to life after the cancel has already returned its stock (stock overstated) | Houzs#5528 | `delivery-orders/_helpers.ts:4626` checks `VALID_TRANSITIONS[existing.status]` in memory. The write at `:4964-4975` is `UPDATE delivery_orders SET … status = ? … WHERE id = ?`, with no status compare-and-set. Same shape for consignment-note return: `consignment-notes.ts:1370` `WHERE id = ?`. (The first review's O1 / #1253 covered delivery **returns** only.) | stock — needs owner approval |
| B2 | Two delivery returns, purchase returns or stock adjustments saved at the same moment can get the same number | Houzs#5546 | Read-highest-then-+1 with no retry: `delivery-return-create.ts:124-139` (number taken at `:443`, outside the per-DO advisory lock), `purchase-return-create.ts:125-135`, `stock-adjustments.ts:110-124`. No unique index found in the migrations: `migrations-postgres/0067:19` is a plain index on `adj_no`, and `0207_delivery_returns.sql:8` has no UNIQUE. PO and penalty numbers are fine (retry wrappers). Prod index state UNMEASURED. | low (numbering) |
| B3 | Two "Approve" presses on one payment voucher at the same moment can both build its postings | Houzs#5532 (same class), #5540 | `accounting.ts:13852` checks `state !== "CHECKED"` in memory, then `:13872` / `:13895` `UPDATE payment_vouchers … WHERE id = ?` with no `AND approval_state = 'CHECKED'`. Journal legs are probably caught by the unique `idx_lje_idempotent` (`migrations-postgres/0117:45`), if it exists on prod (UNMEASURED). The AP-branch settlement document (`pvApSettlementStatements`) was not traced. | money — needs owner approval |
| B4 | Two saves of the same PO within a few milliseconds can both pass the stale-edit check, and the second silently undoes the first | Houzs#5564 | `purchase-orders.ts:831` `editConflictMessage(existing, body.expectedUpdatedAt)` compares in code, then writes at `:1040-1049` `… WHERE id = ?` with no `AND updated_at = ?`. The SO path was not checked. | low (rare; header fields) |
| B5 | A jsonb value is stored as a JSON **string** instead of an array, so SQL `->` on it reads NULL | Houzs#5457 | `scan-queue.ts:1502`, `:1513` bind `JSON.stringify(nextIdxs)` to `?::jsonb` through postgres.js `unsafe` (`supabase-compat.ts:286`), the same stack and pattern as Houzs. The reader at `scan-queue.ts:285-290` accepts both a string and an array, which is the tell. Not checked against the DB. | low |
| B6 | Money figures and invoice numbers printed into **public** GitHub Actions logs | Houzs#5512 | The repo is PUBLIC (`gh repo view`, 2026-11-10). `nightly-pi-gl-backfill.yml:47-59` echoes the full response body, which carries `postedRm` and `failures` (`purchase-invoices.ts` backfill return, about `:2164-2175`). `daily-reports.yml:100` and `nightly-counter-rebuild.yml:47` also echo bodies (their content not checked). This is separate from the first review's O7 (artifact upload). | low (exposure) |
| B7 | The PDF preview stays on screen over the next page after browser or phone Back | Houzs#5402 (B1.4, from Conts#756) | `src/lib/pdf-preview.ts:178-249` appends an overlay to `<body>` that closes only on Close/Esc. There is no `popstate`/route listener. | low |
| B8 | A full connection pool ("max clients reached in session mode", `EMAXCONNSESSION`) is not retried, so the request fails | Houzs#5402 (B1.7, from Conts#610) | `supabase-compat.ts:221-222` `CONN_CREATE_RE` covers "too many clients" and "remaining connection slots" but not "max clients reached". Whether Hyperdrive ever returns that exact message is UNVERIFIED. | low |

## Honest gaps

- Bodies were read to about 1,000 characters. Long PRs (#5397, #5530, #5539, #5549, #5552) may hold details past that point.
- "Not in Hookka" rests on targeted greps of `origin/main`. H3-8 (POD overwrite path), B3 (AP branch) and B4 (SO path) were not traced end to end.
- No production query was run. Index existence (B2, B3) and the content of logs (B6) are UNMEASURED.


---

## Range C1

Checked 2026-11-10 against Hookka `main` at 1667f25f4 (local checkout; `git pull --ff-only` refused, and local main is 1 bundle-baseline commit behind origin/main). Read-only. I ran no tests, tsc or prod queries. **Every statement about Hookka is a code reading. None is a production measurement.**

## Coverage
- 351 merged PRs fall in the range (#1 to #410; the missing numbers were never merged).
- 113 PR bodies read. Each was capped at 2,500 characters, so the tails of about 15 long bodies (#125, #127, #155 to #160, #165 to #167, #170, #171, #253, #278, #372) were cut off. I also listed the changed files for the 6 empty-body PRs (#106, #108, #116, #117, #229, #231) and read the #108 diff.
- 238 skipped by title as Conts business: Channex, calendar and rates, bookings and guests, units, owners and statements, cleaning and maintenance jobs, renovation and Beta, the catalog imports, the design packs, CI and staging chores, and vocabulary.
- Already covered, so not listed below:
  - In the first review or already in Hookka: Conts #102/#235 version notice, #157 history, #156/#229 two-step sign-in and devices, #159 confirm dialog, #158 grid features (G1 to G6), #185 outbox claim, #401 letterhead.
  - Conts #70 audit trail and #156 sign-in record: Hookka has `admin-health.ts:1272 /audit-feed` and `:1395 /security-events`.
  - Conts #163 crash screen: `components/ui/error-boundary.tsx`.
  - Conts #165:
    - inline HTML/SVG uploads: `files.ts:546-555`, nosniff and attachment;
    - text caps: `lib/text-caps.ts`;
    - concurrent document numbers: `doc-number-service.ts`, `sequence-lock.ts`.
  - Conts #166 file-download authorisation: already a known open item in `docs/RBAC-REMEDIATION.md:140-151`.
  - Conts #167 hidden-tab polling: `lib/scheduler.ts`.
  - Conts #184/#199 connections per request: `db-pg.ts:93`, max 1.
  - Conts #199:
    - constant-time compare: `auth-middleware.ts:211`;
    - per-IP sign-in cap: `api-rate-limit-config.ts:42`.
  - Conts #88 manual decrease below on-hand: `stock-adjustments.ts:302`.
  - Conts #88 cancelling a GRN whose goods were used: `grn.ts:2582-2665`.
  - Conts #155 maker-checker: PV prepare/check/approve in `accounting.ts:13591+`; the worker-penalty self-approval block.
  - Conts finance phase 1 (#330 to #338, #344, #389, #395 to #397, #404): Hookka already has fiscal-year lock (`lib/fiscal.ts:140`), year-close, opening balances (`accounting.ts:20105-20633`), debtor and creditor ledgers (`:4037`, `:4085`) and as-at aging.
  - Phone formatting with country codes: `lib/contact-format.ts`.
  - Worker PIN "forgot" help: `pages/worker/login.tsx`.
- Not recommended:
  - Conts #145: forgot-password tells you whether an account exists. That weakens anti-enumeration.
  - Conts #372: department-based permissions. It is a different model, and Hookka has its own RBAC plan.

## New items (generic, not in Hookka, not in the first review)

| id | What it does for the user | Source PR(s) | Hookka today | Size | Risk |
|---|---|---|---|---|---|
| C1-1 | A signed-in session ends after a fixed maximum (for example 30 days) even if it is in daily use. Management can set the idle and maximum times on a Settings screen. Today a stolen cookie that is still being used never expires. | Conts#68, #69, #72 | `src/api/lib/auth-middleware.ts:199-206`: "an active user stays logged in indefinitely". There is a 7-day slide and no absolute cap. | S | low (security; changes when people get signed out, so tell staff) |
| C1-2 | An admin can sign a person out of every device, for a lost phone or a leaver's laptop, without changing their password. | Conts#142, #156 | `src/api/routes/auth-sessions.ts:40,59` lets a user revoke only their own sessions. The only admin route is `users.ts:651` reset-password, which also changes the password and is Super Admin only. | S | low |
| C1-3 | When an admin resets someone's password, the person must choose their own at the next sign-in, the same strength rules apply, and the reset is recorded in the audit trail. | Conts#142 | `src/api/routes/users.ts:651-700`: 6-character minimum only, no `password-strength` check (that check is used in `auth.ts`), `must_change_password` not set (the column exists, `users.ts:138`), no `emitAudit`. | S | low |
| C1-4 | On staging only, management can switch to "view as" any account and back without signing out, to see what each role really sees. Each switch is audited. It is hard-off unless a staging-only variable is set. | Conts#108 (`functions/api/auth/view-as.ts`, `VIEW_AS="staging"` plus a host check plus a signed origin cookie) | Not in Hookka: no impersonate or view-as code in `src/api`. It would help verify the `docs/RBAC-REMEDIATION.md` batches. | M | low if it stays staging-only. Needs a prod guard test, because a leak would be account takeover. |
| C1-5 | Photos, videos and PDFs can be attached to any flow document (PO, GRN, DO, delivery return, invoice) and to each line. A line's files also show, read-only, on the documents made from it down the chain. | Conts#278 | `/api/files` is used on SO detail only for the customer's original PO (`pages/sales/detail.tsx:671`), on PI detail (`PurchaseInvoiceDetail.tsx:643`), on maintenance and on products. There is no attachment area on the PO, GRN, DO or delivery-return detail pages (no `/api/files` use in `pages/procurement/detail.tsx`, `grn-detail.tsx` or `pages/delivery/detail.tsx`). | M–L | low |
| C1-6 | A purchase return that would take out more raw material than is on hand asks first ("need 3, available 2, short 1"), instead of silently going short. | Conts#88 | `src/api/lib/purchase-return-create.ts:284-288` posts any shortfall as a ledger-only residual with no warning to the user. | S | money/stock/payroll — needs owner approval |
| C1-7 | Double-clicking Save on a credit note, debit note, stock adjustment or salary advance makes one record, not two. | Conts#200 (Idempotency-Key on every money write) | `lib/idempotency` is used by 13 routes (SO, PO, DO, GRN, PI, invoices, payments, supplier-payments, returns, consignment, accounting), but not by `credit-notes.ts`, `debit-notes.ts`, `stock-adjustments.ts` or `employee-advances.ts`. Unverified whether those forms disable Save while sending. | S | money/stock/payroll — needs owner approval |
| C1-8 | Pressing Back from a record returns the list to the row you opened, scrolled into view, not to the top. This extends G2, which keeps filters but not position. | Conts#406, #205 | `src/components/ui/data-grid.tsx` has no scroll restore or scroll-to-row (no `scrollIntoView` or restore logic found). | S–M | low |
| C1-9 | IT Support accepts .zip attachments (for log bundles and many screenshots). | Conts#408 | `src/pages/it-support/index.tsx:117` `FILE_ACCEPT` covers images, mp4/mov and pdf only. The hub must accept zip (Houzs-IT/houzs-hub#42, merged for Conts). Unverified for Hookka's hub path. | S | low |
| C1-10 | Payroll can export one bank-transfer Excel (name, bank, full account number, amount) to upload to the bank. The export is audited without the numbers. | Conts#343 (owner payouts version) | Unverified. Payslips carry `bankName`/`bankAccount` (`src/api/routes/payslips.ts:140-141`), but grep found no bank-file export in payroll, payslips or supplier-payments. A grid export may already cover it. | S | money/stock/payroll — needs owner approval |
| C1-11 | Figures show "—" while a page is still loading, instead of RM 0 or "0 orders" that staff take as real. | Conts#186, #188 | Unverified. I did not inspect Hookka dashboards and list headers for `?? 0` placeholders. | S | low |

## Bugs Hookka probably shares

These patterns are visible in the code. Production state is UNMEASURED.

1. **A user's email can be edited into a duplicate.**
   - Conts fixed this in #59 and #53.
   - In Hookka, `src/api/routes/users.ts` `PUT /:id` stores `body.email` as typed (`users.ts:481`, written at `:505`). It is not trimmed or lowercased, and nothing checks whether another account already uses it.
   - `users.email` is `UNIQUE` but case-sensitive (`migrations-postgres/0002_auth.sql:18`), while login matches `LOWER(email) = LOWER(?) LIMIT 1` (`auth.ts:184`).
   - So editing someone to `Ali@x.com` while `ali@x.com` exists is accepted, and that login then resolves to whichever row comes first. An exact duplicate probably surfaces as an unhandled unique-violation error (unverified).
   - Create (`users.ts:292`) does check `LOWER(email)`, so only the edit path is open.
2. **Admin password reset skips the safety rules.** See C1-3: `users.ts:651-700` sets a password the admin knows, does not force a change, skips the strength check and writes no audit row. Conts fixed the same shape in #142.
3. **Sessions never hard-expire while in use.** See C1-1: `auth-middleware.ts:199-206`. Conts #68 found the same pattern: a configured absolute lifetime existed but was never enforced.
4. **A purchase return goes short silently.** See C1-6: `purchase-return-create.ts:284-288`. Conts #88 fixed the same "allowed, but nobody is told" pattern on DOs and purchase returns. Whether Hookka's DO path does the same for FG stock is unverified.

## Top 5
1. C1-3 / bug 2: admin password reset forces a change, checks strength and is audited (S, low).
2. Bug 1: user email edit is normalised and duplicate-checked (S, low).
3. C1-1: absolute session lifetime plus an idle setting (S, low).
4. C1-5: attachments on every flow document and line (M–L, low).
5. C1-7: duplicate-submit guard on credit notes, debit notes, stock adjustments and advances (S, owner approval).


---

## Range C2

Checked 2026-11-10 against Hookka `main` at 1667f25f4 (read-only). Nothing was run and no diffs were read; Hookka was checked with targeted greps and reads under `src/`. **Production effects: UNMEASURED.**

- PRs in range: 406 (merged, #411 to #820). I read every title.
- I skipped PRs that are clearly Conts business: Property OS, reservations, HostPlatform, Booking.com, cleaning, units, owners, utilities, renovation projects, Beta screens, so-import, demo mode, renovation e-invoice/finance waterfall, technician field app.
- **I read 125 PR bodies in full**: everything generic, plus borderline renovation/engine PRs that might hide a generic fix.
- Left out because the first review already lists them, or Hookka shipped them in #1241 to #1263: health alert email (#420/#424), ETag (#455), CANCELLED stamp and struck-through numbers (#804), POD photo PDF (#544), POD on DO PDF (#641/#649), one print preview with named file (#619/#750/#801), letterhead/wrap (#712/#743/#766), list Retry (#594), upload cache (#713), CSV formula guard (#623), unique supplier binding, MRP stale plan (owner rejected).
- Already in Hookka (checked, so not listed):
  - previous build's assets kept on deploy (#694 → `.github/workflows/deploy.yml:125-144`);
  - money input selects on focus and parses "12,000" (#684/#801 → `src/components/ui/money-input.tsx:33,58-67`);
  - mouse wheel cannot change a number (#813 → `src/lib/number-input-wheel-guard.ts`);
  - Esc closes only the top layer (#801 → `src/lib/escape-stack.ts`);
  - type-to-search supplier on New PO (#805 → `procurement/create.tsx:624`);
  - several POD photos (#616 → `POD-dialog.tsx` MAX_PHOTOS 5);
  - payment bank picked by finance (#476 → `payments.ts:586-600`);
  - IT request carries its module (#584 → `it-support.ts:36-38`);
  - global search gated per module (#632/#644 → `search.ts:42`);
  - persisted read cache (#455 → `src/lib/cached-fetch.ts`);
  - PO lines lock after a posted GRN (#634/#636 class → `purchase-orders.ts:834-855`);
  - payroll / waitUntil / batched-call fixes in #802 (these came from Hookka).
- Not checked in depth: the Houzs engine ports bundled in Conts #799 and #800, such as SO cancel releasing stock, amendment keeping prices nobody typed, and switching PO supplier re-pricing lines. Hookka's SO edits lock once production starts (`sales-orders.ts:3092` `checkSalesOrderLocked`), so most of these probably do not apply, but that is **unverified**. They are Houzs-origin and belong to whoever reviews the Houzs range.

## New items

| id | What it does for the user | Source PR(s) | Hookka today | Size | Risk |
|---|---|---|---|---|---|
| C2-1 | A half-filled form dialog asks "Discard your changes?" when you press Esc or click the dimmed backdrop, so a stray click doesn't lose your typing (Cancel still closes at once) | Conts#593, #623 (dropdown picks count as changes) | Not there. `src/lib/escape-stack.ts:16-21` closes the top popup on Esc unconditionally. About 70 page files hand-build `fixed inset-0` overlays. No "discard" prompt exists in `src/components/ui` apart from confirm-dialog/data-grid | S–M | low |
| C2-2 | Leaving a create/edit form with unsaved edits through a menu link or Back asks first, not only on tab close | Conts#489 | `useNavGuard` (in-app plus unload, `src/lib/use-nav-guard.ts`) is used on 5 pages only (forecast, customers, service-case detail, products, PI detail). SO and consignment create/edit use only `useUnsavedChanges` (browser unload, `src/lib/use-unsaved-changes.ts:11-13` says in-app route changes are deliberately not guarded). PO create, GRN create and PI create have neither | S | low |
| C2-3 | Every POD photo gets the DO number and the **server's** date/time burned into a corner, so an old or reused photo can't pass as proof | Conts#547 | Not there. `src/components/delivery/POD-dialog.tsx:42-60` only resizes/compresses. The phone sends its own clock as `deliveredAt` (`src/pages/m/components/PodSheet.tsx:105`), and the server keeps it (`delivery-orders/_helpers.ts:4703` `pod.deliveredAt ?? now`) | S | low |
| C2-4 | Photos on a goods receipt (proof of receipt: delivery note, damaged cartons) that print on the GRN | Conts#530, #641 | No photo or attachment anywhere on GRN: no match for photo/attachment/upload in `procurement/grn-detail.tsx`, `procurement/grn/create.tsx`, `routes/grn.ts`. Generic `/api/files` exists (`routes/files.ts:377`) | S–M | low |
| C2-5 | "Copy as new" on a purchase order opens New PO pre-filled with supplier, lines and prices (dates and number blank) | Conts#806 (from Houzs#4892) | SO has Clone (`src/pages/sales/detail.tsx:1103-1135`). The PO detail and list have nothing similar (grep) | S | low |
| C2-6 | After saving a GRN raised from a PO (or a PI from a GRN), the result offers "Back to PO" / "Back to GRN" instead of dumping you on the list | Conts#809 (from Houzs#4975) | `src/pages/procurement/grn/create.tsx:667` navigates to `/procurement/grn` after save. PI create not checked | S | low |
| C2-7 | A GRN Date column on the Purchase Orders list (when goods actually arrived) | Conts#810 (from Houzs#5045) | PO list columns (`procurement/index.tsx:1617-1700`) show Order and Expected date, but no received/GRN date | S | low |
| C2-8 | A deactivated material can't be newly added to a PO, refused by the server and not just hidden in the picker | Conts#810 (from Houzs#4899) | The client filters `rm.isActive` (`procurement/create.tsx:202`). `routes/purchase-orders.ts` has no active check (grep for isActive/inactive found none). The server path is **unverified** beyond that grep | S | low |
| C2-9 | Global search finds a phone or document number whether you type it with or without spaces and dashes (0123456789 finds 012-345 6789) | Conts#644, #817 | `src/api/lib/search-sources.ts:202` is a plain `ILIKE` on the raw column | S | low |
| C2-10 | Global search also finds delivery returns, credit/debit notes, purchase returns, stock adjustments/transfers and payment receipts | Conts#644 | `search-sources.ts:47-163` has 16 kinds (SO, customer, product, DO, invoice, CN-note, PO, PI, GRN, supplier, production order, service order, service case, employee, lead, journal). None of the listed ones is there | S | low |
| C2-11 | System Health checks with a harmless read that each outside key still works (Resend/Brevo mail, Anthropic, Google Sheets). A refused key turns red, so the existing alert email fires. No answer only turns amber | Conts#740, #749 | No provider probe: no mail/key check in `routes/admin-health.ts` or `src/lib/health-status.ts`. Keys are in `worker.ts:42,44,101,605-606`. The first review's P4 covered alert email and stuck jobs, not key validity | S | low |
| C2-12 | Clocking in/out needs a selfie, refused by the server. A worker with a broken camera asks the office to key the time | Conts#432 | Photo is optional: `routes/worker.ts:1052-1058` `stampPunchPhoto` quietly skips a missing or invalid photo and the punch still counts | S | payroll — needs owner approval |
| C2-13 | Staff expense claims: hand in a receipt photo (amount read by OCR), finance checks and pays back. Per-department petty-cash floats with top-ups, each on its own cash account, opening with the cash the keeper already holds | Conts#466, #467, #468, #470 | No claims or petty-cash module (only placeholder text in `pages/accounting/index.tsx:13028,14143`). Note: the first review set aside Houzs's "payment requests" as Houzs-specific. Staff claims are a different, generic flow | L | money — needs owner approval |
| C2-14 | Limit a department or one person to chosen product categories, so they only see those lines | Conts#431, #447 | Nothing similar (no category-access code under `src/api` or `src/lib`). It would need to follow `docs/RBAC-REMEDIATION.md` first. Conts itself says phase 1 only hid lines on some screens | L | low (permissions; tell owner) |

## Bugs Hookka probably shares

| Sister fix | Same pattern in Hookka | Notes |
|---|---|---|
| Conts#750 / #756: the print preview stayed open over the next page after navigating away | `src/lib/pdf-preview.ts:173-304`: the overlay is appended to `document.body` and closes only on Close, Esc or a backdrop click. It has no `popstate`/route listener, so phone Back (or browser Back) leaves the preview on top of the next page, with `body.style.overflow = "hidden"` still set (`:279`) | Not reproduced in a browser. **Probable**, S fix (close on popstate) |
| Conts#547: proof-photo time comes from the server, not the phone | `delivery-orders/_helpers.ts:4703` stores the client's `pod.deliveredAt` (`PodSheet.tsx:105` sends `new Date().toISOString()`). A phone with a wrong clock records the wrong delivered time | Same fix as C2-3. Unverified whether the desktop POD dialog also sends its own time |
| Conts#681: dates taken from the database's UTC day instead of Malaysia's | `src/api/routes/dashboard-overview.ts:1412` uses `date_trunc('week', CURRENT_DATE)` for the 12-week revenue window. Between 00:00 and 08:00 MYT on a Monday the window still starts on last week's Monday | Display only, minor. The clock-date gate (#1263-era) looks at JS `new Date()` and would not catch SQL `CURRENT_DATE` |
| Conts#610: Hyperdrive pool full (`EMAXCONNSESSION`, session-mode pool of 15) with no retry | `src/api/lib/db-pg.ts` has no retry on a refused connection. But Hookka's comments say it uses the transaction-mode pooler (port 6543), not session mode | **Unverified and probably not shared.** It would need prod logs to confirm |
