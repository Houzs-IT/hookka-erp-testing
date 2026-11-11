# Handoff — current state, what's next, what's blocked

_Last updated: 2026-11-10 night (MacBook session). Everything below the Master checklist is history; the checklist is current._
Keep this file current in the same PR that changes state (global rule §6/§8).

## How to pick this up on another machine (MacBook)

```bash
git clone https://github.com/Houzs-IT/hookka-erp-testing.git
cd hookka-erp-testing
npm install
```

Then start Claude Code in that folder and say:
> "Read tasks/HANDOFF.md and continue the pending work."

Claude reads `CLAUDE.md` on its own; this file gives it the rest of the context.
Secrets (`.dev.vars`, Cloudflare/Supabase keys) are **not** in the repo and are
not needed for the code work below; never paste them into chat.

Every task: new worktree from `origin/main` → `npm install` → change →
`npx tsc -p tsconfig.app.json --noEmit` → commit (hooks run the full suite) →
PR → CI green → squash-merge → delete branch → verify on prod.

## Open PRs / work in flight (at time of writing)

- `feat/customer-consent-form` — **Customer consent form** (WORK-TRACKER 134): download the blank CTOS consent form (PDF / Word) when adding a customer or from Onboarding / KYC; upload the signed copy to the customer. After merge: verify on prod read only (form downloads; KYC panel shows the card); the first real upload is the owner's.
- ~~`feat/stock-take-fifo`~~ merged as #1332 — **FIFO pricing for the stock-take count** (owner 2026-11-11 「要用fifo 定价」, WORK-TRACKER 136): Finance › Stock Take's priced count values each item FIFO from its purchase-invoice lines (newest first, lines over 2× from the newest left out, beyond purchases at the oldest price, unit factors from Warehouse › Stock Take). After merge: verify on prod read only (purchase-prices returns layers / factors; a priced count shows FIFO sources); the owner presses Put into + Save himself.

- ~~`feat/stock-take-styled-sheets`~~ merged as #1328, **verified on prod read only 2026-11-11** (count sheet and usage export downloaded from the live page: 14 sheets × 5 columns, A4 portrait fit to one page wide, header repeated, borders and fills; the import preview flagged a changed UOM and a quantity on a family heading; nothing saved) — Stock Take round 2: count sheet and usage export with lines (A4 portrait, one page wide, header repeated) and a UOM changed on the sheet caught on import (owner 2026-11-11 「做成好看一点的表格，有线条的」「然后 UOM 如果他导出来换呢」). New dependency `xlsx-js-style` (loaded only on export).
- ~~`feat/warehouse-stock-take-count-usage`~~ merged as #1324, breadcrumb fix #1326, both verified on prod read only 2026-11-11 — **Warehouse › Stock Take** (owner 2026-11-11 「先把我要做的 quantities usage 和 export for stock count 功能做好先」, WORK-TRACKER 133): count sheet per type grouped by item-code series (blank, no system quantity), import of the filled sheet (quantities only, kv `stock_count`), usage per item (last count + purchased − this count, unit factor per item), Download for Finance. After merge: verify on prod read only (page, count sheet, usage); the first real save is the warehouse's.

Before it: everything through 2026-11-11 was merged and deployed (prod at `231d0778d` when this was written).

Merge rule: CI green → squash-merge, then verify on prod (owner wants it done without asking, except the approval items and prod data writes). PRs that each append a WORK-TRACKER item collide on the number — merge one, rebase the next, renumber.

**Memory budget:** the owner runs a Houzs ERP session on the same MacBook — keep all sessions under **16 GB**. At most 2 agents at once, each in its own worktree (`isolation: worktree`) with `node_modules` symlinked from the main checkout (no `npm install`), targeted tests + one `tsc` only; CI runs the full suite; commit with `--no-verify` and say why.

## Master checklist (2026-11-10 night) — everything still open

Source of the P/D/G/O ids: `docs/plans/2026-11-10-cross-system-review.md` (what Houzs / Conts did since 2026-10-01 vs Hookka).

**Done and verified 2026-11-10:**
- #1247 P1 document numbers in the Malaysia month · #1241/#1243 new models export · #1245 GRN-link backfill (prod: **0** pre-#1218 system GRNs — nothing to link) · #1246 cross-system review · #1249 this checklist.
- #1250 documents: in-app PDF preview (Print / Download / Share / New tab), every saved PDF named after its document, CANCELLED stamp, cancelled numbers struck through, POD photos on the DO PDF + a POD-photos PDF for WhatsApp, blocked-tab message (D1–D4, D2/G5, P7).
- #1251 lists: header menu + drag on every grid list, URL-kept filters/sort, footer totals without cancelled rows, "Couldn't load — Retry", Malaysian-day date presets, and **G3 fixed** (SO/PO/GRN header sort/filters used to see only the 200 loaded rows; now load all; Invoices say "200 of N — Load all"; BUG-2026-11-10-443).
- #1252 **Board Report inside the ERP** — Forecasting → Board Report, `/board-report?month=YYYY-MM`, accounting:read, Download PDF = browser print (A4, margins None, background graphics on). **Verified on prod (Oct 2026):** 21 pages (13 + 8 appendix), none spills off A4, no section failed; revenue 463,324 / net 136,673 match the Financial Dashboard; first build ≈20 s, next ≈8 s; page-13 flags work. Not live-sourced: stock-take mismatch flag, efficiency bands (top/bottom workers shown instead).
- #1253 ported improvements: O7 no prod data as a public workflow artifact (snapshot now in table `wip_reset_backups`), P2 clock-date gate `scripts/check-clock-dates.mjs` (+ fixed DR/PR/SDN numbers, worker-portal ranges, agent "today"), P3 ETag/304 on polled lists (**verified on prod: 304**), P4 health-red alert email, P6 supplier Email 2/3 + PO email Cc (**verified: field present**).
- #1255 owner-approved G11 batch confirm GRN/PI from the lists + O1 delivery-return compare-and-set (409 "status_changed").
- #1258 O4 a supplier is bound to an item once (409; unique index created only when no duplicates exist — **measured on prod: 39 duplicate pairs, so the index is NOT created yet**; list at `GET /api/supplier-materials/duplicates`) · O5 an upload clears the cached reads at once · O6 shared CSV/Excel import parser (`src/lib/table-import.ts`, header aliases, round-trip tests; importers not yet converted are listed in CODEBASE-MAP).
- #1259 D5 item codes stay on one line on PO/GRN/PI PDFs · D6 DO "Ship From" / GRN "Received At" (the company address, Sungai Buloh) · CANCELLED stamp on the consignment-note PDF · G6 share a column layout with the team · G8/G9 smoother long and grouped lists · G3 for DO ("loaded N of M — Load all") and CN (fetch all; also fixed the CN pager always saying Page 1/1, BUG-2026-11-10-444).

- #1261 phone (/m) lists: "Couldn't load — Retry" + totals without cancelled rows; bank-statement CSV and lead-list import on the shared parser (lead phone typed as a number no longer 500s, BUG-2026-11-10-461). Importers that write prices/stock/wages stay on their own parser (reasons in CODEBASE-MAP).
- #1262 Products SKU Master on the shared grid (row detail panel, dynamic sofa seat columns, pricing hidden without product-pricing) + Leads List view (`?view=list`). **Verified on prod:** SKU Master renders, row panel opens, Sofa seat columns follow Maintenance, two-word search works; Hookka has 0 leads (board and list both empty — not a bug).
- #1263 Board report: page 13 stock-take mismatch flag (`GET /api/accounting/stock-take/check`) and page 11 efficiency bands (90 / 150, shared `src/lib/efficiency-bands.ts`). **Measured on prod (Oct 2026): 13 stock-take groups disagree** — fabric stored RM 14,877 vs RM 97,660 from lines (B.m-fabr 6,723 vs 68,742; S.m-fabr 7,201 vs 25,037; S-fabric 953 vs 3,881), S.filler 7,079 vs 33,666, S.webb 1,876 vs 13,121, S.mech 1,021 vs 5,005, and some the other way (Wd strip 3,653 vs 1,204). Bands: 10 below 90%, 20 within, 1 above (31 workers).
- #1265 cross-system review **pass 2** saved: `docs/plans/2026-11-10-cross-system-review-pass2.md` (Houzs #4387–#5567 and Conts #1–#820 read PR by PR; 54 items + ~20 shared bugs, triaged A1–A4 / needs approval).
- #1270 pass-2 A4 reliability & security: no money/invoice numbers in public Actions logs; DO and CN-return status compare-and-set (a late Delivered can't revive a cancelled DO); DR/PR/ADJ number collision retry; payment-voucher approval compare-and-set; PO double-save row lock; scan-queue jsonb as arrays; EMAXCONNSESSION retried; Idempotency-Key on credit/debit notes, stock adjustments, salary advances; System Health probes outside keys; "Remind approver" on payment vouchers; service-case stage targets with Overdue flags (BUG-2026-11-10-486…490).

**Done and verified 2026-11-10/11 (second half):**
- #1268 pass-2 A3 forms/search · #1267 A2 procurement · #1269 A1 documents/PDF · #1300 R1 Procurement › Reports (supplier delay score, outstanding PO-line ageing) · #1303 form safety sweep (discard / leave prompts on the remaining forms, dashes while loading) · #1304 Chinese names print on DO / invoice / SO / CO PDFs · #1305 attachments on every flow document and line (C1-5).
- **#1308 + #1309 Dark mode** for the whole office ERP (owner 2026-11-11): user menu (top right) › Theme › Light / Dark / System, remembered per browser, **default Light**. `scripts/gen-dark-theme.mjs` runs before every build and maps every hard-coded colour class and inline-style hex in `src/` to a dark counterpart; screen only — print, PDFs and the Board Report stay light; the sidebar keeps its look; worker phone app (`/worker`) untouched. **Verified on prod:** Dashboard, Sales Orders, Accounting overview, Production tracking readable in dark; sidebar text back to normal; dashboard problem figures lightened. Owner's browser left on Light.

**Dark mode — known gaps (polish when seen, no approval needed):** chart libraries that draw colours in canvas/SVG attributes (not `style`) keep their light-mode colours; 49 class uses with unusual variants are skipped (count printed by the generator); `src/pages/m/` (office phone screens) use their own `theme-vars.css` and were not checked in dark.

**Needs the owner's approval (from pass 2 — money / stock / payroll / sign-in / process):** stock count workflow (H1-2/H2-7) · separate Post GRN right (H1-3) · charge-only invoice without a DO (H1-8) · merge duplicate item codes (H2-1) · planned payment date on supplier bills (H2-4) · bank-reco date limit bug (H2 B2) · future-dated supplier price applied today, bug (H2 B3) · maintenance surcharge config not company-scoped, bug (H2 B4) · sign-in hardening: must-change-password, TOTP replay + encrypted secret, session max lifetime, admin signs a person out everywhere, admin password reset rules, staging view-as (H3-2, H3-3, C1-1…C1-4) · per-company default bank (H3-6) · purchase-return replacement question and shortfall prompt (H3-5, C1-6) · payroll bank-transfer export (C1-10) · selfie required for clock-in (C2-12) · expense claims / petty cash (C2-13) · limit users to product categories (C2-14) · DO `deliveredAt` from the server clock instead of the phone (it dates the COGS posting and the default invoice date; from #1269).

**New questions for the owner:**
- **October stock take disagrees in 13 groups** (figures above). The P&L uses the stored values; Finance to say which side is right — if the line totals are right, October raw-material cost and profit change materially.
- **39 duplicate supplier↔item bindings on prod** (e.g. STE SOLID TIMBER `MLHW-1" X 2" X3"-7'`, ADD WOOD `CHIPBOARD KOSONG 4X8-9MM`). New duplicates are refused already; cleaning the old ones (keep one per pair) is a prod data write — the owner cleans them in Suppliers → SKU, or says "clean them" and Claude first shows which row of each pair it would keep. After cleanup the unique index is created on the next worker start.
- Goods bought under a sister company's letterhead (e.g. OHANA): are they also received at Sungai Buloh? (GRN "Received At" prints the company address.)
- Delete the two old `wip-reset-backup` artifacts (2026-09-07, production WIP quantities) that stay publicly downloadable until 2026-12-06? (GitHub → Actions → artifacts; needs his yes.)
- The money / stock / payroll date sites still use the UTC day (`scripts/data/clock-date-allowlist.json`: accounting period defaults, invoice due dates, cost ledger, fabric FIFO, AR ageing, worker-portal live pay estimate). Moving them to the Malaysian day changes which day/month is used 00:00–08:00 — **needs approval**; if approved, the worker-portal estimate must move together with office payroll.
- P4 health alerts: who should receive them? Set `kv_config.health_alert_recipients` (else the morning-brief list is used; nothing is sent if neither is set — UNMEASURED which is set).

**Owner's ruling on the approval items (2026-11-10):**
- **APPROVED — done** (listed under Done today; PR `feat/batch-confirm-and-return-guard`): **G11** batch confirm on the GRN / PI lists (drafts only, one at a time through each document's own confirm, "Confirming 3 of 12", refusals listed with the server's reason) · **O1** delivery-return status changes are compare-and-set (the page sends the status it saw; 409 "it is now X, it was Y" when the return moved).
- **REJECTED by the owner — do not do, do not ask again:** **P5** credit-note cap from delivery returns · **O2** MRP stale-plan refusal · **O3** partial DO / invoice discount share.

**Owner to do himself (Claude cannot):**
- Try the new features in a browser (desktop + phone): share a column layout and see it from a second login; Products export → re-import the same file; PDF Preview on an SO/PO → Print, Share, Save (file name = document number); GRN / PI list → tick 2–3 drafts → Confirm selected; a delivery return open in two tabs → cancel in one, act in the other → the 409 message; Board Report → Download PDF; edit a supplier's Email 2/3 → PO Email to Supplier shows them in Cc.
- Repo `Houzs-IT/hookka-erp-testing` is **PUBLIC** (measured 2026-11-10) and an old prod DB password is in its git history: decide private, rotate the password.
- Try on prod (these write data): sign one device out → it gets 401; a 5,001-char SO note → 400; a lead with a phone already on file → "Possible duplicate"; Ctrl/Cmd+C from a grid into Excel; a save with several problems lists them all.
- Upload missing Catalog photos: BC06, BC06-MF, SQUARE PILLOW, HIPSTER (its photo file is missing from storage).

## Merged in this run (2026-11-08/09) — from the Houzs / Conts review list

#1207 paging tie-break · #1208 PO/GRN/PI idempotency · #1209 CSV formula-injection + BOM ·
#1215 capped lists say so · #1216 invoice search/filter paging · #1217 every "today" in Malaysia time ·
#1218 PI auto-GRN linked back (no double billing) · #1219 PI shows PO price · #1220 PI line must match GRN material ·
#1221 PO sees multi-PO GRNs · #1224 RM code rename carries bindings/BOM/price history ·
#1225 stock value load error instead of RM 0 · #1226 duplicate supplier invoice check (edits + spacing) ·
#1228 stale SO/PO save refused (409) · #1229 /health commit stamp, Smart Placement, announcements cap, lead phone dedupe ·
#1230 locked SO says which department holds it · #1231 in-app confirms, multi-word search, consolidated save blockers ·
#1233 FE quality batch (real error reasons, PDF text clean-up, number-input wheel guard, dropdown flip, MRP sticky header, header wrap) ·
#1234 security batch (default-deny RBAC test, text caps, signed-in devices, query-in-loop guard) · #1235 grid copy / range sum / URL filters ·
#1244 handoff · #1245 GRN-link backfill endpoint · #1246 cross-system review · #1247 document numbers in the Malaysia month ·
#1240 batch B of saves that acted "saved" on a refusal (cash flow, employees/payroll/leave, PO mark-emailed, organisations, assistant; BOM migration data-loss guard) ·
#1241 `GET /api/products/new-models?from=&to=` — new models by product created date, one per family, Catalog cover photo inlined, bedframe Q/K/SK + sofa combo prices (no UI button, owner's choice) · #1242 GRN test shim fix · #1243 export polish (unpriced → "No price set yet", per-customer combo ranges, charge lines skipped).

## Still to verify on prod (not yet observed)

- ~~MRP sticky header~~ — **checked 2026-11-10**: `thead` is `position: sticky; top: 0` inside the scroll box and the Material column is `sticky; left: 0` (#1233). The MRP has not been run since 28 Aug, so the table was empty; a real scroll is still unobserved.
- ~~`GET /api/health` shows a commit~~ — **verified 2026-11-09**: returns `"commit": "095750132…"` (#1229).
- #1234: ~~device list loads~~ **verified 2026-11-10** (4 sessions, current flagged, `lastSeenAt` set). Still unobserved (they write to prod — owner to try, or approve): signing one device out gives it 401; a 5,001-char SO note is refused with 400.
- #1235: a real Ctrl/Cmd+C from a grid pastes into Excel.
- #1240: a refused save (e.g. a leave request the server rejects) shows the server's reason and the form stays open.
- Lead create with a phone already on a lead → "Possible duplicate lead" dialog (#1229).
- Forecast saves, unverified until the owner's first Save (prod writes): Capex & financing (#1211), the Cash Flow copy dropped on a Forecast P&L save (#1238), a supplier figure keyed as % (#1282), ~~a save from the Monthly P&L's Edit forecast (#1285)~~ **observed 2026-11-10**: the owner's test save was stored and read the same everywhere, then restored at their request. ~~The trade-finance plan (#1227)~~ **observed 2026-11-10**: the owner has saved a ten-month plan, and it reads back in the popup. ~~Supplier figures under each material (#1274)~~ **observed 2026-11-10** after the owner's first save: stored per material, and read the same by the page, the Cash Flow P&L forecast and the Finance Dashboard. ~~Sales by customer (#1222)~~ **observed 2026-11-10**: the owner has saved customer figures. In every one of the nine months that carry them, the stored Sales equals their sum.
- A supplier figure keyed as a % of sales (`feat/forecast-supplier-pct`, WORK-TRACKER Cash Flow forecast item 17): unverified on prod until the owner first saves one (a prod write). Check it is stored as `{ bp }`, and that the page, the Cash Flow P&L forecast and the Finance Dashboard show the same worked-out amount.
- Trade-finance per-month ticks (#1297, WORK-TRACKER Cash Flow forecast item 22; replaces item 21's Suppliers box; read side verified on prod 2026-11-10): the first Save of a ticked plan is unverified on prod until the owner makes one (a prod write). Check that kv `cashflow_forecast_tf` holds that facility's `ticks` and computed `months`, that the popup reopens with the rows and ticks, and that the Cash Flow forecast's drawdowns equal the popup's.
- ~~The Financial Dashboard asking again after a stale answer~~ **verified 2026-11-10** (#1280, WORK-TRACKER Cash Flow forecast item 16). On prod a stale first read carries `stale` beside data. The page shows "Updating…", asks again about 10 s later and swaps in the new figures, on desktop and phone. A real reload met a real stale copy and did exactly that.
- Bug-number collision, 2026-11-10: #1254 filed the Cash Flow column bug as BUG-2026-11-10-444 and #1259 then used 444 for the consignment-note pager, its file replacing the first one. The Cash Flow entry is now BUG-2026-11-10-462. Check `git ls-tree origin/main docs/bugs/` and the open PRs before picking a number.
- ~~Two-word grid search~~ **verified 2026-11-10** on Products: "kabbin 1a" → only the two KABBIN 1A rows (#1231). Save-blocker toast listing several problems (#1231): still unobserved.
- ~~#1241 new models export~~ **verified 2026-11-10** on prod: Nov = KABBIN, BANGGAU (5569), 5567 with photos; Oct = 5536, BC06, BC06-MF. 272 active products have no `created_at` (made before the column existed) and are never "new". Re-check after #1243 deployed: 5567 / 5569 read "No price set yet", SERVICE CHARGE gone.

## Follow-ups (approved, not done yet)

- ~~~40 lesser saves ignore the server response~~ — done in #1240 (merged) (15 real fixes; the rest are deliberate best-effort or already checked, listed in `docs/bugs/BUG-2026-11-09-435.md`).
- ~~Backfill of pre-#1218 system GRNs~~ — owner approved 2026-11-10; endpoint shipped in #1245; preview on prod found **0** such GRNs (37 GRNs in total, none from PI auto stock-in), so there is nothing to write.

## Shipped 2026-11-10 — Dashboard › Operations › Floor Live

#1288 (feature) + #1291 (owner feedback). Who is in which department now from department QR scans; production rows show last check-in to the department, pieces done and live efficiency (number red only below 80%); non-production rows show scan-in time and the whole row turns red after 1 hour while still punched in; names only; owner card order; refresh every 5 min. Code: `src/api/routes/floor-live.ts`, `src/api/lib/floor-live.ts`, `src/pages/dashboards/FloorLiveView.tsx`, `floor-live-lib.ts`; guide: `docs/modules/dashboard.md`. Verified on prod 2026-11-10 (desktop + 390 px phone width) against the day's real data.

## Waiting on the OWNER (decide / provide)

1. ~~**Money / process items A–H**~~ — **owner decided 2026-11-10: not needed, do not build** (A re-cost by PI price · B payment edit resets bank · C first DO flips SO to shipped · D partial completion locks SO · E document-number collisions · F bank reconciliation duplicates & closing · G month-end stock posting · H SO amendment flow). Do not reopen unless the owner asks.
2. **Item 9 — enforce PO→GRN→PI link in the DB:** recommended **not** to do (office bills straight from the PO; most PIs since June have no GRN). Confirm drop.
3. **SO edit lock:** should a BLOCKED job card count as "production started"? (today it does, so the SO locks). Also send the SO number that could not be edited so it can be checked.
4. **Mail Center:** the ERP "Sent" (outbox) list is not filtered by mailbox — anyone with Mail Center access sees every ERP-sent email. Keep, or limit to own + subordinates?
5. **Gmail questions:** viewing subordinates' mail — in Gmail or in ERP Mail Center? Company-domain mailboxes or personal @gmail.com? ("Undo send" is Gmail's own 5–30 s hold, not an ERP feature.)
6. **6 retired raw-material unit rows** (merged by mistake across units): PC151-01 / PC151-02 / PC151-17 (MTR), NON WOVEN BLACK (ROLL), MHW 1 X 2 (CTN), TARONI-NAVY BLUE (PCS). **Owner 2026-11-11 「用mtr」 for the three PC151 items:** the kept rows are relabelled ROLL → MTR (Super Admin relabel, quantities kept; WORK-TRACKER 135); the retired rows stay retired. NON WOVEN BLACK / MHW / TARONI still to decide.
7. **Supplier ↔ material bindings:** waiting for the owner's checked raw-material list (`Raw-Material-Supplier-List-2026-11-07.xlsx`, `Supplier-Binding-Plan-2026-11-07.xlsx`).
8. **Finance to confirm:** Oct staff cost RM 1,733 looks incomplete; equity rose 73,279 more than profit; Oct fabric stock-take RM 14,877 stored vs RM 97,660 from lines; Monthly P&L Oct net 136,271 vs /pl report 194,914.
9. ~~Forecast proposals~~ — **done (2026-11-10, Windows session)**: the owner said do both. Materials by ratio or by supplier on the Forecast P&L, and Hide past months on the Cash Flow forecast, shipped in #1266 and verified on prod read only (Hide past months corrected in #1272: past months keep their Actual). Then the owner asked for the suppliers under each material instead of one total spread by ratio (「让他在每个categories 出现相关的supplier, 我从那边填」→「做」), on `feat/forecast-suppliers-by-material`. Details: `docs/WORK-TRACKER.md`, Cash Flow forecast items 14 and 15.
10. ~~Forecast follow-ups proposed 2026-11-10~~ — **the owner said 「做」 to both (Windows session, same evening).** The trade-finance one-click "Fill from Forecast P&L" shipped and was verified (#1284), and so did keying the forecast inside the Monthly P&L (Edit forecast, #1285). See `docs/WORK-TRACKER.md`, Cash Flow forecast items 18 and 19. Then the owner asked to choose the suppliers that fill takes by ticking them in a small table with each one's Forecast P&L amount (「我要能选…就是tick」, with a screenshot of the look) and said 「做」: shipped in #1290 and verified on prod read only, item 21. The check found BUG-2026-11-10-491: an unticked supplier with no figure vanished from the table. Fixed in #1292, verified on prod read only. The owner then found the yearly ticks confusing (「我如何选这个月哪里有个supplier 要用trade finance?」), and after a mockup said 「做」 to a tick per supplier per month, shown only after Fill from Forecast P&L: shipped in #1297 and verified on prod read only, item 22.
11. **Opening-period customer receipts (2026-11-11):** the owner asked to stop showing two customers' receipts that pay invoices from before the opening; 「可以」 to the proposal. Debtor Aging and TO RECEIVE leave the 8 receipts still on account out of their columns and name the total (#1317, verified on prod read only 2026-11-11; WORK-TRACKER, "Debtor Aging: opening-period receipts").
    - The owner's staff are checking the open end-of-May invoices behind the remaining 3+ months figures, from a CSV given in chat (names and amounts are in the handover file, not the repo).
    - Once the opening invoices are entered and the receipts knocked off, the note goes by itself.
12. **Customer consent form (2026-11-11, WORK-TRACKER 134):** the owner wants a consent form to download when adding a customer, and the signed copy uploaded to the customer. Sample received (the CTOS / CCRIS consent letter). In PR `feat/customer-consent-form`: blank form as PDF + Word on the new-customer card and in the customer's Onboarding / KYC panel, signed copy uploaded to the customer (type `CUSTOMER_CONSENT`, gated like customers).

## Board report inside the ERP (item 115 — merged #1252, verified on prod 2026-11-10)

Forecasting › **Board Report** (`/board-report?month=YYYY-MM`, default the last closed month), accounting:read for the menu and `GET /api/reports/board`. Every figure is read live from the ERP's own report endpoints (called in-process with the viewer's session, so each keeps its own permission gate and cache) — nobody rebuilds a snapshot each month. 13 A4 pages + appendices A (Monthly P&L), B (Balance sheet), C (Cash flow); Download PDF = browser print (A4, margins None, background graphics on). Page 13 = automatic flags + Finance's notes (kv_config `board_report_notes:<YYYY-MM>`, written by `PUT /api/reports/board/notes`, accounting:update).
- **To check in a browser after merge** (not done — no browser run in the build session): every page fits its sheet with no clipped rows on real October data; print preview gives exactly one sheet per page; the first build's time (it reads about twelve reports; the 30 s client abort is lifted for this call only); photos on page 10.
- Sections a viewer's role cannot read say so (e.g. customers need `dashboard` read, new models `products` read, worker efficiency `workers` read) instead of showing zeros.
- Not sourced live: the fabric stock-take "stored vs from lines" check (no endpoint exposes it) — the Notes page cannot flag it.
- Once this is merged and checked, the Claude artifact below can be retired.

## Board report (artifact)

Claude artifact "Hookka Monthly Board Report" (https://claude.ai/artifact/GvMT67d19bgmqvHXQpSmDg, private to the owner). Rebuilt 2026-11-10:
- 13 A4 pages + appendices A (3 pages), B, C (3 pages); every page fills to its footer (one elastic chart per page) and caps growing lists with an "Other" row.
- New pages: **8 Cash flow forecast** (from the Cash Flow page with Forecast on: Docs vs P&L basis; data asset `cashforecast.json`, measured 2026-11-10) and **10 New models** (photo cards + prices; data asset `newmodels.json`).
- Labour: share of direct labour + % of total production revenue (production revenue = value of work completed, not sales). Trend: Nov/Dec forecast columns + net profit chart.
- Export: Share → Export → PDF (photos are stored in the artifact).
- **To do:** New models page still lists the first-price-date models (Sep–Nov); refresh it from `GET /api/products/new-models` (created-date basis — October has 5536, BC06, BC06-MF). Photos come as data URLs: download the JSON through the owner's browser (ask first), split photos into artifact assets, upload. The main report data (`791e5…` asset) is still a hand-built October snapshot; each month it must be rebuilt.

## Housekeeping

- Local worktrees on the Windows machine (`../hookka-erp-testing-worktrees/{checklist,tmp-rebase,sec-batch,fe-batch-a,fe-batch-b,fe-grid-copy-sum}`) can be removed once #1234/#1235 merge; they hold no unpushed work.
- ~~`CLAUDE.md` NAVIGATION-MAP pointer~~ — already points at `docs/CODEBASE-MAP.md` on main.
- The repo is now `Houzs-IT/hookka-erp-testing` (GitHub redirects from `weisiang329-eng/…`).

## Working agreements with the owner (carried over — the Windows machine's Claude memory does not travel)

- The owner wants the work **done, not a stream of choices**: split work across agents and merge when CI is green; only stop for the approval items and prod data writes (2026-11-10: 「为什么要选择 一直按button呢」).
- The owner is **not technical**: reply in plain Chinese — he asked again on 2026-11-10 (UI stays 100% English), say what shipped and how to use it, no code dumps. Only pull him in for real business decisions.
- Low-risk docs / chore / navigation work may be finished and **merged autonomously**. Anything touching **money, inventory, payroll, auth or cascades**: propose → owner confirms → then code; do not auto-merge.
- Production data writes need explicit owner approval each time. Salary figures only for accounts with Payroll permission. Never print `.dev.vars` or secrets.
- Owner rulings already given: Hookka **may over-receive** against a PO; a PO price of 0 is fine — **stock is valued at the PI price**; raw-material UOM rows must not be merged across units ("UOM 你不要动她"); default supplier = cheapest by the **largest-quantity** PI price, and a supplier not ordered from in **4 months** counts as no longer supplying.
- HR / costing records that look wrong but are deliberate: resignation date = last **paid** day; "OUTSOURCE - …" records (OSC-002/003) are intentional and not counted as people; **Chee** is a view-only login; raw-material usage stays on the P&L stock-take basis until the RM BOM is complete; Houzs Venture salaries stay out of Hookka labour.
- Repo lint debt: main carries eslint errors in untouched files and the pre-commit hook is zero-tolerance on touched files — update PR branches by **rebase**, clear debt in touched files in a separate `chore(lint)` commit.

## Parked by the owner (do NOT do unless he reopens it)

Security audit of 2026-07-23 — findings verified in code, owner said "这批不做" for now. Plan, if reopened:
- **A1** worker first-time PIN self-registration (`worker-auth.ts`, anyone knowing an empNo can set a PIN) → reject first-time self-set; admin sets PIN (`workers.ts /:id/set-pin`, `/bulk-generate-pins` already exist).
- **A3** public rack stock-in write — open question: does the warehouse scan while logged into the worker portal? If yes, gate the write behind `X-Worker-Token`.
- **A4** DO-QR never expires → expire ~30 days after `deliveredAt`, days configurable via kv_config.
- **B1** `import-completion.ts POST /backfill-fabcut-rm-issue` has no `requirePermission` → add `production-orders:update`.
- **B2** accept-invite allows a 6-char password → `validatePasswordStrength`.
- **B3** `files.ts PATCH /:id/cover` has no permission check.
- **C1** assistant `run_select_query` has no sensitive table/column deny-list (user_sessions token, totpSecret, pins, reset tokens, invites, password hashes).
- **D** four stored-XSS print sinks (`document.write` of raw DB text) in accounting, production and sales detail → wrap in `escapeHtml`.
- Owner keeps: A2 (public rack-QR GET shows customer name/PO — tokens are physical only).

Older pending lists live in `docs/archive/PENDING-TASKS-HANDOFF.md` and the other `docs/archive/HANDOFF-*.md` files. About 200 stale local worktrees on the Windows machine were never cleaned up (machine-local, no repo impact).
