-- BUG-2026-11-11-426: read-only. Production Revenue per month, priced today
-- (piece number as line number) vs fixed (src/api/lib/po-source-line.ts).
-- Generated from the shared join, so it matches the code. One statement for
-- the Supabase SQL editor. orders must equal distinct_orders.
WITH per_po AS (
  SELECT production_order_id,
         MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED') AND completed_date IS NOT NULL
                  THEN completed_date END) AS unit_completed_at
    FROM job_cards
   WHERE department_code = 'UPHOLSTERY'
   GROUP BY production_order_id
  HAVING SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED') AND completed_date IS NOT NULL
                  THEN 1 ELSE 0 END) = COUNT(*)
), priced AS (
  SELECT po.id AS po_id,
         substr(per_po.unit_completed_at::text, 1, 7) AS ym,
         COALESCE(soi.unit_price_sen, coi.unit_price_sen, (SELECT COALESCE(p.base_price_sen, p.price1_sen)
                   FROM products p
                  WHERE p.code = po.product_code
                  ORDER BY p.base_price_sen DESC NULLS LAST, p.id
                  LIMIT 1), 0) * po.quantity AS today_sen,
         COALESCE(so_line.unit_price_sen, co_line.unit_price_sen, soi.unit_price_sen, coi.unit_price_sen, (SELECT COALESCE(p.base_price_sen, p.price1_sen)
                   FROM products p
                  WHERE p.code = po.product_code
                  ORDER BY p.base_price_sen DESC NULLS LAST, p.id
                  LIMIT 1), 0) * po.quantity AS fixed_sen
    FROM per_po
    JOIN production_orders po ON po.id = per_po.production_order_id
    LEFT JOIN sales_order_items soi
           ON soi.sales_order_id = po.sales_order_id AND soi.line_no = po.line_no
    LEFT JOIN consignment_order_items coi
           ON coi.consignment_order_id = po.consignment_order_id AND coi.line_no = po.line_no
    
    LEFT JOIN (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY sales_order_id, product_code ORDER BY line_no, id) AS piece_rank
        FROM production_orders
       WHERE sales_order_id IS NOT NULL AND status <> 'CANCELLED'
    ) so_line_piece ON so_line_piece.id = po.id
    LEFT JOIN (
      SELECT sales_order_id, product_code, unit_price_sen, piece_count,
             SUM(piece_count) OVER (PARTITION BY sales_order_id, product_code
                                    ORDER BY line_no, id ROWS UNBOUNDED PRECEDING) AS piece_to
        FROM (SELECT sales_order_id, product_code, unit_price_sen, line_no, id,
                     CASE WHEN item_category = 'SOFA' OR COALESCE(quantity, 0) < 1 THEN 1 ELSE quantity END AS piece_count
                FROM sales_order_items) so_line_all
    ) so_line ON so_line.sales_order_id = po.sales_order_id
                  AND so_line.product_code = po.product_code
                  AND so_line_piece.piece_rank > so_line.piece_to - so_line.piece_count
                  AND so_line_piece.piece_rank <= so_line.piece_to
    LEFT JOIN (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY consignment_order_id, product_code ORDER BY line_no, id) AS piece_rank
        FROM production_orders
       WHERE consignment_order_id IS NOT NULL AND status <> 'CANCELLED'
    ) co_line_piece ON co_line_piece.id = po.id
    LEFT JOIN (
      SELECT consignment_order_id, product_code, unit_price_sen, piece_count,
             SUM(piece_count) OVER (PARTITION BY consignment_order_id, product_code
                                    ORDER BY line_no, id ROWS UNBOUNDED PRECEDING) AS piece_to
        FROM (SELECT consignment_order_id, product_code, unit_price_sen, line_no, id,
                     CASE WHEN item_category = 'SOFA' OR COALESCE(quantity, 0) < 1 THEN 1 ELSE quantity END AS piece_count
                FROM consignment_order_items) co_line_all
    ) co_line ON co_line.consignment_order_id = po.consignment_order_id
                  AND co_line.product_code = po.product_code
                  AND co_line_piece.piece_rank > co_line.piece_to - co_line.piece_count
                  AND co_line_piece.piece_rank <= co_line.piece_to
   WHERE po.item_category IN ('SOFA','BEDFRAME','ACCESSORY')
     AND per_po.unit_completed_at >= '2026-01-01'
)
SELECT ym,
       COUNT(*) AS orders,
       COUNT(DISTINCT po_id) AS distinct_orders,
       ROUND(SUM(today_sen) / 100.0, 2) AS today_rm,
       ROUND(SUM(fixed_sen) / 100.0, 2) AS fixed_rm,
       ROUND(SUM(fixed_sen - today_sen) / 100.0, 2) AS difference_rm,
       SUM(CASE WHEN fixed_sen <> today_sen THEN 1 ELSE 0 END) AS orders_repriced,
       SUM(CASE WHEN today_sen = 0 THEN 1 ELSE 0 END) AS rm0_today,
       SUM(CASE WHEN fixed_sen = 0 THEN 1 ELSE 0 END) AS rm0_fixed
  FROM priced
 GROUP BY ym
 ORDER BY ym;
