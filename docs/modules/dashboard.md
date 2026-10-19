# Dashboard & Command Center — Module Guide

> **Last verified: 2026-10-19** (branch `feat/dashboard-ops-day-view`, to `staging`): the Department Revenue JSX row (anchor :1702 and the Day view). Nothing else re-checked.
> **Last verified: 2026-10-16** (branch `chore/sync-staging-from-main-1016`, staging<-main merge): the Phone Department Revenue row came over from main, its `Home.tsx` anchor and the `/revenue-split` anchor (:2664) re-read on the merged tree. Nothing else re-checked.
> **Last verified: 2026-10-16** (branch `fix/po-list-cache-staging`, to `staging`): only the `src/api/worker.ts` / `production-orders.ts` line refs, shifted by the list ETag change and re-read at their new lines. Nothing else re-checked.
> **Last verified: 2026-10-09** (branch `feat/compare-fabric-purchasing-tab`): the dashboard-overview.ts line anchors re-derived after new imports moved the handler. Nothing else re-checked.

> **Last verified: 2026-10-09** (branch `feat/dashboard-month-static-kpis`): the month-awareness summary (daily Pending Delivery / Outstanding save) and the cache-key version re-checked against `dashboard-state-snapshot.ts` and `dashboard-overview.ts`. Nothing else re-checked.

> **Last verified: 2026-10-08** (branch `feat/plant-load-14d`): the month-awareness summary (frozen past months, 14-day capacity) and the cache-key version re-checked against `dashboard-overview.ts`. Nothing else re-checked.

> **Last verified: 2026-08-14** (branch `docs/docs-vs-code-audit`) — corrected against the
> source by the prose audit; the row(s) touched here are itemised in
> [`docs/DOCS-VS-CODE-AUDIT.md`](../DOCS-VS-CODE-AUDIT.md). Only the claims listed there were
> re-verified; the rest of this file still carries its earlier stamp.

> **Last verified: 2026-08-13** against `src/pages/dashboard-b/{index,charts}.tsx`, `src/api/routes/dashboard-overview.ts`, `src/api/lib/dashboard-snapshot.ts`, `src/api/lib/dashboard-state-snapshot.ts`, `src/dashboard-routes.tsx`, `src/api/worker.ts`, and `tests/`.
> Corrected 2026-08-13: the `/api/dashboard/overview` mount is `worker.ts:1304` (was 1195); `dashboard-overview.ts` is 2,249 lines (was 2043) and its past-month / write-back anchors moved ~200 lines. Everything else (all page symbols, both snapshot libs, both named tests, the `/dashboard-b`→`/dashboard` redirect) verified correct.

> Self-navigating docs (L2). Repo-wide map: [[CODEBASE-MAP]]. Never grep the whole repo — use the file:line below.

## What it does
The homepage **Command Center** at `/dashboard`: a KPI rail (Sales · Invoices · Pending Delivery · Outstanding) plus every operational widget — Daily Report exceptions, Revenue chart, Plant Load, Order Pipeline, Worker efficiency, Revenue by Customer, Top sellers, Fabric usage, Department backlog and Purchasing. The whole page is one file (`dashboard-b/index.tsx`); nearly all of its data is one server-aggregated GET (`dashboard-overview.ts`) that is snapshot-backed and 60s KV-cached. Naming trap: the folder is `dashboard-b` and the API is `dashboard-overview`, but this IS the production dashboard — the legacy `/dashboard` page was retired 2026-05-21. Month-awareness is snapshot-driven: point-in-time widgets (backlog, active jobs, headcount) serve a stored daily snapshot for a past month, else a live value tagged "live (no history)". Pending Delivery and Outstanding are saved daily by their own endpoints (whole-company only) into the same daily row; a finished month shows its saved figure or "no record" (`stateKpis`, `stateKpiTile`), never today's live one. A finished month is frozen whole on its first view (`freezeMonth`, table `dashboard_month_frozen`) and served as stored after that. Daily Capacity averages the last 14 working days for All-time and the current month (`ROLLING_DAYS`). `?capacityWindow=7|14` feeds the staging-only `/dashboard/compare` page (on a picked month both windows stay inside it, ending on its last day or yesterday) and bypasses every stored copy.

## Entry points
- Pages
  - `/dashboard` → `src/pages/dashboard-b/index.tsx:689` (`DashboardBPage` — the entire Command Center)
  - `/dashboard-b` → redirects to `/dashboard` (`src/dashboard-routes.tsx:233`)
  - Lazy recharts wrappers → `src/pages/dashboard-b/charts.tsx` (`RevenueChart:60`, `CustomerPieChart:149`)
  - Route + prefetch wiring → `src/dashboard-routes.tsx:20` (lazy import), `:572` (chunk prefetch map)
- API routes
  - Overview aggregate (single GET) → `src/api/routes/dashboard-overview.ts` (2249 lines), mounted at `/api/dashboard/overview` (`src/api/worker.ts:1312`)
  - Read-through snapshot lib → `src/api/lib/dashboard-snapshot.ts` (272)
  - Daily point-in-time state snapshot lib → `src/api/lib/dashboard-state-snapshot.ts` (148)
  - Nightly cron invalidation → `app.post("/api/internal/rebuild-dashboard-snapshot")` `src/api/worker.ts:395`

## Data model
- `dashboard_snapshot` — one row per `org_id`; the `built_from` column makes it data-change-aware (freshness Layer 1). `readSnapshot`/`writeSnapshot`, `ON CONFLICT (org_id)` upsert.
- `dashboard_state_snapshot` — daily point-in-time counts (backlog / active jobs / workforce); PK `(org_id, snap_date)`, idempotent UPSERT. Powers past-month history for state widgets.
- `kv_config` — the 60s KV cache layer (`cached(...)`, key `dashboard:overview:<org>:v23:<period>`).
- Read-only source tables (no writes from this module): `sales_orders` / `sales_order_items`, `invoices`, `delivery_orders` / `delivery_order_items`, `consignment_order_items`, `production_orders` / `job_cards`, `cost_ledger`, `purchase_orders` / `purchase_order_items` / `grns`, `products` / `raw_materials` / `workers`.
- The overview endpoint is READ-ONLY over business data — it only writes the two snapshot/cache tables.

## Core flows
1. **Overview read (three-layer freshness)** — `app.get("/")` `dashboard-overview.ts:51`. For `period=all`: (1) `readSnapshot` + `getMaxSourceUpdatedAt` in parallel (`:128`); if `isSnapshotFresh` (`:132`) serve the stored row. Else (2) 60s KV `cached(...)` (`:140`); else (3) the full ~27-query compute, written back via `writeSnapshot` near the tail of the handler.
2. **Daily state capture** — `captureTodayState` (`:78`) extracts backlog/activeJobs/headcount from the live payload and fire-and-forgets `writeStateSnapshot` via `waitUntil`. Called on a snapshot hit (`:137`) and after any live (non-past-month) compute (`:2243`). Guarded so a past-month payload is never written back as "today".
3. **Past-month reconstruction** — when `isPastMonth` (`:70`), the handler reads the stored state snapshot via `readStateSnapshotForMonth` (`:1931`) and overrides the live state widgets with that month's captured values (falling back to a reconstructed backlog when no snapshot exists).
4. **Frontend staged fetch** — `DashboardBPage` fires three parallel loads (`ovL`/`soL`/`pendingL`, see comment `:779`): overview drives the KPI rail + most sections, sales-orders/stats drives the Order Pipeline + Outstanding, and 4 heavy live fetches drive Pending Delivery. Each section shows `SectionRowsSkeleton` until its own fetch lands. The overview fetch URL is `dashboard-overview.ts`-backed `index.tsx:713`.
5. **Nightly rebuild** — cron (`.github/workflows/rebuild-dashboard-snapshot.yml`, 02:00 SGT) POSTs `/api/internal/rebuild-dashboard-snapshot` (`worker.ts:387`, CRON_SECRET-gated) which DELETEs every `dashboard_snapshot` row so the next read recomputes — belt-and-braces vs silent drift.

## Key functions / sections (locate-to-function)
| Symbol / section | file:line | Role |
|---|---|---|
| `DashboardBPage` | `src/pages/dashboard-b/index.tsx:716` | Main component: staged fetches, useMemos, all JSX |
| `KTile` | `src/pages/dashboard-b/index.tsx:439` | The KPI card used by the four Command Center cards |
| `Spark` / `DeltaChip` | `src/pages/dashboard-b/index.tsx:394 / 421` | Sparkline + delta-% chip |
| `SectionRowsSkeleton` | `src/pages/dashboard-b/index.tsx:521` | Per-section loading placeholder |
| `Gauge` / `MiniTable` / `SectionTitle` | `src/pages/dashboard-b/index.tsx:650 / 578 / 625` | Presentational helpers |
| KPI rail JSX | `src/pages/dashboard-b/index.tsx:1117` | Sales · Invoices · Pending Delivery · Outstanding cards |
| Revenue chart + Plant Load JSX | `src/pages/dashboard-b/index.tsx:1374` | Area chart + backlog-vs-capacity gauge |
| Order Pipeline + Worker efficiency JSX | `src/pages/dashboard-b/index.tsx:1609` | |
| Revenue by Customer JSX | `src/pages/dashboard-b/index.tsx:1749` | Concentration exhibit (donut + category modes) |
| Top sellers / Fabric usage / Backlog+Purchasing JSX | `src/pages/dashboard-b/index.tsx:2062 / 2059 / 2427` | |
| Department Revenue JSX | `src/pages/dashboard-b/index.tsx:1702` | `DeptRevenueCard` (`DeptRevenueCard.tsx`): per-department revenue table + line chart, All/Bedframe/Sofa; with `embed.day` the table shows that day (`dayBucketIndex`) and a chart click calls `onPickDay` |
| `DeptRevenueChart` | `src/pages/dashboard-b/charts.tsx:249` | One line per production department; `markDay` draws the picked day, `onPickDay` makes points clickable |
| `app.get("/revenue-split")` | `src/api/routes/dashboard-overview.ts:2355` | Department revenue + Revenue chart Bedframe/Sofa split, computed fresh (not snapshotted/frozen); rules in `src/api/lib/dept-revenue.ts` |
| Phone Department Revenue | `src/pages/m/screens/Home.tsx:1251` | /m Home: one bar per department + `CatPills` toggle (also on the phone Revenue chart) |
| `RevenueChart` / `CustomerPieChart` | `src/pages/dashboard-b/charts.tsx:60 / 149` | Lazy recharts wrappers (~357 KB chunk) |
| `app.get("/")` (overview) | `src/api/routes/dashboard-overview.ts:75` | Single ~2000-line aggregate handler |
| `captureTodayState` | `src/api/routes/dashboard-overview.ts:111` | Extract + upsert today's state snapshot |
| `readSnapshot` / `writeSnapshot` / `isSnapshotFresh` | `src/api/lib/dashboard-snapshot.ts:100 / 211 / 187` | Read-through snapshot (Layer 1) |
| `getMaxSourceUpdatedAt` | `src/api/lib/dashboard-snapshot.ts:155` | Data-change probe for freshness |
| `writeStateSnapshot` / `readStateSnapshotForMonth` | `src/api/lib/dashboard-state-snapshot.ts:63 / 108` | Daily state UPSERT + past-month read |
| rebuild cron endpoint | `src/api/worker.ts:395` | Nightly force-invalidate all snapshots |

## Gotchas
- **The merged Dashboard (2026-10-17) is `/dashboard-experimental`** (`pages/dashboards/dashboard-prototype.tsx`); the sidebar's single "Dashboard" entry opens it and `/dashboard` redirects there. Command Center cards are embedded by section (`CommandCenterSections.tsx`). Figures and their sources, audited 2026-10-17 (BUG-HISTORY "overstated overdue production and money owed"): overdue = past date AND still being made (all-stages-done listed apart); payables = `/api/accounting/ap-control` (net of advances), never a sum of unpaid PIs; costing materials = the P&L raw-materials window (`/api/accounting/cost-structure`), labour = the Labor Cost rule (`src/lib/labor-day-cost.ts`, unrounded until display); department output = progressive revenue (`/api/working-hour-entries/production-revenue`); non-production hours = all-department minus production-department clocked minutes. Service defect rate = cases logged ÷ units delivered (finished-goods units scanned DELIVERED; sofa per set = SO), by the product category of each case's affected products (`service-issue-stats.ts` `defectRates`, feed `service.shipped`).
- **`dashboard-b` IS the production dashboard.** The old `/dashboard` page was retired 2026-05-21; `/dashboard` lazy-loads `dashboard-b`, and `/dashboard-b` just redirects (`dashboard-routes.tsx:233`). There is no separate `dashboard` page.
- **The whole backend is ONE GET `/` handler** (~2000 lines, no sub-routes) — every dashboard number flows through it. It is **60s KV-cached on top of a data-change-aware snapshot**, so edits can take up to a minute to reflect live (bump the `v23` cache key or hit the rebuild cron to force a refresh).
- **Three-layer freshness, not just a cache.** Layer 1 = `dashboard_snapshot` (`built_from` vs `getMaxSourceUpdatedAt`); Layer 2 = 60s KV; Layer 3 = full compute. An admin script that UPDATEs a source table WITHOUT bumping its `updated_at` escapes Layer 1/2 — the nightly `rebuild-dashboard-snapshot` cron is the safety net. The snapshot path only runs for `period=all`; any month filter skips straight to KV + compute.
- **Never write a past-month state snapshot back as "today".** `captureTodayState` is guarded (`:137`, `:2243`) so only a live (`period=all`/current-month) payload is persisted; past-month reads override state widgets from stored history (`:1930`) and must not be re-captured.
- **KPI semantics are owner-pinned** (2026-06-12): Sales = confirmed-SO value; Invoices = Σ invoice totals by invoice date (excl. cancelled); Pending Delivery = consolidated made-but-not-shipped; Outstanding = point-in-time/live. Don't redefine these card sources.
- **Sales/Delivery value figures are intentionally NOT recomputed live** — they come from the snapshot/cache (see header comment top of `dashboard-overview.ts`). The page cross-checks the live `/api/sales-orders/stats` endpoint for the Order Pipeline, so those two can momentarily diverge by design.
- **Frontend fetches are staged** (`ovL`/`soL`/`pendingL`, `index.tsx:779`) so KPI numbers paint before heavy sections — don't collapse them into one fetch.
- **recharts is lazy-loaded** via `./charts.tsx` (~357 KB). Keep chart code there, not in `index.tsx`, or you regress first-paint.
- **Only snapshot freshness is test-covered** — `tests/snapshot-freshness.test.mjs` + `tests/snapshot-freshness-latestts.test.mjs`. The KPI math itself has no unit tests; verify live on prod.

- **Department lists come from one place** (2026-10-18): Department Backlog uses `DEPT_REVENUE_ORDER` (`src/api/lib/dept-revenue.ts`) — add a production department there, not to a local list, or it silently goes missing from the backlog (Foam Cutting / Fibre did).
- **Purchasing "Raw material stock"** is the P&L closing stock from the last stock take (`/api/accounting/cost-structure`), never the live system RM balance — that balance is unreliable until BOMs are complete (owner ruling 2026-10-17).
- **Defect rate counts bedframe + sofa only** — accessories are excluded from both cases and units (owner 2026-10-18).

- **Sales forecast** (2026-10-18, owner): target = sales keyed in **Forecast P&L** (`GET /api/accounting/forecast`, kv `forecast_pnl`, months[ym].salesSen; quarter/year = sum of keyed months); actual = **invoiced** by invoice date. No rolling-average fallback — an unkeyed month shows no target. Viewers without Accounting read see actuals only.

## Common tasks (mini-playbook)
- **Add a KPI/widget** → compute it inside the single `app.get("/")` (`dashboard-overview.ts:51`) and add it to the returned payload; type it in the `Overview` type (`index.tsx:58`); render via `KTile`/`SectionTitle` in `DashboardBPage`. Bump the cache key (`v25` since 2026-10-09) if the payload shape changes, so stale snapshots don't serve the old shape.
- **Add a chart** → put the recharts component in `charts.tsx` and lazy-import it (keep recharts out of `index.tsx`); pass computed data + colors as props (parent owns the numbers).
- **Change a point-in-time (state) metric** → update the `DashboardStateMetrics` shape (`dashboard-state-snapshot.ts:37`), the `captureTodayState` extractor (`dashboard-overview.ts:88`), AND the past-month override (`:1930`) so history and live stay consistent.
- **Force a live refresh** → hit `POST /api/internal/rebuild-dashboard-snapshot` (`worker.ts:387`, CRON_SECRET) or bump the `v23` KV key; remember the 60s KV TTL.
- **Debug stale numbers** → check freshness order: `dashboard_snapshot.built_from` vs `getMaxSourceUpdatedAt` (`dashboard-snapshot.ts:155`), then the 60s KV key, then whether a source `updated_at` was bumped on the last write.

## Related modules
[[sales]] [[production]] [[delivery]] [[procurement]] [[accounting]] [[inventory]]
