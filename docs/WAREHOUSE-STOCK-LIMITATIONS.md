# Warehouse Stock In/Out — existing system limitations (for the backend team)

> **Last verified: 2026-10-26** against `src/api/routes/warehouse.ts`, `src/api/routes/public-rack-qr.ts`,
> `src/api/lib/packing-rack-write.ts`, `src/api/lib/role-policy.ts`, `migrations/0045_rbac.sql`,
> `src/pages/warehouse.tsx` (desktop). **Read-only code review. Nothing here was run against any database or
> API; every statement about production data or live role grants is UNMEASURED unless it says otherwise.**

## Why this document exists

The mobile Warehouse v3 redesign (`src/pages/m/screens/WarehouseScreen.tsx` + `screens/warehouse/`) is a
**UI-only release**. Its **Stock In/Out confirm button is disabled and calls no endpoint**. Making it work the
way desktop does would inherit the limitations below. They are properties of the **existing backend and desktop
workflow**, not of the mobile UI, and are recorded here so the backend team can decide them. The mobile work
deliberately does **not** work around any of them.

Mobile's scope is UI/UX only. These are not mobile bugs and mobile does not fix them.

## The desktop sequences (for reference)

| | Calls, in order (`src/pages/warehouse.tsx` `handleStockIn` / `handleStockOut`) |
|---|---|
| Stock In | `POST /api/warehouse` → `POST /api/warehouse/movements` → `PUT /api/production-orders/:id` `{rackingNumber, stockedIn:true}` |
| Stock Out | `POST /api/warehouse/movements` → `DELETE /api/warehouse/:id?itemName&itemNotes` (or `?productCode`) |

## L1 — Per-piece Stock Out is rejected by `POST /movements` (CONFIRMED in code, not run)

- `POST /api/warehouse/movements` returns 400 "Missing required fields" when `productCode` is empty
  (`!productCode`, `warehouse.ts` ~L576).
- Per-piece rack items are written with `productCode = ""` by the `/r/` scan flow
  (`public-rack-qr.ts` `buildRackStockInStatements`), and desktop sends `item.productCode || ""`.
- Result: desktop Stock Out on a per-piece item fails at step 1 (nothing is removed — it fails safely).
  The `/r/` scan writes its own movement rows with direct SQL, so it is not subject to the check.
- ASSUMPTION: this means desktop Stock Out is already unusable for per-piece items, or is rarely used because
  DO dispatch removes stock instead. Not checked against production.
- Needs a backend decision (e.g. accept an empty code when `productName` is present).

## L2 — Rack **id** is written where the rack **name** belongs (CONFIRMED in code)

- Desktop Stock In sends the rack **id** as the movement's `rackLabel` and as the order's `rackingNumber`.
  Rack ids for racks created with "Create Rack" are UUIDs (`crypto.randomUUID()`).
- Other writers store the rack **label**: step 1 of the same chain stamps `job_cards.rackingNumber = row.rack`;
  `applyPackingRack` mirrors the label onto the order; the `/r/` scan writes the label (a code comment there
  records that history used to show ids).
- Effect: `production_orders.rackingNumber` can hold a UUID, and old History rows can show an id instead of a
  rack name. The mobile History view maps `rackLocationId` back to the name for display only.
- UNMEASURED: how many production orders / movements in production already carry an id; the id format of racks
  that pre-date "Create Rack".
- ASSUMPTION: nothing reads `production_orders.rackingNumber` as an id.

## L3 — The chains are not atomic and not safely retryable (CONFIRMED in code)

- Each step is a separate request with no rollback. Step 1 can save and step 2 or 3 fail, leaving a rack item
  with no movement, or a movement with the order not marked stocked in. Desktop shows only a toast.
- A blind retry is unsafe: `POST /api/warehouse` appends a new rack item every time, so repeating step 1
  duplicates stock. (The step-3 PUT is idempotent.)
- No existing route does a PO-level stock-in atomically. The `/r/` stock-in is one `db.batch`, but it is
  per-piece, public (auth-bypassed) and does not set `stockedIn`, so it is not a substitute.
- Real fix is server-side: one endpoint that does the whole stock-in/out in a single transaction.

## L4 — Stock In needs a permission the Warehouse role does not seed (CONFIRMED in the seed; prod UNMEASURED)

Stock In requires `warehouse:create` **and** `production-orders:update`; Stock Out requires `warehouse:create`
and `warehouse:delete`.

| Role | Stock In | Stock Out | Source |
|---|---|---|---|
| SUPER_ADMIN, ADMIN | yes | yes | wildcard short-circuit in `rbac.ts` |
| OFFICE | yes | yes | code policy: everything except finance/forecast |
| WAREHOUSE | **no** (PO read-only) | yes | `0045_rbac.sql` seed |
| PRODUCTION | no (no warehouse grants) | no | seed |
| SALES, QA, R&D, HR | no | no | code policies (no `warehouse` grant) |

- The natural warehouse role would complete steps 1 and 2 and then get a **403 at step 3** — a partial
  failure (L3) built into the role setup.
- UNMEASURED: the live `role_permissions` table and any per-user overrides; the seed may have been changed
  after `0045`.
- Needs a product/RBAC decision: grant `production-orders:update` to WAREHOUSE, or move the `stockedIn` flip
  server-side.

## Also noted

- `GET /api/warehouse`, `/movements` and `/:id/details` have no `requirePermission`; only `/locate` is
  `warehouse:read` gated. A user without read can list racks but gets a 403 from piece search.
- `GET /movements` caps at the newest 500 rows, and its `to` filter is a UTC end-of-day.
- The Stock-Out reason is required by the desktop UI (button disabled without it) but the handler falls back to
  "Stock out".

## What the mobile release does about all of this

Nothing, by design. No workaround for `productCode`, rack ids, partial failures or permissions. The Stock
In/Out screens are the approved design with the confirm button disabled. A draft of the desktop port (with
mocked tests) exists outside the repo, was **not** committed, and should only be revived once the backend team
has decided L1–L4.
