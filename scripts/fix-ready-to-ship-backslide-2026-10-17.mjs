// ---------------------------------------------------------------------------
// fix-ready-to-ship-backslide-2026-10-17.mjs
//
// BUG-2026-10-17: production completion pulled shipped / invoiced SOs back to
// READY_TO_SHIP (fixed in production-orders/_helpers.ts by the same PR — DEPLOY
// THAT FIRST, or the next job-card scan pulls these straight back).
//
// Puts every READY_TO_SHIP sales order onto the status its OWN documents prove,
// the same statuses the normal flow would have given it:
//   • has a non-cancelled invoice, every one PAID   → CLOSED    (invoices.ts rule)
//   • has a non-cancelled invoice                   → INVOICED  (payments.ts rule)
//   • every finished-goods unit DELIVERED           → DELIVERED
//   • every unit out (LOADED or DELIVERED)          → SHIPPED
//   • anything else (goods still in the warehouse,
//     part shipped, no units)                       → left at READY_TO_SHIP
// Each change writes an so_status_changes audit row. Status only — no stock,
// no GL, no money moves. A restore file is written before any update.
//
//   export HOOKKA_PROD_DB_URL='…'   (entered by you in your own terminal)
//   node scripts/fix-ready-to-ship-backslide-2026-10-17.mjs            # dry run
//   node scripts/fix-ready-to-ship-backslide-2026-10-17.mjs --execute  # write
// Idempotent: a second run finds nothing left to move.
// ---------------------------------------------------------------------------
import postgres from "postgres";
import fs from "node:fs";
import { prodUrl } from "./_db.mjs";

const EXEC = process.argv.includes("--execute");
const sql = postgres(prodUrl(), { ssl: "require", max: 1, idle_timeout: 20 });
const rm = (sen) => `RM ${(Number(sen || 0) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const sos = await sql`
  SELECT id, company_so_id, total_sen, company_so_date
    FROM sales_orders
   WHERE status = 'READY_TO_SHIP'`;
const ids = sos.map((s) => s.id);

// Invoices linked directly, or through their delivery order.
const invs = ids.length ? await sql`
  SELECT COALESCE(i.sales_order_id, d.sales_order_id) AS so_id, i.status
    FROM invoices i
    LEFT JOIN delivery_orders d ON d.id = i.delivery_order_id
   WHERE i.status <> 'CANCELLED'
     AND COALESCE(i.sales_order_id, d.sales_order_id) IN ${sql(ids)}` : [];
const units = ids.length ? await sql`
  SELECT so_id, status FROM fg_units WHERE so_id IN ${sql(ids)}` : [];

const group = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(r.so_id, [...(m.get(r.so_id) ?? []), r.status]);
  return m;
};
const invBySo = group(invs);
const unitBySo = group(units);

const plan = [];
const kept = {};
for (const so of sos) {
  const iv = invBySo.get(so.id) ?? [];
  const us = unitBySo.get(so.id) ?? [];
  let to = null;
  let why = "";
  if (iv.length) {
    to = iv.every((s) => s === "PAID") ? "CLOSED" : "INVOICED";
    why = `${iv.length} invoice(s): ${[...new Set(iv)].join("/")}`;
  } else if (us.length && us.every((s) => s === "DELIVERED")) {
    to = "DELIVERED";
    why = `all ${us.length} finished-goods units delivered`;
  } else if (us.length && us.every((s) => s === "DELIVERED" || s === "LOADED")) {
    to = "SHIPPED";
    why = `all ${us.length} units out (loaded / delivered)`;
  } else {
    const k = !us.length ? "no finished-goods units" : us.some((s) => s === "DELIVERED" || s === "LOADED") ? "part shipped" : "goods still in the warehouse";
    kept[k] = (kept[k] ?? 0) + 1;
    continue;
  }
  plan.push({ id: so.id, no: so.company_so_id, sen: Number(so.total_sen) || 0, to, why });
}

const by = {};
for (const p of plan) {
  by[p.to] ??= { n: 0, sen: 0 };
  by[p.to].n += 1;
  by[p.to].sen += p.sen;
}
console.log(`${EXEC ? "EXECUTE" : "DRY RUN"} — ${sos.length} SOs at READY_TO_SHIP`);
for (const [to, v] of Object.entries(by)) console.log(`  → ${to.padEnd(9)} ${String(v.n).padStart(4)} SOs  ${rm(v.sen)}`);
for (const [k, n] of Object.entries(kept)) console.log(`  stays READY_TO_SHIP (${k}): ${n}`);
for (const p of plan.slice(0, 15)) console.log(`    ${p.no}  → ${p.to}  (${p.why})`);
if (!EXEC) { await sql.end(); process.exit(0); }

const restore = `scripts/_restore-ready-to-ship-backslide-2026-10-17.json`;
fs.writeFileSync(restore, JSON.stringify(plan.map((p) => ({ id: p.id, no: p.no, before: "READY_TO_SHIP", after: p.to }))));
console.log(`restore file: ${restore}`);

const now = new Date().toISOString();
await sql.begin(async (tx) => {
  for (const p of plan) {
    // Re-checked inside the write: only an SO still at READY_TO_SHIP moves.
    const r = await tx`UPDATE sales_orders SET status = ${p.to}, updated_at = ${now} WHERE id = ${p.id} AND status = 'READY_TO_SHIP' RETURNING id`;
    if (!r.length) continue;
    await tx`
      INSERT INTO so_status_changes (id, so_id, from_status, to_status, changed_by, timestamp, notes, auto_actions)
      VALUES (${`ssc-fix1017-${p.id.slice(-10)}`}, ${p.id}, 'READY_TO_SHIP', ${p.to}, 'System (data fix 2026-10-17)', ${now},
              ${`Status corrected from its own documents: ${p.why} (BUG-2026-10-17)`}, ${JSON.stringify([])})
      ON CONFLICT (id) DO NOTHING`;
  }
});

// Read-back.
let bad = 0;
for (const p of plan) {
  const [r] = await sql`SELECT status FROM sales_orders WHERE id = ${p.id}`;
  if (r?.status !== p.to) bad++;
}
const [left] = await sql`SELECT COUNT(*)::int AS n FROM sales_orders WHERE status = 'READY_TO_SHIP'`;
console.log(`moved ${plan.length - bad} / ${plan.length} — read-back mismatches: ${bad} — still READY_TO_SHIP: ${left.n}`);
await sql.end();
