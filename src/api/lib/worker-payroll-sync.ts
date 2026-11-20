// ---------------------------------------------------------------------------
// worker-payroll-sync.ts — onboarding / offboarding reach payroll on their own
// (owner 2026-11-21: 「create 了 new joiner 该有的东西全部都要有」 — a new joiner
// was missing from November and December because those months' payslips were
// generated before he was created, and nothing ever added him).
//
// Called after a worker is created, their join date changes, they resign / are
// set inactive (with a last day), or they come back to ACTIVE. It only ever
// touches THIS worker's DRAFT payslips, from `fromPeriod` on, and only in
// months whose payroll has already been generated (a month not generated yet
// picks them up on its own run):
//   - employed in the month, no payslip   → add one (same code as a full run);
//   - employed in the month, `recompute`  → replace their draft (e.g. the
//     resign month, so the last-day proration applies);
//   - not employed in the month           → delete their draft.
// Approved payslips are never touched — a month that is signed off stays as
// signed off, and the result lists it under `skipped`.
// ---------------------------------------------------------------------------
import type { Context } from "hono";
import type { Env } from "../worker";
import { generatePayslipsForPeriod } from "../routes/payslips";
import { employedDuring, periodEnd } from "../../lib/employment";

export type WorkerPayrollSyncResult = { added: string[]; recomputed: string[]; removed: string[]; skipped: string[] };

export async function syncWorkerPayroll(
  c: Context<Env>,
  workerId: string,
  opts: { fromPeriod: string; recomputePeriod?: string | null },
): Promise<WorkerPayrollSyncResult> {
  const out: WorkerPayrollSyncResult = { added: [], recomputed: [], removed: [], skipped: [] };
  const db = c.var.DB;
  try {
    const w = await db
      .prepare(`SELECT id AS "id", empNo AS "empNo", status AS "status", joinDate AS "joinDate", resignedAt AS "resignedAt" FROM workers WHERE id = ?`)
      .bind(workerId)
      .first<{ id: string; empNo: string | null; status: string | null; joinDate: string | null; resignedAt: string | null }>();
    if (!w) return out;
    const gen = await db
      .prepare(`SELECT DISTINCT period AS "period" FROM payslips WHERE period >= ? ORDER BY period`)
      .bind(opts.fromPeriod)
      .all<{ period: string }>();
    for (const { period } of gen.results ?? []) {
      if (!/^\d{4}-\d{2}$/.test(period)) continue;
      const mine = await db
        .prepare(`SELECT id AS "id", status AS "status" FROM payslips WHERE period = ? AND employeeId = ?`)
        .bind(period, workerId)
        .all<{ id: string; status: string }>();
      const rows = mine.results ?? [];
      const approved = rows.some((r) => r.status !== "DRAFT");
      const employed = employedDuring(w, `${period}-01`, periodEnd(period));
      if (approved) {
        if (!employed || period === opts.recomputePeriod) out.skipped.push(period);
        continue;
      }
      if (employed) {
        if (rows.length === 0 || period === opts.recomputePeriod) {
          const res = await generatePayslipsForPeriod(c, { period, onlyWorkerIds: [workerId] });
          if (res.ok) (rows.length === 0 ? out.added : out.recomputed).push(period);
          else out.skipped.push(period);
        }
      } else if (rows.length > 0) {
        await db.prepare(`DELETE FROM payslips WHERE period = ? AND employeeId = ? AND status = 'DRAFT'`).bind(period, workerId).run();
        out.removed.push(period);
      }
    }
  } catch (err) {
    console.error("[syncWorkerPayroll] failed", { workerId, err: err instanceof Error ? err.message : String(err) });
  }
  return out;
}
