# Product costing in Products — plan and owner decisions

> **Last verified: 2026-11-22** against `src/api/routes/bom.ts`, `src/pages/bom.tsx`, `src/pages/products/index.tsx`, `src/api/routes/supplier-materials.ts`

Owner 2026-11-21/22: "每一次做新的 products，我要自己去算人工多少钱，跟 raw material 多少钱，我才能定价。我需要有一个地方在 products 那边可以去 maintain." Design canvas (private, owner's account): https://claude.ai/artifact/1SHe8xCavQNBcaEwERdKam

## Decisions (owner, with date)

| # | Decision | Date |
|---|---|---|
| D1 | Labour = minutes × RM 2,200 ÷ 26 d ÷ 9 h (RM 0.1567/min), same as today's `laborCostSenForMinutes`. Per-department rates maybe later. | 11-22 |
| D2 | Raw-material price = main supplier's latest price; no main supplier → latest price of any other supplier, labelled "not main". No price → shown red, never counted as RM 0. | 11-21/22 |
| D3 | Standard cost + today's price side by side: a saved standard (set by "Update standard to today", history kept); today's price shown with % change. | 11-22 |
| D4 | Products list gets Raw mat. / Total cost / Margin (P2) / Cost %. A product with no BOM materials shows "—" + "No materials", never a labour-only margin. | 11-21 |
| D5 | Calculator: price → margin, and margin → price; plus current Price 3/2/1 and each customer's price with its margin. Nothing saves a price. | 11-22 |
| D6 | Costing page is editable: WIP, process (department), minutes per piece, raw materials and qty. Same BOM data as BOM Builder (one source, both screens). | 11-22 |
| D7 | Copy from another model, any time, three separate parts: WIP processes / WIP time / raw materials. No "bring time?" prompt; just a "replaces" confirm per part. | 11-22 |
| D8 | Raw-material editor = the BOM one: scaling by size and "from order" (fabric / leg). | 11-22 |
| D9 | Fabric price tiers: Lv1 RM10–12, Lv2 12–16, Lv3 16–21, Lv4 21–25 (per metre). "From order" fabric is costed at the TOP of a tier; the costing page shows total cost per tier. | 11-22 |
| D10 | PDFs (reporting): Full Costing Report; Production Spec Sheet (no money); Labour Cost Report. WIP hierarchy indented like the BOM UI. | 11-22 |
| D11 | R&D Spec Form PDF: prints what the BOM has (minutes as "now", materials bold), blank lines for new; qty and unit (UOM) both kept. Filled form comes back by upload + OCR, reviewed, then saved. Manual key-in first. | 11-22 |
| D12 | Entry point: a Costing button beside View BOM in the expanded product row; list cost cell also opens it. | 11-22 |

## Phases (each = one PR, verified live, merged)

1. **Foundations** — persist BOM L1 materials (today dropped by `PUT /api/bom/templates/:id`, no column); fabric price tiers setting; `GET /api/products/:id/costing` (WIP minutes + labour, materials priced per D2, tiers per D9, prices + customer prices, standard cost); standard-cost table + "update standard".
2. **Costing page (view)** — `/products/:id/costing`: KPI tiles, cost by WIP (indented), price check + calculator, cost by department, tier selector; Costing button in the Products row.
3. **List columns** — batch costing summary endpoint + 4 columns + "No materials yet" filter.
4. **Edit + copy** — editing on the costing page through the BOM Builder data path; selective copy (processes / time / materials) with deep-copied ids.
5. **PDFs** — the three reports (print layout, hierarchy, pagination).
6. **R&D Spec Form** — PDF + key-in screen + record of who/when.
7. **R&D form scan (OCR)** — upload, extract, review, save.

## Known gaps found 2026-11-22 (read-only review) to fold in

- L1 materials lost on save (phase 1).
- No user recorded on price / BOM writes; prices overwritten without history; past price rows deletable.
- Several ACTIVE BOMs per product possible; consumers pick inconsistently (`po-cost-cascade.ts` LIMIT 1 without ORDER BY vs `products.ts` by effectiveFrom).
- BOM material lines may have no raw-material code (typed rows; FABRIC/LEG auto-detect by design → D9 tiers).
- BOM unit vs supplier price unit (MTR vs ROLL, PCS vs BOX) — supplier bindings have no unit field.
- Supplier price is one current value; history insert can fail silently; CNY prices exist.
- Product code rename orphans its BOM (`bom_templates.productCode`).
- New products are created from Inventory, default BOM lands as DRAFT.
