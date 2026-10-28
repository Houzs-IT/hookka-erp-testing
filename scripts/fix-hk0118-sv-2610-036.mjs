// ---------------------------------------------------------------------------
// fix-hk0118-sv-2610-036.mjs
//
// HK-0118: SV-2610-036 (RX HOMICE, 4 x SERVICE CHARGE) went READY_TO_SHIP when
// its 4 POs completed (2026-10-27 07:21 UTC). DRAFT DO-2610-110 was raised and
// deleted again (08:40), and the job cards were un-completed (08:47-08:48), but
// the SO kept the DO number and READY_TO_SHIP. Siti confirmed 2026-10-28 the 4
// services are still ongoing.
//
// Clears sales_orders.hookka_delivery_order and moves the SO back to
// IN_PRODUCTION with a so_status_changes row. POs, job cards, fg_units and
// fg_batches are left as they are: the POs are already PENDING, and the
// completion cascade reuses the existing fg_units / fg_batches when the POs
// complete again (it short-circuits on existing units per PO).
//
// Refuses unless the SO still reads READY_TO_SHIP + DO-2610-110, no
// delivery_orders row carries DO-2610-110, and none of its POs is COMPLETED.
//
//   export HOOKKA_PROD_DB_URL='…'
//   node scripts/fix-hk0118-sv-2610-036.mjs            # dry run
//   node scripts/fix-hk0118-sv-2610-036.mjs --execute  # write
// Idempotent: a second run is refused on the status check.
// ---------------------------------------------------------------------------
import postgres from "postgres";
import { prodUrl } from "./_db.mjs";

const EXEC = process.argv.includes("--execute");
const SO_NO = "SV-2610-036";
const DO_NO = "DO-2610-110";

const sql = postgres(prodUrl(), { ssl: "require", max: 1, idle_timeout: 20 });

const [so] = await sql`
  SELECT id, company_so_id, status, hookka_delivery_order, updated_at, org_id
    FROM sales_orders WHERE company_so_id = ${SO_NO}`;
const liveDo = await sql`SELECT id, status FROM delivery_orders WHERE do_no = ${DO_NO}`;
const pos = so ? await sql`
  SELECT po_no, status, current_department FROM production_orders
   WHERE sales_order_id = ${so.id} ORDER BY po_no` : [];

const why = [];
if (!so) why.push(`${SO_NO} not found`);
else {
  if (so.status !== "READY_TO_SHIP") why.push(`status is ${so.status}`);
  if (so.hookka_delivery_order !== DO_NO) why.push(`DO stamp is '${so.hookka_delivery_order}'`);
}
if (liveDo.length) why.push(`${DO_NO} exists again (${liveDo.map((d) => d.status).join(", ")})`);
if (!pos.length) why.push("no production orders");
if (pos.some((p) => p.status === "COMPLETED")) why.push("a PO is COMPLETED again");

console.log(`${SO_NO}: status ${so?.status}, Delivery Order '${so?.hookka_delivery_order}', updated ${so?.updated_at}`);
for (const p of pos) console.log(`  ${p.po_no}  ${p.status}  ${p.current_department}`);
if (why.length) {
  console.log(`\nRefused: ${why.join("; ")}`);
  await sql.end();
  process.exit(1);
}
console.log(`\nPlan: Delivery Order '${DO_NO}' -> '' ; status READY_TO_SHIP -> IN_PRODUCTION ; + so_status_changes row`);

if (!EXEC) {
  console.log("\nDry run. Pass --execute to write.");
  await sql.end();
  process.exit(0);
}

const now = new Date().toISOString();
await sql.begin(async (tx) => {
  const moved = await tx`
    UPDATE sales_orders
       SET hookka_delivery_order = '', status = 'IN_PRODUCTION', updated_at = ${now}
     WHERE id = ${so.id} AND status = 'READY_TO_SHIP' AND hookka_delivery_order = ${DO_NO}`;
  if (moved.count !== 1) throw new Error(`expected 1 SO row, updated ${moved.count}`);
  await tx`
    INSERT INTO so_status_changes (id, so_id, from_status, to_status, changed_by, timestamp, notes, auto_actions, org_id)
    VALUES (${`ssc-hk0118-${so.id}`}, ${so.id}, 'READY_TO_SHIP', 'IN_PRODUCTION', 'System (data fix HK-0118)', ${now},
            ${`Deleted DRAFT ${DO_NO} left its number on the order; job cards were un-completed after the order went ready.`},
            ${JSON.stringify([`Cleared Delivery Order ${DO_NO}`])}, ${so.org_id})`;
});
console.log(`Updated ${SO_NO}.`);
await sql.end();
