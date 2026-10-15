# HK-0037 Phase 1 map — RM UOM configurable

Skills run: understand-explain (graph absent; read source directly), tech-debt, grill (self-answered below).

## (a) Already met
- UOM picked on create/edit; one unit list plus owner-added units [code: src/lib/material-variants.ts:42-60].
- Server rejects a unit not in the list on POST and PUT; UOM change locked while stock, batches or open PO lines exist [code: src/api/routes/raw-materials.ts:327-331, 483-505] [code: src/api/lib/lock-helpers.ts:324-345].
- Fabric-specific MTR/ROLL options were REMOVED by owner 2026-10-07 in favour of one list [code: src/lib/material-variants.ts:36-40] [code: docs/WORK-TRACKER.md:1358-1370]. So "Fabric: MTR/ROLL, others their own" is not a per-category list any more.
- Tests [code: tests/rm-uom-options.test.mjs].

## (b) Not met — where baseUOM is consumed
- PO lines: FE copies rm.baseUOM into line.unit at create [code: src/pages/procurement/create.tsx:256, 363]; API stores it, defaults "pcs" [code: src/api/routes/purchase-orders.ts:519, 573]. Not re-validated against the RM, so a stale or default "pcs" line is possible. NOTE: the owner ruling said "PO carry no unit", yet a unit column exists [my guess: ruling meant no conversion].
- GRN: line type has `unit` [code: src/api/routes/grn.ts:297] but GRN page shows PO line unit only [code: src/pages/procurement/grn/create.tsx:1151]; no check against RM baseUOM.
- Second RM create path with no allowed-UOM check, hardcoded default "PCS" [code: src/api/routes/inventory.ts:469-494].
- Stock adjust: reads `balanceQtyUom`, fallback hardcoded "ea" [code: src/pages/inventory/adjustments.tsx:306]; the only occurrence of that field is the FE type, so the API appears never to send it [code: grep src, adjustments.tsx:65] — every RM shows "ea".
- Stock breakdown uses baseUOM correctly [code: src/api/routes/stock-breakdown.ts:471].
- BOM/production: no unit field at all; qtyPerUnit is a bare number read in baseUOM [code: src/api/lib/lock-helpers.ts:324-330]. BOM unit hardcoded nowhere found, consumed implicitly.
- Valuation / low-stock: minStock and cost are bare numbers per baseUOM, no unit shown or converted [code: src/api/routes/inventory.ts:69-72, 139].

## (c) Triage
Small and safe:
1. Add the allowed-UOM check to inventory.ts POST (reuse isUomAllowed/loadUomConfig).
2. Return baseUOM as `balanceQtyUom` (or read `unit`) so adjustments stop showing "ea".
3. PO create/update: take unit from the RM server-side, not "pcs" default.
4. GRN: display RM baseUOM next to received qty.

Needs owner decision:
- Restoring per-category lists (Fabric: MTR/ROLL) — reverses the 2026-10-07 ruling.
- Purchase in ROLL, stock in MTR (conversion) — ruled out of DEV-20, would be a new ticket.
- BOM / production usage unit display or conversion.

## (d) Smallest PR
Items 1-3 above plus unit shown on GRN line (4), one test file extending rm-uom-options. No schema change, no conversion, no per-category lists. [my guess: ~60 lines]

## Assumptions (grill, self-answered)
- Q: Is HK-0037 a duplicate of DEV-20? A: mostly; remaining gap is propagation, not selection [my guess].
- Q: Does the API send balanceQtyUom? A: no hit in src outside the FE type [code: adjustments.tsx:65]; not verified at runtime.
- Prod data and DB columns were not inspected.
