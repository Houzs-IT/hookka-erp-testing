# Handoff — current state, what's next, what's blocked

_Last updated: 2026-11-10 evening (MacBook session). Read the **Master checklist** first — it is the single list of everything open._
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

- `feat/pdf-preview-and-documents` — agent batch: D1 shared PDF preview + file named after the document, P7 blocked-tab helper, D2 CANCELLED stamp, G5 struck-through cancelled numbers, D3/D4 POD photos. PR opens when done; check `gh pr list`.
- `feat/grid-common-features` — agent batch: G1 header menu + reorder on every list, G2 URL filters, G3 paged-list filter check/fix, G4 footer totals, G7 load-error Retry.
If a branch exists with no PR, the agent was interrupted: open the PR from it or redo the item. Merge rule: CI green → squash-merge (owner wants it done without asking, except the approval items below).

**Memory budget:** the owner runs a Houzs ERP session on the same MacBook — keep all sessions under **16 GB**. At most 2 agents at once, each in its own worktree with `node_modules` symlinked from the main checkout (no `npm install`), targeted tests only; CI runs the full suite.

## Master checklist (2026-11-10) — everything still open

Source of the P/D/G/O ids: `docs/plans/2026-11-10-cross-system-review.md` (what Houzs / Conts did since 2026-10-01 vs Hookka).

**Done today:** P1 document numbers in the Malaysia month (#1247) · new models export (#1241, #1243) · GRN-link backfill endpoint (#1245; measured on prod: **0** pre-#1218 system GRNs exist, nothing to link) · cross-system review saved (#1246) · **ported-improvements batch (PR `feat/ported-improvements-batch`, open until merged): O7, P2, P3, P4, P6** — see "After it merges" below.

**In flight (agent batches above):** D1, D2, D3, D4, P7, G1, G2, G3, G4, G5, G7.

**After `feat/ported-improvements-batch` merges (check on prod):**
- O7: two old `wip-reset-backup` artifacts (2026-09-07, production WIP quantities) are still downloadable until 2026-12-06 — **owner to decide whether to delete them** (Actions → artifacts).
- P2 left the money / stock / payroll "UTC day" sites as they are, listed with reasons in `scripts/data/clock-date-allowlist.json` (accounting period defaults, invoice due dates, cost ledger, fabric FIFO, worker-portal live pay estimate). Fixing them moves which day/month is used between 00:00 and 08:00 MYT — **needs the owner's yes**.
- P3: DevTools on the bell / IT Support should show an unchanged poll as `304`.
- P4: alerts go to `kv_config.health_alert_recipients`, else the morning-brief list `daily_report_recipients` (UNMEASURED whether either is set on prod). Nothing is sent while Analytics Engine metrics are mock. The drain's JSON reply now carries `healthAlert` (job log of "Email Outbox — Drain Cron").
- P6: edit a supplier → Email 2 / Email 3 save; PO "Email to Supplier" opens with them in Cc.

**Next batches (no approval needed — do them, then merge):**
1. ~~Ported-and-improved: P2, P3, P4, P6~~ — done in `feat/ported-improvements-batch` (with O7).
2. Documents/grid leftovers: D5 item codes on one line on PO/GRN/PI PDFs, D6 warehouse named on DO/GRN papers, G6 share a column layout with the team, G8 grouped lists keep virtual scroll, G9 fewer re-draws on long lists, G10 date filters judge by the Malaysian day.
3. Other: O4 supplier bound to the same item once (unique index, 409), O5 upload clears the read cache, O6 shared CSV/Excel import parser, ~~O7~~ (done in `feat/ported-improvements-batch`).
4. **Board report inside the ERP** (owner 2026-11-10: every figure from live ERP data, nobody has to ask Claude). Decided: menu **Forecasting → Board Report**; visible to **accounting:read**; Notes page = **automatic flags + Finance-editable notes per month**; PDF = **browser print to PDF** (A4 page per section). Data sources mapped: `/api/accounting/dashboard` (monthly P&L actual+forecast, balance-sheet totals, ratios, cash-flow totals, salary by dept, cost structure, production revenue, labour base), `/api/accounting/pl-monthly`, `/api/accounting/pl` (balance sheet; call M and M-1), `/api/accounting/cashflow-statement` + `/cashflow-forecast`, `/api/dashboard/overview` (customers + concentration) and `/overview/revenue-split` (dept production revenue), `/api/products/new-models`. Gaps to build: P&L prev column, balance-sheet prev, server-side defect rates, efficiency bands (none today — use workforce top/bottom). Layout reference: the Claude artifact https://claude.ai/artifact/GvMT67d19bgmqvHXQpSmDg (13 pages + appendices).

**Needs the owner's approval first (money / inventory) — do NOT start without a yes:** P5 credit note from a delivery return capped at the returned qty · G11 batch confirm GRN/PI · O1 delivery-return status compare-and-set · O2 MRP refuses a stale plan · O3 partial DO/invoice carries its share of the line discount.

**Owner to do himself (Claude cannot):**
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
- Forecast saves, unverified until the owner's first Save (prod writes): Forecast P&L sales by customer (#1222), the trade-finance plan (#1227), Capex & financing (#1211), and the Cash Flow copy dropped on a Forecast P&L save (#1238).
- ~~Two-word grid search~~ **verified 2026-11-10** on Products: "kabbin 1a" → only the two KABBIN 1A rows (#1231). Save-blocker toast listing several problems (#1231): still unobserved.
- ~~#1241 new models export~~ **verified 2026-11-10** on prod: Nov = KABBIN, BANGGAU (5569), 5567 with photos; Oct = 5536, BC06, BC06-MF. 272 active products have no `created_at` (made before the column existed) and are never "new". Re-check after #1243 deployed: 5567 / 5569 read "No price set yet", SERVICE CHARGE gone.

## Follow-ups (approved, not done yet)

- ~~~40 lesser saves ignore the server response~~ — done in #1240 (merged) (15 real fixes; the rest are deliberate best-effort or already checked, listed in `docs/bugs/BUG-2026-11-09-435.md`).
- ~~Backfill of pre-#1218 system GRNs~~ — owner approved 2026-11-10; endpoint shipped in #1245; preview on prod found **0** such GRNs (37 GRNs in total, none from PI auto stock-in), so there is nothing to write.

## Waiting on the OWNER (decide / provide)

1. **Money / process items A–H** (from the Houzs review; not touched):
   A. re-cost by PI price incl. multi-PO lines · B. editing a payment resets the bank to Hong Leong ·
   C. first DO flips the whole SO to shipped · D. partial completion locks the whole SO ·
   E. document numbers by creation month can collide · F. bank reconciliation duplicates & closing ·
   G. automatic month-end stock posting · H. SO amendment flow.
2. **Item 9 — enforce PO→GRN→PI link in the DB:** recommended **not** to do (office bills straight from the PO; most PIs since June have no GRN). Confirm drop.
3. **SO edit lock:** should a BLOCKED job card count as "production started"? (today it does, so the SO locks). Also send the SO number that could not be edited so it can be checked.
4. **Mail Center:** the ERP "Sent" (outbox) list is not filtered by mailbox — anyone with Mail Center access sees every ERP-sent email. Keep, or limit to own + subordinates?
5. **Gmail questions:** viewing subordinates' mail — in Gmail or in ERP Mail Center? Company-domain mailboxes or personal @gmail.com? ("Undo send" is Gmail's own 5–30 s hold, not an ERP feature.)
6. **6 retired raw-material unit rows** (merged by mistake across units): PC151-01 / PC151-02 / PC151-17 (MTR), NON WOVEN BLACK (ROLL), MHW 1 X 2 (CTN), TARONI-NAVY BLUE (PCS) — restore needs owner authorisation (or restore in Raw Materials).
7. **Supplier ↔ material bindings:** waiting for the owner's checked raw-material list (`Raw-Material-Supplier-List-2026-11-07.xlsx`, `Supplier-Binding-Plan-2026-11-07.xlsx`).
8. **Finance to confirm:** Oct staff cost RM 1,733 looks incomplete; equity rose 73,279 more than profit; Oct fabric stock-take RM 14,877 stored vs RM 97,660 from lines; Monthly P&L Oct net 136,271 vs /pl report 194,914.
9. **Forecast proposals (Windows session, 2026-11-10; nothing built):** (a) suppliers keyed like customers on the Forecast P&L — the owner said 「这个我确定先」 (deciding first); (b) a "Hide past months" toggle on the Cash Flow forecast — waiting for 「做」. Details: `docs/WORK-TRACKER.md`, Cash Flow forecast item 14.

## Board report inside the ERP (item 113, PR open — not merged)

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
