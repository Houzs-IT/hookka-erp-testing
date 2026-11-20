import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, PackageOpen } from "lucide-react";
import { useT } from "@/lib/worker-i18n";
import { summarizeTasks } from "@/lib/outsource-issue-format";
import { useOutsourceTasks } from "./use-outsource-tasks";

export function OutsourceTaskTile(): JSX.Element | null {
  const t = useT();
  const { state } = useOutsourceTasks();
  if (state.kind !== "ready") return null;
  return (
    <Link
      to="/worker/tasks"
      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border-2 border-[#6B5C32] bg-white px-4 py-3 text-[#6B5C32] transition-colors hover:bg-[#FAF7F0]"
    >
      <PackageOpen className="h-6 w-6 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{t("tasks.title")}</span>
        <span className="block text-sm text-[#5A5550]">{summarizeTasks(t, state.incomplete)}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
    </Link>
  );
}
