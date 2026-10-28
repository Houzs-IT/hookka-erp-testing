// HK-0119 — close the overdue POs Siti (office) listed on 2026-10-28: "close
// all the PO, but MEDITEX and all PO-2610-.. can remain". Same effect as the
// Close PO button (BUG-2026-10-28-396): status -> CLOSED, reason appended to
// notes as [CLOSED YYYY-MM-DD: ...], plus an audit_events row per PO.
//
//   node scripts/fix-hk0119-close-overdue-pos.mjs            # dry run (prod read)
//   node scripts/fix-hk0119-close-overdue-pos.mjs --execute  # writes prod
import postgres from "postgres";
import { prodUrl } from "./_db.mjs";

const EXEC = process.argv.includes("--execute");
const PO_NOS = [
  "PO-2609-038", "PO-2609-033",
  "PO-2608-062", "PO-2608-050", "PO-2608-029", "PO-2608-026",
  "PO-2607-053", "PO-2607-039", "PO-2607-035", "PO-2607-022", "PO-2607-020", "PO-2607-007", "PO-2607-005",
  "PO-2606-014", "PO-000111",
];
const TODAY = new Date().toISOString().slice(0, 10);
const NOTE = `[CLOSED ${TODAY}: Closed at office request (Siti, HK-0119): balance not coming]`;

const sql = postgres(prodUrl(), { ssl: "require", max: 1, idle_timeout: 20 });

const pos = await sql`
  SELECT id, po_no, supplier_name, status, expected_date, notes, org_id
    FROM purchase_orders WHERE po_no IN ${sql(PO_NOS)} ORDER BY po_no DESC`;
const ordered = await sql`
  SELECT purchase_order_id AS po_id, SUM(quantity)::float AS qty
    FROM purchase_order_items WHERE purchase_order_id IN ${sql(pos.map((p) => p.id))}
   GROUP BY purchase_order_id`;
const invoiced = await sql`
  SELECT COALESCE(pii.po_id, pi.purchase_order_id) AS po_id, SUM(pii.qty)::float AS qty,
         string_agg(DISTINCT pi.pi_no || ' ' || pi.status, ', ') AS pis
    FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.pi_id
   WHERE COALESCE(pii.po_id, pi.purchase_order_id) IN ${sql(pos.map((p) => p.id))}
     AND pi.status NOT IN ('CANCELLED','DRAFT')
   GROUP BY 1`;
const oq = new Map(ordered.map((r) => [r.po_id, r.qty]));
const iq = new Map(invoiced.map((r) => [r.po_id, r]));

const why = [];
const missing = PO_NOS.filter((n) => !pos.some((p) => p.po_no === n));
if (missing.length) why.push(`not found: ${missing.join(", ")}`);
for (const p of pos) {
  const inv = iq.get(p.id);
  console.log(
    `${p.po_no.padEnd(12)} ${p.status.padEnd(16)} exp ${String(p.expected_date).slice(0, 10)}  ` +
      `ordered ${oq.get(p.id) ?? 0}, billed ${inv?.qty ?? 0}  ${p.supplier_name}  ${inv?.pis ?? "(no live PI)"}`,
  );
  if (!["CONFIRMED", "PARTIAL_RECEIVED"].includes(p.status)) why.push(`${p.po_no} is ${p.status}`);
  if (/MEDITEX/i.test(p.supplier_name ?? "")) why.push(`${p.po_no} is MEDITEX (Siti: keep)`);
  if (p.po_no.startsWith("PO-2610-")) why.push(`${p.po_no} is PO-2610 (Siti: keep)`);
}
if (why.length) {
  console.log(`\nRefused: ${why.join("; ")}`);
  await sql.end();
  process.exit(1);
}
console.log(`\nPlan: ${pos.length} POs -> CLOSED, notes += "${NOTE}"`);
if (!EXEC) {
  console.log("\nDry run. Pass --execute to write.");
  await sql.end();
  process.exit(0);
}

const now = new Date().toISOString();
await sql.begin(async (tx) => {
  for (const p of pos) {
    const notes = p.notes ? `${p.notes}\n${NOTE}` : NOTE;
    const moved = await tx`
      UPDATE purchase_orders SET status = 'CLOSED', notes = ${notes}, updated_at = ${now}
       WHERE id = ${p.id} AND status = ${p.status}`;
    if (moved.count !== 1) throw new Error(`${p.po_no}: expected 1 row, updated ${moved.count}`);
    await tx`
      INSERT INTO audit_events (id, actor_user_id, actor_user_name, actor_role, resource, resource_id, action,
                                before_json, after_json, source, ts, org_id)
      VALUES (${`aud-hk0119-${p.id}`}, '', 'System (data fix HK-0119)', 'SYSTEM', 'purchase-orders', ${p.id}, 'update',
              ${JSON.stringify({ id: p.id, poNo: p.po_no, status: p.status, notes: p.notes ?? "" })},
              ${JSON.stringify({ id: p.id, poNo: p.po_no, status: "CLOSED", notes })},
              'script', ${now}, ${p.org_id})`;
  }
});
console.log(`Closed ${pos.length} POs.`);
await sql.end();
