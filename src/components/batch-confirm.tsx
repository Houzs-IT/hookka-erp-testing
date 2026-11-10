// ---------------------------------------------------------------------------
// batch-confirm.tsx — the "Confirm selected" flow shared by the GRN and
// Purchase Invoice lists (review G11, owner-approved 2026-11-10).
//
// The page hands over the ticked rows; this hook keeps only the rows whose
// status allows a confirm, asks once (how many + the total), then confirms
// them ONE BY ONE through the same PUT the detail page's own button makes
// (src/lib/batch-confirm.ts). While it runs, `progress` reads
// "Confirming 3 of 12". At the end every refusal is listed with the server's
// reason; the successes stay confirmed.
// ---------------------------------------------------------------------------
import { useCallback, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import {
  batchProgressLabel,
  batchSummary,
  batchTotalSen,
  eligibleForConfirm,
  putStatusConfirmed,
  runSequentialBatch,
  type BatchResult,
} from "@/lib/batch-confirm";

export type BatchConfirmOptions<T> = {
  /** Singular noun for messages, e.g. "GRN", "invoice". */
  noun: string;
  /** What the confirm does, in one sentence, shown in the dialog. */
  effect: string;
  canConfirm: (row: T) => boolean;
  label: (row: T) => string;
  amountSen: (row: T) => number | null | undefined;
  /** The single-document confirm URL (PUT `{ status: "CONFIRMED" }`). */
  url: (row: T) => string;
  /** Called once after the run (refresh the list, clear the selection). */
  onFinished: (result: BatchResult) => void;
};

export function useBatchConfirm<T>(opts: BatchConfirmOptions<T>): {
  run: (rows: readonly T[]) => Promise<void>;
  busy: boolean;
  progress: string | null;
  resultDialog: ReactNode;
} {
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const { noun, effect, canConfirm, label, amountSen, url, onFinished } = opts;

  const run = useCallback(
    async (rows: readonly T[]) => {
      if (busy) return;
      const targets = eligibleForConfirm(rows, canConfirm);
      if (targets.length === 0) return;
      const n = targets.length;
      const skipped = rows.length - n;
      const plural = n === 1 ? noun : `${noun}s`;
      const ok = await confirm({
        title: `Confirm ${n} ${plural}?`,
        message:
          `${n} draft ${plural} totalling ${formatCurrency(batchTotalSen(targets, amountSen))}. ${effect}\n\n` +
          `They are confirmed one at a time. If one is refused, the rest still go ahead and you get the list of refusals at the end.` +
          (skipped > 0 ? `\n\n${skipped} selected row(s) are not drafts and are left out.` : ""),
        confirmLabel: `Confirm ${n}`,
      });
      if (!ok) return;
      setBusy(true);
      setProgress(batchProgressLabel(0, n));
      let res: BatchResult;
      try {
        res = await runSequentialBatch(
          targets,
          label,
          (row) => putStatusConfirmed(url(row)),
          (done, total) => setProgress(done < total ? batchProgressLabel(done, total) : null),
        );
      } finally {
        setBusy(false);
        setProgress(null);
      }
      onFinished(res);
      if (res.failed.length === 0) toast.success(batchSummary(res, noun));
      else setResult(res);
    },
    [busy, canConfirm, confirm, noun, effect, amountSen, label, url, onFinished, toast],
  );

  const resultDialog = result ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={() => setResult(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Batch confirm result"
        className="relative mx-4 w-full max-w-lg rounded-xl border border-[#E2DDD8] bg-white shadow-2xl"
      >
        <div className="p-5">
          <h3 className="text-base font-semibold text-[#1F1D1B]">{batchSummary(result, noun)}</h3>
          <p className="mt-1 text-sm text-[#4B5563]">
            The confirmed ones stay confirmed. These were refused and are still drafts:
          </p>
          <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {result.failed.map((f, i) => (
              <li key={`${f.label}-${i}`} className="rounded-md border border-[#F0ECE9] bg-[#FAF9F7] px-3 py-2">
                <span className="font-medium text-[#1F1D1B]">{f.label}</span>
                <span className="text-[#9A3A2D]"> — {f.reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end border-t border-[#E2DDD8] bg-[#FAF9F7] p-3">
          <Button size="sm" onClick={() => setResult(null)} className="bg-[#6B5C32] text-white hover:bg-[#4D4224]">
            OK
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { run, busy, progress, resultDialog };
}
