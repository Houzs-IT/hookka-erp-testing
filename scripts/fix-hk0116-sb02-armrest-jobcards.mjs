// ---------------------------------------------------------------------------
// fix-hk0116-sb02-armrest-jobcards.mjs
//
// HK-0116 / BUG-2026-10-27-394: five SB02 (Sandback) production orders opened
// 12-14 Oct were exploded from an earlier SB02 BOM typed SOFA_ARMREST with code
// "A01 {FABRIC}" (A01 is the armrest product). Their Fab Sew sticker prints WIP
// "A01 <fabric>" and ARMREST. SB02's BOM is SANDBACK / "{MODEL} -Sandback" now,
// and POs opened from 19 Oct carry that.
//
// Rewrites those job cards IN PLACE to what today's BOM produces (copied from
// SO-2610-361-07, exploded 2026-10-21): wip_type / wip_code / wip_label /
// wip_key / branch_key, matched one-to-one by department. Job card ids, status,
// due dates, minutes and PICs are untouched. Bumps updated_at so the dept-sheet
// snapshot rebuilds; the KV list body expires within 5 minutes.
//
// Refuses a PO unless every job card is WAITING and its component cards are
// exactly the seven departments below, still typed SOFA_ARMREST / "A01 ...".
// A restore file is written before any update.
//
//   export HOOKKA_PROD_DB_URL='…'   (entered by you in your own terminal)
//   node scripts/fix-hk0116-sb02-armrest-jobcards.mjs            # dry run
//   node scripts/fix-hk0116-sb02-armrest-jobcards.mjs --execute  # write
// Idempotent: a second run finds nothing typed SOFA_ARMREST left.
// ---------------------------------------------------------------------------
import postgres from "postgres";
import fs from "node:fs";
import { prodUrl } from "./_db.mjs";

const EXEC = process.argv.includes("--execute");
const PO_NOS = ["SO-2610-194-08", "SO-2610-194-09", "SO-2610-194-10", "SO-2610-252-04", "SO-2610-252-05"];
const WIP_KEY = "SB02::0::SANDBACK::{MODEL} -Sandback";
const FOAM_BRANCH = "{MODEL} -Sandback (FOAM)";
const TARGET = {
  FAB_SEW: { code: "SB02 -Sandback", branch: "{MODEL} -Sandback" },
  WOOD_CUT: { code: "SB02 -Sandback (WC)", branch: FOAM_BRANCH },
  FOAM_CUTTING: { code: "SB02 -Sandback (FOAMCUT)", branch: FOAM_BRANCH },
  FOAM: { code: "SB02 -Sandback (FOAM)", branch: FOAM_BRANCH },
  FRAMING: { code: "SB02 -Sandback (Frame)", branch: FOAM_BRANCH },
  WEBBING: { code: "SB02 -Sandback (Webbing)", branch: FOAM_BRANCH },
  UPHOLSTERY: { code: "SB02 -Sandback", branch: "" },
};

const sql = postgres(prodUrl(), { ssl: "require", max: 1, idle_timeout: 20 });

const pos = await sql`
  SELECT id, po_no, product_code FROM production_orders WHERE po_no IN ${sql(PO_NOS)}`;
const jcs = pos.length ? await sql`
  SELECT id, production_order_id, department_code, status, wip_type, wip_code, wip_label, wip_key, branch_key
    FROM job_cards WHERE production_order_id IN ${sql(pos.map((p) => p.id))}` : [];

const plan = [];
const refused = [];
for (const no of PO_NOS) {
  const po = pos.find((p) => p.po_no === no);
  if (!po) { refused.push(`${no}: not found`); continue; }
  const cards = jcs.filter((j) => j.production_order_id === po.id);
  const why = [];
  if (po.product_code !== "SB02") why.push(`product ${po.product_code}`);
  const notWaiting = cards.filter((j) => j.status !== "WAITING");
  if (notWaiting.length) why.push(`not WAITING: ${notWaiting.map((j) => `${j.department_code}=${j.status}`).join(", ")}`);
  const comp = cards.filter((j) => TARGET[j.department_code]);
  const depts = comp.map((j) => j.department_code).sort().join(",");
  if (depts !== Object.keys(TARGET).sort().join(",")) why.push(`component depts ${depts || "none"}`);
  if (comp.some((j) => j.wip_type !== "SOFA_ARMREST" || !String(j.wip_code).startsWith("A01"))) {
    why.push("component cards are not SOFA_ARMREST / A01 (already fixed?)");
  }
  const fc = cards.filter((j) => j.department_code === "FAB_CUT");
  if (fc.length !== 1) why.push(`${fc.length} FAB_CUT cards`);
  if (why.length) { refused.push(`${no}: ${why.join("; ")}`); continue; }

  for (const j of comp) {
    const t = TARGET[j.department_code];
    plan.push({
      po: no, id: j.id, dept: j.department_code,
      before: { wip_type: j.wip_type, wip_code: j.wip_code, wip_label: j.wip_label, wip_key: j.wip_key, branch_key: j.branch_key },
      after: { wip_type: "SANDBACK", wip_code: t.code, wip_label: t.code, wip_key: WIP_KEY, branch_key: t.branch },
    });
  }
  const f = fc[0];
  if (String(f.wip_code).startsWith("A01")) {
    plan.push({
      po: no, id: f.id, dept: "FAB_CUT",
      before: { wip_code: f.wip_code },
      after: { wip_code: "SB02 -Sandback (FC)" },
    });
  }
}

for (const p of plan) {
  console.log(`${p.po}  ${p.dept.padEnd(12)} ${p.before.wip_code}  ->  ${p.after.wip_code}` +
    (p.after.wip_type ? `   [${p.before.wip_type} -> ${p.after.wip_type}]` : ""));
}
console.log(`\n${plan.length} job card(s) to update across ${new Set(plan.map((p) => p.po)).size} PO(s).`);
if (refused.length) console.log(`Refused:\n  ${refused.join("\n  ")}`);

if (!EXEC) {
  console.log("\nDry run. Pass --execute to write.");
  await sql.end();
  process.exit(0);
}
if (!plan.length) { await sql.end(); process.exit(0); }

const restore = "scripts/_restore-hk0116-sb02-jobcards.json";
fs.writeFileSync(restore, JSON.stringify(plan.map((p) => ({ id: p.id, po: p.po, dept: p.dept, before: p.before })), null, 1));
console.log(`restore file: ${restore}`);

await sql.begin(async (tx) => {
  for (const p of plan) {
    const a = p.after;
    if (a.wip_type) {
      await tx`
        UPDATE job_cards
           SET wip_type = ${a.wip_type}, wip_code = ${a.wip_code}, wip_label = ${a.wip_label},
               wip_key = ${a.wip_key}, branch_key = ${a.branch_key}, updated_at = NOW()
         WHERE id = ${p.id} AND status = 'WAITING' AND wip_type = 'SOFA_ARMREST'`;
    } else {
      await tx`
        UPDATE job_cards SET wip_code = ${a.wip_code}, updated_at = NOW()
         WHERE id = ${p.id} AND status = 'WAITING'`;
    }
  }
});
console.log(`Updated ${plan.length} job card(s).`);
await sql.end();
