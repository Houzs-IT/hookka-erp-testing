// ===========================================================================
// PlanningScreen — L1 /m/planning, phone AND tablet (Planning v2).
//
// Visuals: Claude Design `Planning v2.dc.html`; behaviour: CHANGES.md §1-7 and
// the desktop Planning page. Three views in place (?tab=schedule|capacity|
// tracker) plus two view-only screens from the ⋯ menu (?screen=lead-times|
// proposals). Lead Times and Proposals never write; the two reports are the
// existing server-rendered pages, opened in a new tab.
//
//   Schedule  GET /api/planning/schedule/:dept        (scheduler-assigned days)
//   Capacity  GET /api/production-orders (lite) + public holidays   (computed)
//   Tracker   GET /api/production-orders (lite) + /api/scheduling
//   Lead Times GET /api/production-leadtimes (+ /history)
//   Proposals GET /api/planning/proposals?status=
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ClipboardList, Gauge } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { useUrlBatch, useUrlState } from "@/lib/use-url-state";
import { MobileHeader } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { SEGMENT_ICON, SEGMENT_WRAP, segmentButton, segmentTrack } from "../../lib/control-styles";
import { useHolidays, usePendingProposalCount, usePlanningOrders, useProductionDepartments } from "../../lib/planning-data";
import { SCHEDULE_DEPTS } from "../../lib/planning-schedule";
import { useMobileToast } from "../delivery/ui-hooks";
import { CapacityTab } from "./CapacityTab";
import { LeadTimesScreen } from "./LeadTimesScreen";
import { LoadingSheet } from "./LoadingSheet";
import { MoreSheet } from "./MoreSheet";
import { ProposalsScreen, type ProposalFilter } from "./ProposalsScreen";
import { ScheduleTab } from "./ScheduleTab";
import { TrackerTab } from "./TrackerTab";
import { MoreButton } from "./ui";

type Tab = "schedule" | "capacity" | "tracker";
const TABS: { key: Tab; label: string; icon: typeof Gauge }[] = [
  { key: "schedule", label: "Schedule", icon: CalendarDays },
  { key: "capacity", label: "Capacity", icon: Gauge },
  { key: "tracker", label: "Tracker", icon: ClipboardList },
];

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The signed-in user's department as a schedule chip — only on an EXACT match of its code / name; else null. */
function userDeptCode(department: string | undefined): string | null {
  const n = norm(department ?? "");
  if (!n) return null;
  const hit = SCHEDULE_DEPTS.find((d) => norm(d.code) === n || norm(d.name) === n);
  return hit?.code ?? null;
}

export function PlanningScreen() {
  const navigate = useNavigate();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const { hasPermission, loading: permLoading } = usePermissions();
  const canRead = !permLoading && hasPermission("production-orders", "read");
  const toast = useMobileToast();
  const setUrl = useUrlBatch();

  const [tabRaw] = useUrlState<string>("tab", "schedule");
  const [screen] = useUrlState<string>("screen", "");
  const [deptRaw] = useUrlState<string>("dept", "");
  const [pstatus] = useUrlState<string>("pstatus", "ALL");
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? (tabRaw as Tab) : "schedule";

  const me = useCachedJson<{ data?: { user?: { department?: string } } }>("/api/auth/me", 300);
  const deptCode = useMemo(
    () => (SCHEDULE_DEPTS.some((d) => d.code === deptRaw) ? deptRaw : userDeptCode(me.data?.data?.user?.department) ?? "FAB_CUT"),
    [deptRaw, me.data],
  );

  const [moreOpen, setMoreOpen] = useState(false);
  const [loadingDept, setLoadingDept] = useState<string | null>(null);
  const { orders } = usePlanningOrders(tab === "capacity");
  const holidays = useHolidays(tab === "capacity");
  const prodDepts = useProductionDepartments(tab === "capacity");
  const pendingCount = usePendingProposalCount(canRead && moreOpen);

  const openOrder = (id: string) => navigate(`/m/production/${encodeURIComponent(id)}`);
  const openReport = (which: "schedule" | "overdue") => {
    setMoreOpen(false);
    // Same URLs as the desktop buttons. Opened in a new tab: the report pages have no app header or back button.
    const w = window.open(`/api/reports/${which}`, "_blank");
    if (!w) {
      toast.show("The report was blocked from opening. Allow pop-ups for this site and try again.", "warning");
      return;
    }
    w.opener = null;
  };
  const closeScreen = () => setUrl({ screen: null, pstatus: null });

  const column = (children: React.ReactNode) => (
    <div style={{ maxWidth: tablet ? 760 : undefined, margin: "0 auto", boxSizing: "border-box" }}>{children}</div>
  );

  if (screen === "lead-times") {
    return (
      <>
        <MobileHeader title="Lead Times" onBack={closeScreen} />
        {column(<LeadTimesScreen />)}
        {toast.node}
      </>
    );
  }
  if (screen === "proposals") {
    const filter: ProposalFilter = pstatus === "PENDING" || pstatus === "APPROVED" || pstatus === "REJECTED" ? pstatus : "ALL";
    return (
      <>
        <MobileHeader title="Schedule Proposals" onBack={closeScreen} />
        {column(<ProposalsScreen canRead={canRead} filter={filter} onFilter={(f) => setUrl({ pstatus: f === "ALL" ? null : f })} />)}
        {toast.node}
      </>
    );
  }

  return (
    <>
      <MobileHeader title="Planning" menu trailing={<MoreButton onClick={() => setMoreOpen(true)} />} />
      {column(
        <>
          <div style={SEGMENT_WRAP}>
            <div role="group" aria-label="Planning view" style={segmentTrack(TABS.length)}>
              {TABS.map((t) => (
                <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setUrl({ tab: t.key === "schedule" ? null : t.key })} style={segmentButton(tab === t.key)}>
                  <t.icon {...SEGMENT_ICON} aria-hidden />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === "schedule" ? <ScheduleTab deptCode={deptCode} onDeptChange={(code) => setUrl({ dept: code })} /> : null}
          {tab === "capacity" ? (
            <CapacityTab
              canReadProposals={canRead}
              onOpenProposals={() => setUrl({ screen: "proposals", pstatus: "PENDING" })}
              onOpenLoading={setLoadingDept}
            />
          ) : null}
          {tab === "tracker" ? <TrackerTab onOpenOrder={openOrder} /> : null}
        </>,
      )}

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        canRead={canRead}
        pendingCount={pendingCount}
        onLeadTimes={() => {
          setMoreOpen(false);
          setUrl({ screen: "lead-times" });
        }}
        onProposals={() => {
          setMoreOpen(false);
          setUrl({ screen: "proposals", pstatus: null });
        }}
        onReport={openReport}
      />
      <LoadingSheet deptCode={loadingDept} deptName={prodDepts?.find((d) => d.code === loadingDept)?.name} orders={orders} holidays={holidays} onClose={() => setLoadingDept(null)} onOpenOrder={openOrder} />
      {toast.node}
    </>
  );
}
