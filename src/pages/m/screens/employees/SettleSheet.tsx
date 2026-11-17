// SettleSheet — Labor Cost → "..." → Settle month (HK-0125). A confirm sheet with desktop's title / message / "Settle now", then a
// result sheet that reports the settlement and the payslip regeneration SEPARATELY. Rules and calls: settle-month.ts.
import { useRef, useState } from "react";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { Sheet } from "../../components";
import { M } from "../../theme";
import DecisionSheet from "./DecisionSheet";
import { SETTLE_CONFIRM_LABEL, SETTLE_TITLE, runSettle, settleConfirmMessage, type SettleOutcome, type StepState } from "./settle-month";

const TONE: Record<StepState, { bg: string; fg: string; label: string }> = {
  ok: { bg: "#E4F1E6", fg: "#2F6B3E", label: "Done" },
  locked: { bg: "#FAEFCB", fg: "#85600F", label: "Finalised" },
  failed: { bg: "#F5E9E7", fg: "#9A3A2D", label: "Failed" },
  skipped: { bg: "#F0ECE9", fg: "#4D4630", label: "Not run" },
};

export default function SettleSheet({ open, period, monthLabel, onClose }: { open: boolean; period: string; monthLabel: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false); // set synchronously: two taps in one tick must not start two settlements
  const [outcome, setOutcome] = useState<SettleOutcome | null>(null);

  async function go() {
    if (running.current) return; // one run at a time: a double tap must not settle twice
    running.current = true;
    setBusy(true);
    const result = await runSettle(period, monthLabel, (url, init) => fetch(url, init));
    // Payslips and docks changed on the server: drop the cached copies so the next read is fresh (as desktop does).
    invalidateCachePrefix("/api/payslips");
    invalidateCachePrefix("/api/payroll-hour-deductions");
    setOutcome(result);
    running.current = false;
    setBusy(false);
  }
  function close() {
    setOutcome(null);
    onClose();
  }

  if (outcome) {
    return (
      <Sheet open={open} onClose={close} title="Settle month">
        <div style={{ display: "grid", gap: 10 }}>
          {(
            [
              ["Settlement", outcome.settle],
              ["Payslip regeneration", outcome.regenerate],
            ] as const
          ).map(([k, step]) => (
            <div key={k} style={{ background: M.card, borderRadius: 14, padding: "12px 14px", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{k}</span>
                <span style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, background: TONE[step.state].bg, color: TONE[step.state].fg, fontSize: 11, fontWeight: 700 }}>{TONE[step.state].label}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: M.ink }}>{step.text}</div>
            </div>
          ))}
          <button type="button" onClick={close} style={{ height: 46, border: "none", borderRadius: 12, background: M.taupe, color: "#FFFFFF", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <DecisionSheet open={open} onClose={onClose} title={SETTLE_TITLE} confirmLabel={SETTLE_CONFIRM_LABEL} busy={busy} onConfirm={() => void go()}>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: M.ink }}>{settleConfirmMessage(monthLabel)}</div>
    </DecisionSheet>
  );
}
