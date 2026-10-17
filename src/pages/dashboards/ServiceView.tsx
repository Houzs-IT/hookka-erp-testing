import { useMemo, useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import {
  TEAL, RED, AMBER, GREEN, MUTED, fmtN,
  inFocus, dayLabel, periodLabel, type Period, type ServiceSub } from "./dashboard-shared-lib";
import { Kpi, LiveBadge } from "./dashboard-shared";
import { ServiceApprovalsPanel } from "./ServiceApprovalsPanel";
import { ServiceIssuesPanel } from "./ServiceIssuesPanel";
import { ServicePerformancePanel } from "./ServicePerformancePanel";
import { ServiceCaseNo, OpenServiceCasesLink } from "./ServiceCaseLink";
import { useServiceCaseLinks } from "./use-service-case-links";
import { byCause, causeKeys, causeLabel } from "../../api/lib/service-issue-stats";

// Service tab: service-case report, overdue tracking, and the
// approvals queue. Reads the `service` slice of the same cached
// GET /api/dashboard/prototype feed (built in api/lib/dashboard-service-slice.ts).
// The slice is OPTIONAL: a feed cached before this tab shipped, or a caller
// without service-cases:read, has no `service` key and must not crash the tab.
type ServiceCase = {
  id: string;
  caseNo: string | null;
  customer: string | null;
  status: string;
  createdDate: string;
  closedDate: string | null;
  issue: string;
  approvalKind: string | null;
  approvalStatus: string | null;
  ageDays: number | null;
  daysOverdue: number;
  // Added with the Top issues sub-tab — absent on a feed cached before it shipped.
  causes?: string[];
  rootCauses?: { category: string; detail: string }[];
  unit?: string | null;
  prevention?: string | null;
  products?: string[];
};
type Feed = {
  success?: boolean;
  availability?: { service?: { live: boolean; reason?: string } };
  service?: { overdueAfterDays: number; cases: ServiceCase[] } | null;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  OPEN: { bg: "#FAEFCB", fg: "#9C6F1E" },
  IN_PROGRESS: { bg: "#E6F0F3", fg: "#3E6570" },
  CLOSED: { bg: "#EEF3E4", fg: "#4F7C3A" },
  CANCELLED: { bg: "#F0ECE9", fg: "#6B7280" },
};
const statusLabel = (s: string) => s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function StatusPill({ status }: { status: string }) {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.CANCELLED;
  return (
    <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st.bg, color: st.fg }}>
      {statusLabel(status)}
    </span>
  );
}

const APPROVAL_STYLE: Record<string, string> = { PENDING: "#9C6F1E", APPROVED: "#4F7C3A", REJECTED: "#9A3A2D" };

export function ServiceView({
  period, sub, onPeriodChange, onSubChange,
}: { period: Period; sub: ServiceSub; onPeriodChange: (p: Period) => void; onSubChange: (s: ServiceSub) => void }) {
  const { data, loading, error } = useCachedJson<Feed>("/api/dashboard/prototype");
  const [search, setSearch] = useState("");
  // Root-cause key clicked on Top issues; narrows the Report's case list only.
  const [causeFilter, setCauseFilter] = useState<string | null>(null);
  // Case rows open the real Service Cases module (gated like its sidebar entry).
  const { canOpen, rowProps } = useServiceCaseLinks();

  const slice = data?.service ?? null;
  const cases = useMemo(() => slice?.cases ?? [], [slice]);
  const threshold = slice?.overdueAfterDays ?? 3;

  // Cases logged inside the focused window (a clicked day narrows it).
  const logged = useMemo(() => cases.filter((c) => inFocus(period, c.createdDate)), [cases, period]);

  const listRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logged
      .filter((c) => !causeFilter || causeKeys(c).includes(causeFilter))
      .filter((c) => !q || [c.caseNo, c.customer, c.issue].some((v) => (v ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1));
  }, [logged, search, causeFilter]);
  // Picker options: categories present in the period's cases (plus the active one, so it never vanishes).
  const causeOptions = useMemo(() => byCause(logged).filter((r) => r.count > 0 || r.key === causeFilter), [logged, causeFilter]);

  // Overdue is a live backlog, not a period slice: a case stuck for 20 days is
  // overdue whichever month is selected.
  const overdue = useMemo(
    () => cases.filter((c) => c.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue),
    [cases],
  );
  const pendingApprovals = cases.filter((c) => c.approvalStatus === "PENDING").length;

  if (loading) return <div className="py-16 text-center text-sm text-[#6B7280]">Loading…</div>;
  if (error || !data?.success) {
    return (
      <Card className="border-[#F0D9AE] bg-[#FDF3E4]">
        <CardContent className="p-3 text-sm text-[#B5701A]">Couldn't load Service: {error ?? "unknown error"}</CardContent>
      </Card>
    );
  }
  if (!slice) {
    return (
      <Card>
        <CardContent className="p-3 text-sm text-[#6B7280]">
          Service data isn't available: {data.availability?.service?.reason ?? "the feed has no service section yet (try again in a minute)."}
        </CardContent>
      </Card>
    );
  }

  const ageNote = `Age = whole days since the case was logged (created date), while it is still Open or In progress. Overdue = more than ${threshold} days.`;

  return (
    <div className="space-y-4 max-md:space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-[#1F1D1B]">Service</h2>
        <LiveBadge live={data.availability?.service?.live ?? false} />
        {!period.day && <span className="text-xs text-[#6B7280]">{periodLabel(period)}</span>}
        {period.day && (
          <button
            type="button"
            onClick={() => onPeriodChange({ ...period, day: undefined })}
            className="text-xs rounded-md border border-[#E5E0D8] bg-[#F7F5F3] px-2 py-0.5 text-[#6B5C32] hover:bg-white max-md:min-h-10 max-md:px-3 max-md:text-left"
          >
            Showing: {dayLabel(period.day)} — click to go back
          </button>
        )}
        <OpenServiceCasesLink canOpen={canOpen} />
      </div>

      {sub === "overview" && (
        <>
          {/* Merged (owner 2026-10-17: "上面跟下面的数据 confusing"): one row of
              numbers and one opened-vs-closed chart, from the performance
              panel; the old "of those logged" status row and its duplicate
              chart are gone. */}
          <ServicePerformancePanel
            slice={slice}
            period={period}
            onPeriodChange={onPeriodChange}
            afterKpis={
              <ServiceIssuesPanel
                cases={logged}
                period={period}
                onPickCause={(k) => { setCauseFilter(k); onSubChange("overview"); document.getElementById("svc-cases")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              />
            }
          />

        </>
      )}

      {/* Merged dashboard: Report holds performance and root causes; To do
          (key "overdue") holds overdue cases and approvals. */}

      {sub === "overdue" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kpi label="Overdue cases" value={fmtN(overdue.length)} sub={`open > ${threshold} days`} valueColorClass="text-[#9A3A2D]" />
            <Kpi label="Worst" value={overdue[0] ? `${overdue[0].daysOverdue} d` : "—"} sub={overdue[0]?.caseNo ?? undefined} valueColorClass="text-[#9C6F1E]" />
            <Kpi label="Pending approvals" value={fmtN(pendingApprovals)} sub="cases waiting for a decision" valueColorClass="text-[#3E6570]" />
          </div>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle>Overdue service cases, worst first</CardTitle>
              <p className="text-xs text-[#6B7280]">{ageNote} A live backlog: the period picker does not filter it.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="*:sticky *:top-0 *:z-10 *:bg-white *:shadow-[inset_0_1px_0_#E2DDD8,inset_0_-1px_0_#E2DDD8]">
                      {["Case", "Customer", "Issue", "Logged", "Status", "Age", "Days overdue"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-semibold uppercase text-[10.5px] tracking-wide text-[#6B7280]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.map((c) => (
                      <tr key={c.id} {...rowProps(c.id, "border-b border-[#E2DDD8]")}>
                        <td className="px-3 py-2 font-mono text-[#1F1D1B] whitespace-nowrap"><ServiceCaseNo id={c.id} caseNo={c.caseNo} canOpen={canOpen} /></td>
                        <td className="px-3 py-2 text-[#1F1D1B]">{c.customer ?? "—"}</td>
                        <td className="px-3 py-2 text-[#6B7280] max-w-[300px] truncate">{c.issue || "—"}</td>
                        <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">{dayLabel(c.createdDate)}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><StatusPill status={c.status} /></td>
                        <td className="px-3 py-2 tabular-nums text-[#6B7280]">{c.ageDays} d</td>
                        <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: c.daysOverdue >= 7 ? RED : c.daysOverdue >= 3 ? AMBER : TEAL }}>
                          +{c.daysOverdue} d
                        </td>
                      </tr>
                    ))}
                    {overdue.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: GREEN }}>No overdue service cases.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {sub === "overdue" && <ServiceApprovalsPanel />}

      {/* Summary first, the long case list last (owner 2026-10-17: dashboard
          cards on top, rows of detail at the bottom). */}
      {sub === "overview" && (
        <>
        <div id="svc-cases" className="scroll-mt-48">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
              <CardTitle>Service cases logged ({fmtN(listRows.length)})</CardTitle>
              <select
                aria-label="Category"
                value={causeFilter ?? ""}
                onChange={(e) => setCauseFilter(e.target.value || null)}
                className="h-8 max-md:h-10 max-md:w-full rounded-md border border-[#E2DDD8] bg-white px-2 text-xs max-md:text-sm text-[#1F1D1B] focus:outline-none"
              >
                <option value="">All categories</option>
                {causeOptions.map((r) => (
                  <option key={r.key} value={r.key}>{r.label} ({fmtN(r.count)})</option>
                ))}
              </select>
              <div className="relative w-full max-w-[220px] max-md:max-w-none">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search case, customer, issue…" className="h-8 max-md:h-10 pl-8 text-xs max-md:text-sm" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto" style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="*:sticky *:top-0 *:z-10 *:bg-white *:shadow-[inset_0_1px_0_#E2DDD8,inset_0_-1px_0_#E2DDD8]">
                      {["Case", "Customer", "Issue", "Category", "Logged", "Status", "Approval"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-semibold uppercase text-[10.5px] tracking-wide text-[#6B7280]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listRows.map((c) => (
                      <tr key={c.id} {...rowProps(c.id, "border-b border-[#E2DDD8]")}>
                        <td className="px-3 py-2 font-mono text-[#1F1D1B] whitespace-nowrap"><ServiceCaseNo id={c.id} caseNo={c.caseNo} canOpen={canOpen} /></td>
                        <td className="px-3 py-2 text-[#1F1D1B]">{c.customer ?? "—"}</td>
                        <td className="px-3 py-2 text-[#6B7280] max-w-[320px] truncate">{c.issue || "—"}</td>
                        <td className="px-3 py-2 text-[#6B7280]">{c.causes?.length ? c.causes.map(causeLabel).join(", ") : "—"}</td>
                        <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">{dayLabel(c.createdDate)}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><StatusPill status={c.status} /></td>
                        <td className="px-3 py-2 whitespace-nowrap text-[11.5px] font-semibold" style={{ color: APPROVAL_STYLE[c.approvalStatus ?? ""] ?? MUTED }}>
                          {c.approvalStatus ? statusLabel(c.approvalStatus) : "—"}
                        </td>
                      </tr>
                    ))}
                    {listRows.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-6 text-center text-[#6B7280]">No cases match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}
