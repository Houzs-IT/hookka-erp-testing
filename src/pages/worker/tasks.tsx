import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ScanLine } from "lucide-react";
import type { OutsourceIssue } from "@/api/lib/outsource-issue";
import { useT } from "@/lib/worker-i18n";
import { formatIssueDate, formatIssueDateTime, formatPiece } from "@/lib/outsource-issue-format";
import { daysHeldText, useOutsourceTasks } from "./use-outsource-tasks";
import type { Translate } from "./use-outsource-tasks";

function TaskCard({ issue, t }: { issue: OutsourceIssue; t: Translate }): JSX.Element {
  const isCompleted = issue.status === "COMPLETED";
  return (
    <li className="rounded-xl border border-[#D8D2CC] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-bold text-[#1F1D1B]">{issue.itemLabel}</p>
          <p className="break-words text-sm text-[#5A5550]">
            {issue.poNo}
            {issue.pieceNo === null ? "" : ` · ${t("tasks.piece")} ${formatPiece(issue)}`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            isCompleted ? "bg-[#EEF3E4] text-[#3F6430]" : "bg-[#FAEFCB] text-[#8A5F14]"
          }`}
        >
          {isCompleted ? t("tasks.completed") : t("tasks.incomplete")}
        </span>
      </div>
      <p className="mt-2 text-sm text-[#5A5550]">
        {isCompleted
          ? `${t("tasks.completed")} ${formatIssueDateTime(issue.completedAt)}`
          : `${t("tasks.issued")} ${formatIssueDate(issue.issuedAt)} · ${daysHeldText(t, issue)}`}
      </p>
    </li>
  );
}

export default function WorkerTasksPage(): JSX.Element {
  const t = useT();
  const { state, reload } = useOutsourceTasks();
  const [isDoneOpen, setIsDoneOpen] = useState(false);

  if (state.kind === "loading") {
    return <div className="pt-8 text-center text-[#5A5550]">{t("common.loading")}</div>;
  }
  if (state.kind === "forbidden") {
    return <div className="pt-8 text-center text-[#5A5550]">{t("tasks.notAvailable")}</div>;
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="space-y-3 pt-8 text-center">
        <p className="text-[#9A3A2D]">{t("tasks.loadError")}</p>
        <p className="break-words text-xs text-[#8A8680]">{state.message}</p>
        <button
          type="button"
          onClick={reload}
          className="h-11 rounded-lg border border-[#6B5C32] px-5 font-semibold text-[#6B5C32]"
        >
          {t("tasks.retry")}
        </button>
      </div>
    );
  }

  const { incomplete, completedRecent } = state;
  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-[#1F1D1B]">{t("tasks.title")}</h1>
        <p className="text-sm text-[#5A5550]">
          {incomplete.length} {t("tasks.toFinish")}
        </p>
      </div>

      {incomplete.length === 0 ? (
        <div className="rounded-xl border border-[#D8D2CC] bg-white p-6 text-center text-sm text-[#5A5550]">
          {t("tasks.empty")}
        </div>
      ) : (
        <ul className="space-y-3">
          {incomplete.map((issue) => (
            <TaskCard key={issue.id} issue={issue} t={t} />
          ))}
        </ul>
      )}

      {completedRecent.length > 0 ? (
        <section>
          <button
            type="button"
            aria-expanded={isDoneOpen}
            onClick={() => setIsDoneOpen((current) => !current)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-[#D8D2CC] bg-white px-4 text-sm font-semibold text-[#1F1D1B]"
          >
            <span>
              {t("tasks.done")} · {completedRecent.length}
            </span>
            <ChevronDown className={`h-5 w-5 transition-transform ${isDoneOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {isDoneOpen ? (
            <ul className="mt-3 space-y-3">
              {completedRecent.map((issue) => (
                <TaskCard key={issue.id} issue={issue} t={t} />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-[57px] z-20 border-t border-[#D8D2CC] bg-[#F0ECE9] px-4 py-3">
        <Link
          to="/worker/scan?camera=1"
          className="mx-auto flex h-14 max-w-md items-center justify-center gap-3 rounded-xl bg-[#6B5C32] text-lg font-bold text-white shadow-md active:translate-y-px"
        >
          <ScanLine className="h-6 w-6" aria-hidden />
          {t("tasks.scanFinished")}
        </Link>
      </div>
    </div>
  );
}
