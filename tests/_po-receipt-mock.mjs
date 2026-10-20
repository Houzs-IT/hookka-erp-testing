// ---------------------------------------------------------------------------
// _po-receipt-mock.mjs — shared pieces for the in-memory D1 mocks that drive
// the real grn.ts handlers (purchasing-convert-flow, purchase-edit-cascade).
//
// T-006 R2/R3 moved the PO counter and PO status into the GRN's own batch, as
// SQL the regex mocks did not understand:
//   • the guarded counter increment, which RAISES (a cast of a marker string,
//     as Postgres does) when the line would pass 110% of ordered;
//   • the clamped decrement;
//   • status updates / goods-in-transit deletes conditioned on EXISTS over the
//     PO's lines.
// `execPoReceiptSql` evaluates those against the mock's tables and returns
// true when it handled the statement. `runAtomic` gives the mock's batch the
// rollback a real transaction has, so a raise leaves nothing behind.
// ---------------------------------------------------------------------------

const num = (v) => Number(v) || 0;
const col = (row, name) => {
  if (row[name] !== undefined) return row[name];
  const snake = name.replace(/[A-Z]/g, (x) => "_" + x.toLowerCase());
  return row[snake];
};

function linesOf(tables, poId) {
  return tables.purchase_order_items.filter(
    (r) => String(col(r, "purchaseOrderId")) === String(poId),
  );
}

// Evaluate every `[NOT] EXISTS (SELECT 1 FROM purchase_order_items WHERE
// purchaseOrderId = ? [AND cond])` in a WHERE tail, for one PO.
function existsHold(tables, tail, poId) {
  const re = /(NOT )?EXISTS \(SELECT 1 FROM purchase_order_items WHERE purchaseOrderId = \?( AND .*?)?\)(?= AND |$)/g;
  const lines = linesOf(tables, poId);
  let m;
  while ((m = re.exec(tail))) {
    const cond = (m[2] ?? "").trim();
    let pred = () => true;
    if (/COALESCE\(receivedQty, 0\) < COALESCE\(quantity, 0\)/.test(cond)) {
      pred = (r) => num(col(r, "receivedQty")) < num(col(r, "quantity"));
    } else if (/receivedQty > 0/.test(cond)) {
      pred = (r) => num(col(r, "receivedQty")) > 0;
    } else if (cond) {
      throw new Error(`_po-receipt-mock: unknown EXISTS condition: ${cond}`);
    }
    const hit = lines.some(pred);
    if (m[1] ? hit : !hit) return false;
  }
  return true;
}

export function execPoReceiptSql(sql, binds, tables) {
  let m = sql.match(
    /^UPDATE purchase_order_items SET receivedQty = CASE WHEN receivedQty \+ \? <= quantity \* 1\.1 THEN receivedQty \+ \? ELSE CAST\('po_line_over_receipt:' \|\| id AS DOUBLE PRECISION\) END WHERE id = \?$/i,
  );
  if (m) {
    const [check, bump, id] = binds;
    const poi = tables.purchase_order_items.find((r) => String(r.id) === String(id));
    if (!poi) return true;
    const cur = num(col(poi, "receivedQty"));
    if (cur + num(check) > num(col(poi, "quantity")) * 1.1) {
      const err = new Error(
        `invalid input syntax for type double precision: "po_line_over_receipt:${id}"`,
      );
      err.code = "22P02";
      throw err;
    }
    poi.receivedQty = cur + num(bump);
    return true;
  }
  m = sql.match(
    /^UPDATE purchase_order_items SET receivedQty = CASE WHEN receivedQty > \? THEN receivedQty - \? ELSE 0 END WHERE id = \?$/i,
  );
  if (m) {
    const [q, , id] = binds;
    const poi = tables.purchase_order_items.find((r) => String(r.id) === String(id));
    if (poi) {
      const cur = num(col(poi, "receivedQty"));
      poi.receivedQty = cur > num(q) ? cur - num(q) : 0;
    }
    return true;
  }
  m = sql.match(/^UPDATE purchase_orders SET (.+?) WHERE id = \?((?: AND .*)?EXISTS.*)$/i);
  if (m) {
    const set = m[1];
    const nSet = (set.match(/\?/g) || []).length;
    const id = binds[nSet];
    const po = tables.purchase_orders.find((r) => String(r.id) === String(id));
    if (!po) return true;
    const statusIn = m[2].match(/status IN \(([^)]*)\)/);
    if (statusIn && !statusIn[1].includes(`'${po.status}'`)) return true;
    if (!existsHold(tables, m[2], id)) return true;
    let bi = 0;
    for (const part of set.split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim());
      if (v === "?") po[k] = binds[bi++];
      else if (/^NULL$/i.test(v)) po[k] = null;
      else po[k] = v.replace(/^'|'$/g, "");
    }
    return true;
  }
  m = sql.match(/^DELETE FROM goods_in_transit WHERE poId = \?( AND .*EXISTS.*)$/i);
  if (m) {
    const poId = binds[0];
    if (existsHold(tables, m[1], poId)) {
      tables.goods_in_transit = tables.goods_in_transit.filter(
        (r) => String(col(r, "poId")) !== String(poId),
      );
    }
    return true;
  }
  return false;
}

// A batch is one transaction: a statement that throws rolls back them all.
export async function runAtomic(tables, stmts) {
  const snapshot = structuredClone(tables);
  try {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  } catch (e) {
    for (const k of Object.keys(snapshot)) tables[k] = snapshot[k];
    throw e;
  }
}
