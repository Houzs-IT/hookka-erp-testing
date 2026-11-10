> **Last verified: 2026-11-10** against Houzs-Century/Houzs-ERP and hookka-dev/Conts-ERP PRs merged 2026-10-01..2026-11-10 (titles all, ~70 bodies) and Hookka source; no diffs read, nothing run. Prod effects UNMEASURED.

# Cross-system review: what Hookka can take from Houzs and Conts (PRs merged 2026-10-01 to 2026-11-10)

Scope: 1,077 merged Houzs PRs (Houzs-Century/Houzs-ERP) and 691 merged Conts PRs (hookka-dev/Conts-ERP). All titles were read. About 70 PR bodies were read in full where the title matched documents/PDF, email, lists/grids, dates, or generic platform work. Diffs were not read. Hookka was checked read-only against `main`-derived branch `feat/backfill-auto-grn-links`. Anything Hookka #1207–#1244 already covers is skipped or listed under "Already in Hookka".

Houzs issue #5459 (2026-11-09) is Houzs's own review of Hookka and Conts. Many November Houzs PRs are Hookka features ported across (rows "A*" / "B*" there). That made it possible to find the features Houzs then took further than Hookka. Those come first.

"Unverified" means I could not confirm Hookka's behaviour from the code in the time available. Nothing here is a production measurement: **all prod-state impact is UNMEASURED.**

---

## 0. Ported and improved since (bring back to Hookka)

These started in Hookka (or Hookka shipped the first version), went to Houzs or Conts, and were improved there. The code shape already matches, so they are the cheapest wins.

| # | What it does for the user | Source PR(s) | Hookka today | Size | Risk area |
|---|---|---|---|---|---|
| P1 | A document made between 00:00 and 08:00 Malaysia time on the 1st of a month gets the new month's number (SO-2612-001), not the old month's | Houzs#5464 (PO), Houzs#5493 (all other doc types). Builds on Hookka's own "Malaysia today" work (#1217) | **Bug present.** Hookka's #1217 fixed "today" strings but not document-number months. The server runs on UTC and builds YYMM with `new Date().getMonth()` in `src/api/routes/purchase-orders.ts:249-250`, `grn.ts:453`, `delivery-orders/_helpers.ts:688`, `sales-orders/_helpers.ts:673` (fallback when there is no order date), and also in service-orders, packing-lists, consignment-orders, stock-adjustments, service-cases, payslips, qc-*, production-orders and others (about 24 files). `src/lib/doc-number.ts:102` is named `utcYymm` and feeds `nextSelfNumber` in `src/api/lib/doc-number-service.ts:42` (vouchers / journals). By contrast `docNumberPreview` (`:59`) already adds +8h | S–M | Low (numbering only, no amounts). Vouchers and journals share the helper, so tell the owner first |
| P2 | A stronger check that stops new device-clock or UTC dates from creeping back in | Houzs#5517 (the gate follows a variable set to `new Date()` and flags `.getMonth()` / `toLocaleDateString('en-CA')` on it), Houzs#5499/#5508/#5510/#5515 (the sweep) | `tests/no-utc-today.test.mjs` looks for one exact pattern (`new Date().toISOString().slice(0,10)`). It cannot see `const now = new Date(); now.getMonth()`, which is how P1 slipped through | S | Low |
| P3 | A list that the screen polls costs about 130 bytes when nothing changed, instead of the whole list | Houzs#5484 (every polled GET list). Ported from Hookka#888, where it covered one list | ETag / 304 only on the production-orders list (`src/api/worker.ts:218-223`, `routes/production-orders.ts`). Unverified which other Hookka lists poll (the notification bell polls every minute; others not checked) | S | Low |
| P4 | Management gets an email when System Health turns red, sent once per problem after two red reports in a row, plus a "working again" email. The hub report also names failed background jobs and stuck queues | Conts#420, Conts#424 (alerts); Houzs#5398 (jobs + queues in the report); Houzs#5513 (read-only post-deploy check that the report arrives). Started from Hookka#1142 | Hookka#1142 pushes the 5-minute report to the IT Hub (`src/api/lib/ai-usage.ts`, worker cron). I found no red-state email (no `health … alert` code in `src/api`). Hookka's report does not include cron-job status | M | Low |
| P5 | A credit note raised from a delivery return cannot credit more than was returned on each line, across several credit notes. The return is locked (no cancel, no shrinking a qty) while a live credit note points at it | Houzs#5492 (port of Hookka#952/#956/#959, with DB caps added) | One `credit_note_id` per return (`src/api/routes/delivery-returns.ts:54`, `:573`). Unverified whether Hookka refuses cancelling or editing a return that already has a credit note, or caps the qty per line | M | **Money: owner approval first** |
| P6 | The PO email goes To the supplier's main address and Cc's their 2nd and 3rd addresses automatically | Houzs#5435 (Email 2 / Email 3 + Cc). Builds on Houzs#5462, the port of Hookka's "send from the purchaser's mailbox" (#1118/#1119) | The PO email opens Mail Center compose from the operator's own mailbox (`src/pages/procurement/detail.tsx:533-566`, `src/lib/po-email-draft.ts:23`). Every address in the supplier's one email field goes in To. Cc has to be typed each time | S | Low |
| P7 | Tapping "view file / view PDF" always opens something. If the browser blocks the tab, the user is told so | Houzs#5423 (one shared `openLoadedTab` helper, 18 call sites). Port of Hookka#501 | Hookka uses the "open the tab first" pattern ad hoc in about 8 files (`print-report.ts`, `print-voucher.ts`, `invoices/detail.tsx`, …). The jsPDF "view" paths (`generate-invoice-pdf.ts:684`, `generate-do-pdf.ts:763`, `generate-cn-pdf.ts:486`) quietly download instead when the popup is blocked. This merges into item D1 below | S | Low |

Ported from Hookka and **not** improved since (Hookka is already level): Undo delivered (Houzs#5489, Hookka#1092; Hookka's `VALID_TRANSITIONS` in `delivery-orders/_helpers.ts:111` already forbids DELIVERED→LOADED), PO search by item code (Houzs#5461, Hookka `procurement/index.tsx:914` `itemsSearchText`), interrupted-save reported as saved (Houzs#5455), Esc closes only the top dialog (Houzs#5473), print waits for rows (Houzs#5477), outbox preview links (Houzs#5480), phone list sort (Houzs#5483), dropdown above table header (Houzs#5485), delivery-return qty > 0 (Houzs#5419), cancelled AP bill not outstanding (Houzs#5420), staging scrub (Houzs#5400).

---

## 1. Already in Hookka

### Documents and email
- Houzs#5463 / Conts#185 outbox claims each row before sending → `src/api/lib/email-outbox.ts:546-566` (atomic `SENDING` claim plus stale-claim reclaim).
- Houzs#5462 PO email replies reach the purchaser → Hookka sends from the operator's own mailbox: `src/pages/procurement/detail.tsx:533`, `src/lib/po-email-draft.ts` (HK-0113).
- Houzs#5359 invisible pasted space breaks a PDF → `src/lib/pdf-text.ts:35` folds every non-newline whitespace (NBSP, U+2006, …). `src/api/lib/unified-do-invoice-pdf.ts:117-126` `winAnsi()` maps U+2000–200B and replaces anything un-encodable with "?", so pdf-lib never throws. jsPDF does not refuse unknown glyphs.
- Conts#743 / Conts#754 long values wrap inside the margin → `lblVal` uses `splitTextToSize` (`src/lib/generate-purchase-order-pdf.ts:180`, `generate-grn-pdf.ts:74`). Tables use autoTable `overflow: "linebreak"`. The unified renderer wraps with `wrapHard`.
- Houzs#4580 / Conts#401 / #712 / #766 one letterhead per company → `src/lib/pdf-utils.ts:55` `drawLetterhead` (company passed in), `letterheadForPurchaseOrg` in the PO generator, `src/lib/org-letterhead-row.ts`. Whether the jsPDF and pdf-lib letterheads look identical is unverified.
- Houzs#5477 print waits for the data (origin Hookka#632).
- Houzs#5482 export writes the whole filtered list, not the loaded page → DataGrid `fetchAllRows` (`src/components/ui/data-grid.tsx:281`, `:3474`), wired on SO / PO / GRN / Invoices / DO.
- Houzs#5404 CSV formula injection → Hookka#1209.
- Houzs#5131 a refused create releases its idempotency key → `src/lib/idempotency-key.ts:49` treats any 4xx as an answer, so the next submit gets a new key.

### Lists and platform
- Houzs#5461 PO list search matches item codes → `src/pages/procurement/index.tsx:914-921`.
- Houzs#5271 / #5288 multi-word search → Hookka#1231.
- Houzs#5464 / #5508 / #5515 "today" in Malaysia time → Hookka#1217 (not the doc-number month, see P1).
- Houzs#5414 detail page "could not load" with Retry vs "not found" → `src/components/ui/record-load-error.tsx`, used on SO / DO / Invoice / Consignment / PO detail. Delivery-return, supplier and R&D detail pages still say "not found" without separating the cases (`delivery-returns/detail.tsx:131`, `suppliers/detail.tsx:593`, `rd/detail.tsx:1423`). Small leftover.
- Houzs#4834 / #5485 sticky header z-order → Hookka#853 and DataGrid `stickyHeader`.
- Conts#102 / #235 "new version deployed" notice → `src/lib/use-version-check.ts`.
- Conts#632 one search box for the whole system → `src/components/layout/global-search.tsx`.
- Conts#157 record history on every screen → `src/components/audit/AuditHistoryPanel.tsx`.
- Conts#156 / #229 two-step sign-in, sign out everywhere, nightly backup → `src/api/routes/auth-totp.ts`, Hookka#1234 signed-in devices, `.github/workflows/backup.yml`.
- Conts#159 / #593 one confirm dialog → Hookka#1231 in-app confirms.
- Houzs#5409 / Conts#209 and other Conts-origin money fixes were not checked (see section 3).

### Common list and grid features already in Hookka (`src/components/ui/data-grid.tsx`)
- Per-column filter: value checklist, text modes, date tree, quick chips (Overdue / Today / This Week / This Month), custom From–To date range (`:1276-1290`), number range (`src/lib/grid-layout.ts:25-60`). Matches Houzs#5332 / Conts#158 / Conts#190 on the client side.
- Column chooser, show/hide, reorder, resize, frozen (`sticky`) columns, per-user server layout (`mine`), company default (`org-default`) and print preset (`src/api/routes/datagrid-layouts.ts`). Saved Views for filters (per user, localStorage).
- Group by column (`src/lib/grid-group.ts`), footer totals (`column.total`, `grid-layout.ts:78`), copy as TSV, range-sum readout, URL-mirrored filters (Hookka#1235).
- Header right-click menu with Export to Excel / Export to PDF / Print / Group by (`grid-layout.ts:103-117`) → same as Houzs#5349 / #5415.
- Row selection plus shared `src/components/ui/bulk-action-bar.tsx`, virtual rows (`virtualize`), stable single-column sort with one `Intl.Collator` (Hookka#1207 tie-break on the server).
- Phone list views → the `/m` app (cards per record).

---

## 2. Worth bringing to Hookka

### 2a. Documents and PDFs

| # | What it does for the user | Source PR(s) | Hookka today | Size | Risk area |
|---|---|---|---|---|---|
| D1 | One in-app PDF preview for every document, with Print, Download, New tab and Close. A PDF saved from the preview carries the document's name (PO-2611-012.pdf), not a random GUID | Houzs#4430 (in-page viewer, no popup), Houzs#5342 (named file from the preview), Conts#619 / #750 / #756 (one preview everywhere, closes with its page) | No shared preview. Invoice / DO / CN "view" opens a blob URL in a new tab (`src/lib/generate-invoice-pdf.ts:684`, `generate-do-pdf.ts:763`, `generate-cn-pdf.ts:486`, `unified-doc-download.ts:176`). The browser's own Save then names the file after the blob GUID. When the popup is blocked it silently downloads. SO / PO / PI / GRN / delivery return / credit and debit note only download (`doc.save(...)` in each `generate-*-pdf.ts`). Only invoice, DO and CN pages have a View button (`invoices/detail.tsx:545`, `delivery/index.tsx:6249`, `consignment/note.tsx:3695`) | M | Low |
| D2 | A cancelled document prints with a red diagonal CANCELLED stamp on every page: on screen, in a batch print and in the supplier email | Houzs#5049 (PO), Conts#804 (PO) | Not done. The PO PDF prints "CANCELLED" only as the Status value in its reference block (`generate-purchase-order-pdf.ts:197`). The unified SO / DO / Invoice renderer (`src/api/lib/unified-do-invoice-pdf.ts`) and the GRN / PI / CN / DN generators print nothing for cancelled or voided documents | S–M | Low |
| D3 | One PDF of a delivery's POD photos (two per page, DO number, "Photo 3 of 8, uploaded <MYT time>"), ready to send on WhatsApp | Houzs#5488, Conts#544 | POD photos and signature are captured (`src/components/delivery/POD-dialog`, `src/pages/m/components/PodSheet.tsx`) and only shown as thumbnails on the DO page (`src/pages/delivery/detail.tsx:855-861`). Not in any PDF; no download | S | Low |
| D4 | POD photos (and signature) printed on the DO PDF itself, after the lines | Conts#641 / #649 | The unified DO renderer embeds only the logo (`unified-do-invoice-pdf.ts:196`) | S–M | Low |
| D5 | Item codes always stay on one line on PO / GRN / PI PDFs | Conts#683, Conts#767 | PO code column is a fixed 24 mm, bold 8 pt, `overflow: linebreak` (`generate-purchase-order-pdf.ts:262`), so a long code may wrap. Unverified against real Hookka code lengths | S | Low |
| D6 | DO and GRN papers name the warehouse goods ship from or were received at | Conts#717, Houzs#5467 | The GRN prints a Warehouse field (`generate-grn-pdf.ts:93`). The unified DO does not print a ship-from warehouse (grep found none). Only matters if Hookka ships from more than one warehouse (unverified) | S | Low |

### 2b. Common list and grid features

| # | What it does for the user | Source PR(s) | Hookka today | Size | Risk area |
|---|---|---|---|---|---|
| G1 | The header right-click menu (Export Excel / PDF / Print / Group by) and drag-to-reorder headers work on **every** list, not just finance | Houzs#5349, #5415 (every list carries the menu); Conts#158 | Built, but opt-in (`headerMenu`, `reorderableHeaders`) and switched on in only 6 finance pages (`accounting/index.tsx`, `tabs/PartyListTab.tsx`, `tabs/AuditLogTab.tsx`, `invoices/credit-notes.tsx`, `debit-notes.tsx`, `e-invoice.tsx`). SO, PO, GRN, PI, DO, Invoices, CO, CN, Inventory and Customers lists don't have it. Same pattern as the old `viewStorageKey` problem noted in CODEBASE-MAP | S | Low |
| G2 | A list keeps its filters, sort and search when you open a record and press Back, or share the link | Houzs#4828 (Back returns to the exact list state), Houzs#4458, Conts#158 (filters/sort/page in the address), Conts#205 (scroll memory) | `urlFilters` was shipped in Hookka#1235 but **no page passes it** (0 matches under `src/pages`). Only the DO list restores tab, page and scroll by hand | S | Low |
| G3 | Header funnel filters and header sort on the big paged lists cover every matching record, not just the 200 rows loaded | Houzs#4753 (filters and sort ran over one page), Houzs#5332 (date-column filter sent to the server as from/to on SO/DO/PO/GRN/PI/SI) | SO / PO / GRN / Invoice lists page 200 rows (`sales/index.tsx:159`, `procurement/index.tsx:852`, `grn.tsx:376`, `invoices/index.tsx:47`; DO 50). They switch to a whole-list fetch only for the filter bar and the search box (`sales/index.tsx:275-292`). DataGrid header filters are internal, and there is no callback to tell the page they are on. So a header funnel or header sort probably judges only the loaded page once there are more than 200 records. Not reproduced in a browser: **unverified, needs a check** | M | Low |
| G4 | Footer totals on the main document lists (SO, PO, GRN, PI, Invoices, DO). Cancelled rows stay listed but are not counted, and the footer says "1 cancelled not counted" | Houzs#5415, Houzs#5016 (bulk bar adds up ticked bills) | `column.total` exists but only 3 pages use it (`accounting/index.tsx`, `tabs/PartyListTab.tsx`, `invoices/e-invoice.tsx`). `columnTotals` (`grid-layout.ts:78-98`) adds every row, cancelled included | S | Low (display only) |
| G5 | A cancelled document's number is struck through and its row faded on every list (desktop and phone) | Houzs#4493 (23 lists + mobile cards), Conts#804 | No list does it. `line-through` appears in no document list page. DataGrid has `rowClassName` (used on 6 pages, not for this) | S | Low |
| G6 | Share a named column layout with the whole team. Members see it in the layout list with a "Shared" tag and switch with one click; admins can update or stop sharing | Houzs#5221 | One company default per grid (`org-default` kind) plus each user's own layout (`src/api/routes/datagrid-layouts.ts`). No named team layouts. Saved Views (filters) are per-browser localStorage, so they don't follow a user to another device | M | Low |
| G7 | When a list fails to load it says "Couldn't load this list" with a Retry button, instead of looking empty | Conts#594, Houzs#5414 (detail pages) | DataGrid has `loading` and `emptyMessage` but no error state. No Retry on the SO, PO, GRN, DO, Invoices or Consignment list pages (grep). A failed fetch probably reads as "no records" (unverified) | S | Low |
| G8 | Grouped lists stay smooth: virtual scrolling keeps working while groups are expanded | Houzs#4912 | CODEBASE-MAP (data-grid bullet, item 5) records that `virtualizationActive` turns windowing off whenever a group is expanded; still open | S–M | Low |
| G9 | Faster scrolling on long lists: rows that did not change are not re-drawn | Houzs#4823, #4830 | `docs/AUDIT-INTERACTION-COST.md` notes that pages passing `columns` as a bare array re-filter and re-sort on every render. Row memoisation unverified | S–M | Low |
| G10 | Column date filters ("Today", "This week") judge by the Malaysian day | Houzs#5499 | `today0()` in `data-grid.tsx:858` uses the device clock. Correct on Malaysian devices; wrong on a laptop set to another timezone | S | Low |
| G11 | Tick several GRNs / PIs on the list and confirm them in one go, with "Confirming 3 of 12" progress | Houzs#5249, #5250 | Unverified whether the GRN / PI lists have a batch confirm (`procurement/pi.tsx` mounts `BulkActionBar`) | M | **Inventory/money: owner approval first** |

### 2c. Other generic improvements

| # | What it does for the user | Source PR(s) | Hookka today | Size | Risk area |
|---|---|---|---|---|---|
| O1 | A status change on a delivery return is compare-and-set, so a late write cannot re-open a cancelled return | Houzs#5466 | Hookka#1228 covers SO/PO stale saves. Delivery-return status writes unverified | S | Inventory: owner approval first |
| O2 | MRP "Proceed PO" refuses a stale plan, so the same goods are not ordered twice | Houzs#5465 (from Conts#790) | Unverified for Hookka's procurement MRP | S–M | Inventory/money: owner approval first |
| O3 | A partial DO or invoice of an SO line carries its share of the line discount, not all of it | Houzs#5409 (from Conts#209) | Unverified whether Hookka SO lines carry a line discount that is copied onto partial DOs / invoices | S | **Money: owner approval first** |
| O4 | A supplier cannot be bound to the same item twice (unique index, 409 not 500) | Houzs#5486, #5509 (from Conts#689) | Unverified for `src/api/routes/supplier-materials.ts` | S | Low |
| O5 | An upload clears the read cache, so a just-uploaded file shows at once | Houzs#5478 (from Conts#713) | Unverified for `useCachedJson` after `/api/files` uploads | S | Low |
| O6 | One shared CSV/Excel import parser with header aliases, and every table's export imports back (round-trip tests) | Houzs#4618, #4527, #4605, #4614 | Hookka has `doc-import-dialog.tsx` and `batch-import-dialog.tsx`. Round-trip unverified | M | Low |
| O7 | No production data is left as a downloadable workflow artifact on the public repo | Houzs#5516 | `.github/workflows/wip-reset.yml:85-87` uploads `scripts/_wip-reset-backup-*.json` (production WIP quantities) as an artifact kept 90 days. The repo is **PUBLIC** (`gh repo view`: PUBLIC), so anyone signed in to GitHub can download it. `backup.yml` deliberately does not upload | S | Security: low data sensitivity, but tell the owner |

---

## 3. Not applicable to Hookka

- Houzs POS, merchant reports / card reconciliation, Maybank / bank-statement parsing, daily bank, payment requests, 欠正式单, Opening Balance, AR/AP aging rewrite, Product Profit, Logistics P&L (Houzs#43xx–#52xx `acc` series): Houzs's retail finance flows. Hookka has its own ledger.
- Houzs PMS / events / fairs / Project Overview / Event Commission / Venue rent: exhibition-sales business.
- Houzs Delivery Planning boards, Last Mile, Fleet Health, lorry maps, crew PIN, driver run-sheets, WhatsApp delivery blasts, chat-callback: Houzs's own logistics operation. Hookka has its own DO / POD flow.
- Houzs sofa-layout drawings on PO PDFs (drawer pictures, console/stool placement, URGENT by lead time): Houzs retail sofa-PO specifics.
- Houzs scan-GR / scan-PI / scan-SO matching rules: tuned to Houzs suppliers. Hookka has its own scan (`scan-po-modal`, `scan-supplier-modal`).
- Houzs AutoCount write-back, Venture Portal feed, 2990 company items, Consignment / PC Order specifics, rack QR (Hookka already has rack QR).
- Houzs HR Employees & Attendance phases (Houzs#4812 / #4855 / #4859 / #4888): ported **from** Hookka.
- Houzs RBAC rebuild (role_page_access, matrix Excel): a different permission model. Hookka's own plan is `docs/RBAC-REMEDIATION.md`.
- Houzs performance work on its Supabase/PostgREST reads (Server-Timing, KV snapshot of overviews, `aws:ap-southeast-1` placement): different stack details. Hookka already has smart placement (#1229) and dashboard snapshots.
- Houzs#5481 smaller photos on a PO email: Hookka's PO PDF carries no photos.
- Conts Property OS: reservations, Channex / Booking.com / HostPlatform, calendar and rates, cleaning jobs and proof photos, owner portal and statements, utilities, units.
- Conts renovation: quotations, contracts, VOs, project monitor, drawings, Beta screens, package templates, site photos, defects.
- Conts SO Maintenance letterheads per brand, Brands logos: one-company-many-brands. Hookka prints per organisation already.
- Conts chart-of-accounts import from AutoCount, renovation e-invoice: Hookka has its own e-invoice (`invoices/e-invoice.tsx`).
- Conts dark mode, glass look, design packs: cosmetic, not asked for.
- Staging / CI chores in both repos (preview-branch migrations, staging sync): repo-specific.
