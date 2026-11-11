const PIECES_PER_LINE =
  "CASE WHEN itemCategory = 'SOFA' OR COALESCE(quantity, 0) < 1 THEN 1 ELSE quantity END";

function sourceLineJoins(itemTable: string, orderColumn: string, lineAlias: string): string {
  return `
    LEFT JOIN (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY ${orderColumn}, productCode ORDER BY lineNo, id) AS piece_rank
        FROM production_orders
       WHERE ${orderColumn} IS NOT NULL AND status <> 'CANCELLED'
    ) ${lineAlias}_piece ON ${lineAlias}_piece.id = po.id
    LEFT JOIN (
      SELECT ${orderColumn}, productCode, unitPriceSen, piece_count,
             SUM(piece_count) OVER (PARTITION BY ${orderColumn}, productCode
                                    ORDER BY lineNo, id ROWS UNBOUNDED PRECEDING) AS piece_to
        FROM (SELECT ${orderColumn}, productCode, unitPriceSen, lineNo, id,
                     ${PIECES_PER_LINE} AS piece_count
                FROM ${itemTable}) ${lineAlias}_all
    ) ${lineAlias} ON ${lineAlias}.${orderColumn} = po.${orderColumn}
                  AND ${lineAlias}.productCode = po.productCode
                  AND ${lineAlias}_piece.piece_rank > ${lineAlias}.piece_to - ${lineAlias}.piece_count
                  AND ${lineAlias}_piece.piece_rank <= ${lineAlias}.piece_to`;
}

export const PO_SOURCE_LINE_JOINS: string =
  sourceLineJoins("sales_order_items", "salesOrderId", "so_line") +
  sourceLineJoins("consignment_order_items", "consignmentOrderId", "co_line");

export const PO_SOURCE_LINE_PRICES = "so_line.unitPriceSen, co_line.unitPriceSen";
