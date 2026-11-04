import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCachedJson } from "@/lib/cached-fetch";
import { CASE_PIPELINE_STEPS } from "@/lib/case-pipeline";
import type { SlaRow } from "../../api/lib/dashboard-service-sla";
import { fmtN } from "./dashboard-shared-lib";
import { ServiceCaseNo } from "./ServiceCaseLink";
import { useServiceCaseLinks } from "./use-service-case-links";

// ---------------------------------------------------------------------------
// Overdue cases by stage (owner 2026-11-04: "dashboard by SLA … 有咩地方系仲未
// 处理完、已经 overdue 咗好耐"). Every open case on the Case Pipeline, with one
// target per stage; the rows and the targets come from the server
// (api/lib/dashboard-service-sla.ts), so whoever may open the Service tab can
// read the board. Tab = open cases at that stage, red badge = how many are past
// target, most overdue first. A live backlog: the period picker does not filter it.
// ---------------------------------------------------------------------------
const STAGES = CASE_PIPELINE_STEPS.filter((s) => s !== "Closed");
const ALL = "All";

export function ServiceSlaBoard() {
  const { canOpen, rowProps } = useServiceCaseLinks();
  const { data } = useCachedJson<{ data?: SlaRow[] }>("/api/dashboard/prototype/service-sla");
  const rows = useMemo(() => data?.data ?? [], [data]);

  const [tab, setTab] = useState<string>(ALL);
  const tabs = useMemo(
    () => [ALL, ...STAGES].map((key) => {
      const list = key === ALL ? rows : rows.filter((r) => r.stage === key);
      return { key, n: list.length, late: list.filter((r) => r.overdue > 0).length };
    }),
    [rows],
  );
  const shown = tab === ALL ? rows : rows.filter((r) => r.stage === tab);

  if (!data) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Overdue cases by stage</CardTitle>
        <p className="text-xs text-[#6B7280]">
          Open cases whose current stage has run past its target · targets = what 3 in 4 past cases met · tab = open cases at the stage, red = how many are overdue · most overdue first · live, whatever the period
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="flex flex-wrap gap-2 px-4 pt-2 max-md:flex-nowrap max-md:overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`relative shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${tab === t.key ? "border-[#6B5C32] bg-[#6B5C32] text-white" : "border-[#E2DDD8] bg-white text-[#5A5550] hover:bg-[#F7F5F3]"}`}
            >
              {t.key} <span className="ml-0.5 opacity-70 tabular-nums">{fmtN(t.n)}</span>
              {t.late > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#9A3A2D] px-1 text-[10px] font-semibold text-white tabular-nums">{fmtN(t.late)}</span>
              )}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table className="w-full text-[12.5px] max-md:min-w-[760px]">
            <thead>
              <tr className="*:sticky *:top-0 *:z-10 *:bg-white *:shadow-[inset_0_1px_0_#E2DDD8,inset_0_-1px_0_#E2DDD8]">
                {["Case", "Customer", "Complaint", "Stage", "In stage since", "Target", "Days in stage", "Days overdue", "Case age"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#6B7280] whitespace-nowrap ${i >= 5 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} {...rowProps(r.id, "border-b border-[#E2DDD8]")}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap"><ServiceCaseNo id={r.id} caseNo={r.caseNo} canOpen={canOpen} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.customerName || "—"}</td>
                  <td className="px-3 py-2 max-w-[300px] truncate text-[#6B7280]" title={r.issue}>{r.issue || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.stage}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-[#6B7280]">{r.since || "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-[#6B7280]">{r.target} day{r.target === 1 ? "" : "s"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.inStage}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.overdue > 0 ? "font-semibold text-[#9A3A2D]" : "text-[#9CA3AF]"}`}>{r.overdue || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.age} days</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-[#6B7280]">No open cases at this stage.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
