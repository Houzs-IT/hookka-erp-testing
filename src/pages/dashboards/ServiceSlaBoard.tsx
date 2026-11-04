import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cachedFetchJson, useCachedJson } from "@/lib/cached-fetch";
import { CASE_PIPELINE_STEPS, caseDaysOpen, caseStageDays, computeCasePipeline, type CasePipelineInput } from "@/lib/case-pipeline";
import { fmtN } from "./dashboard-shared-lib";
import { ServiceCaseNo } from "./ServiceCaseLink";
import { useServiceCaseLinks } from "./use-service-case-links";

// ---------------------------------------------------------------------------
// Overdue cases by stage (owner 2026-11-04: "dashboard by SLA … 有咩地方系仲未
// 处理完、已经 overdue 咗好耐"). Every open case, placed on the Case Pipeline by
// the same computeCasePipeline as the Service Cases list, so a stage here is the
// stage there. Tab = open cases at that stage, red badge = how many are past
// target, most overdue first. A live backlog: the period picker does not filter it.
//
// Targets (owner 2026-11-04: "根据之前的数据来 set"): measured on prod 2026-11-04
// from the 124 closed cases, days from entering a stage to entering the next.
// Each target is the 75th percentile rounded up, so 3 in 4 past cases met it.
//   stage               cases  median  p75   p90   target
//   Opened               124     0.0   0.0   3.1     1 (floor: a day to pick it up)
//   Investigating         61     0.0   3.1  10.2     4
//   Service Order         59     2.7  10.0  16.1    10
//   Repair in progress    70     4.0   8.0  15.0     8
//   Repair done           55     3.1   5.1   9.1     6
//   Delivery arranged     22     1.3   2.8   5.0     3
//   Delivered             21     3.8   6.0  11.9     6
// Later stages rest on few cases: re-measure once there is more history.
// ---------------------------------------------------------------------------
type Case = {
  id: string;
  caseNo: string;
  customerName: string;
  status: string;
  createdAt: string;
  closedAt?: string | null;
  investigatingAt?: string | null;
  issueDescription: string;
  orders: { id: string; status: string; isSv?: boolean; createdAt?: string }[];
};
type Do = CasePipelineInput["dos"][number];
type Po = CasePipelineInput["pos"][number];

const STAGES = CASE_PIPELINE_STEPS.filter((s) => s !== "Closed");
const STAGE_TARGET_DAYS: Record<string, number> = {
  Opened: 1,
  Investigating: 4,
  "Service Order": 10,
  "Repair in progress": 8,
  "Repair done": 6,
  "Delivery arranged": 3,
  Delivered: 6,
};
const ALL = "All";
const CHUNK = 100;

export function ServiceSlaBoard() {
  const { canOpen, rowProps } = useServiceCaseLinks();
  const { data: caseResp } = useCachedJson<{ data?: Case[] }>("/api/service-cases");
  const { data: doResp } = useCachedJson<{ data?: Do[] }>("/api/delivery-orders");
  const open = useMemo(() => (caseResp?.data ?? []).filter((c) => c.status === "OPEN" || c.status === "IN_PROGRESS"), [caseResp]);

  // Job cards date the repair stages. Scoped to the open cases' SV orders: the
  // unscoped production-order read is far too heavy for a dashboard card.
  const poUrls = useMemo(() => {
    const ids = [...new Set(open.flatMap((c) => c.orders.filter((o) => o.isSv && o.id).map((o) => o.id)))].sort();
    const urls: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      urls.push(`/api/production-orders?fields=minimal&include=jobCards&scope=${ids.slice(i, i + CHUNK).map(encodeURIComponent).join(",")}`);
    }
    return urls;
  }, [open]);
  const [pos, setPos] = useState<Po[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(poUrls.map((u) => cachedFetchJson<{ data?: Po[] }>(u))).then((rs) => {
      if (live) setPos(rs.flatMap((r) => r?.data ?? []));
    });
    return () => { live = false; };
  }, [poUrls]);

  const [nowMs] = useState(() => Date.now());
  const rows = useMemo(() => {
    const dos = doResp?.data ?? [];
    return open
      .map((c) => {
        const svOrderIds = c.orders.filter((o) => o.isSv).map((o) => o.id);
        const svSet = new Set(svOrderIds);
        const pipe = computeCasePipeline({
          caseStatus: c.status,
          createdAt: c.createdAt,
          investigatingAt: c.investigatingAt ?? null,
          closedAt: null,
          orders: c.orders.map((o) => ({ isSv: o.isSv, status: o.status, createdAt: o.createdAt })),
          dos: dos.filter((d) => d.salesOrderId && svSet.has(d.salesOrderId)),
          pos: pos.filter((p) => p.salesOrderId && svSet.has(p.salesOrderId)),
          svOrderIds,
        });
        const inStage = caseStageDays(pipe.enteredAt, null, nowMs);
        const target = STAGE_TARGET_DAYS[pipe.label] ?? 0;
        return {
          ...c,
          stage: pipe.label as string,
          target,
          since: (pipe.enteredAt ?? "").slice(0, 10),
          inStage,
          overdue: Math.max(0, inStage - target),
          age: caseDaysOpen(c.createdAt, null, nowMs),
        };
      })
      .sort((a, b) => b.overdue - a.overdue || b.age - a.age);
  }, [open, doResp, pos, nowMs]);

  const [tab, setTab] = useState<string>(ALL);
  const tabs = useMemo(
    () => [ALL, ...STAGES].map((key) => {
      const list = key === ALL ? rows : rows.filter((r) => r.stage === key);
      return { key, n: list.length, late: list.filter((r) => r.overdue > 0).length };
    }),
    [rows],
  );
  const shown = tab === ALL ? rows : rows.filter((r) => r.stage === tab);

  if (!caseResp) return null;
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
                  <td className="px-3 py-2 max-w-[300px] truncate text-[#6B7280]" title={r.issueDescription}>{r.issueDescription || "—"}</td>
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
