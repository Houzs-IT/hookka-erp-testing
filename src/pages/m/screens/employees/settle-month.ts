// settle-month.ts — Labor Cost → "..." → Settle month (HK-0125). Desktop's "Settle month" button (employees.tsx, LaborCostTab
// `handleSettleFromPunches`), on the phone. It WRITES, so every rule is desktop's:
//   WHEN     only for ONE full, finished calendar month with NO category filter and with stored payslips (desktop `showReconciliation`)
//   WHO      the server gates settle-period on payslips:update and the regenerate on payslips:create (payroll-hour-deductions.ts,
//            payslips.ts), so the item is offered only when BOTH are held — a settle that cannot be followed by its regenerate would
//            leave docks that are not in the payslips
//   CONFIRM  desktop's title, message and "Settle now"
//   CALLS    POST /api/payroll-hour-deductions/settle-period { period }, then ONE POST /api/payslips { period, regenerate: true }
// Owner 2026-11-17: the settlement result and the payslip-regeneration result are reported SEPARATELY (desktop reports only the first).
// Two small differences from desktop, both on purpose: the regenerate is not sent when the month was already finalised (nothing was
// changed, so there is nothing to regenerate), and a failed regenerate is reported instead of ignored. Pure: `fetchFn` is injected.
import { payrollEligible, type DlCategory } from "./department-labor-model";

export const SETTLE_TITLE = "Auto-settle this month?";
export const SETTLE_CONFIRM_LABEL = "Settle now";

export const settleConfirmMessage = (monthLabel: string): string =>
  `Apply the shift rules (≥9h, late past grace, OT from 30 min past 18:00) to every punch AND auto-dock under-logged (To-fill) days in ${monthLabel}, then regenerate payslips? Every under-settled day docks its shortfall at the ÷26 hourly rate — no manual pick. Your own MANUAL Keep-pay / Deduct decisions are never overridden, and an already-approved month is not touched.`;

/** Is the item offered? */
export function settleAvailable(input: { range: { from: string; to: string }; category: DlCategory; today: string; hasPayslips: boolean; canUpdate: boolean; canCreate: boolean }): boolean {
  return input.hasPayslips && input.canUpdate && input.canCreate && payrollEligible(input.range, input.category, input.today);
}

export type SettleData = {
  applied: number;
  "no-shortfall": number;
  "manual-exists": number;
  "punch-source": number;
  "logged-source": number;
  dockedHours: number;
  periodLocked: boolean;
};

export type StepState = "ok" | "locked" | "failed" | "skipped";
export type Step = { state: StepState; text: string };
export type SettleOutcome = { settle: Step; regenerate: Step };

/** Desktop's result line (the locked case names the desktop Payroll tab, since the phone cannot withdraw an approval). */
export function settleText(d: SettleData): string {
  return d.periodLocked
    ? "Month already finalised — nothing changed. Withdraw the approval on the desktop Payroll tab first to re-settle."
    : `${d.applied} day(s) auto-docked (${d.dockedHours}h — ${d["punch-source"]} from punches, ${d["logged-source"]} from under-logged hours), ${d["no-shortfall"]} full day(s), ${d["manual-exists"]} left on your manual pick.`;
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
const JSON_POST = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function runSettle(period: string, monthLabel: string, fetchFn: FetchFn): Promise<SettleOutcome> {
  let settle: Step;
  let locked = false;
  try {
    const r = await fetchFn("/api/payroll-hour-deductions/settle-period", JSON_POST({ period }));
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: SettleData; error?: string };
    if (!r.ok || !j.success) throw new Error(j.error || `settle ${r.status}`);
    locked = !!j.data?.periodLocked;
    settle = j.data ? { state: locked ? "locked" : "ok", text: settleText(j.data) } : { state: "ok", text: "Settled." };
  } catch {
    return { settle: { state: "failed", text: "Could not settle — please try again." }, regenerate: { state: "skipped", text: "Not run, because the settlement did not complete." } };
  }
  if (locked) return { settle, regenerate: { state: "skipped", text: "Not run: the month is finalised, so nothing changed." } };
  try {
    const r = await fetchFn("/api/payslips", JSON_POST({ period, regenerate: true }));
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || j.success === false) throw new Error(j.error || `regenerate ${r.status}`);
    return { settle, regenerate: { state: "ok", text: `Payslips for ${monthLabel} regenerated.` } };
  } catch {
    return { settle, regenerate: { state: "failed", text: "Payslips were NOT regenerated, so the docks are not in pay yet. Run Regenerate on the desktop Payroll tab." } };
  }
}
