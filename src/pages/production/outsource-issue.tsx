import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { AlertTriangle, Camera, Check, CheckCircle2, CornerUpLeft, RefreshCw, ScanLine, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataGrid } from "@/components/ui/data-grid";
import type { Column } from "@/components/ui/data-grid";
import { PageHeader } from "@/components/ui/page-header";
import { QrCameraScanner } from "@/components/qr-camera-scanner";
import { usePermissions } from "@/lib/use-permission";
import {
  daysOut,
  describeIssue,
  formatDays,
  formatIssueDateTime,
  formatPiece,
  issueStatusLabel,
} from "@/lib/outsource-issue-format";
import {
  LIST_CAP,
  useEnforceSwitch,
  useOutsourceIssue,
} from "./use-outsource-issue";
import type {
  FeedbackTone,
  OutsourceIssueWithDone,
  StatusFilter,
  UseOutsourceIssueResult,
} from "./use-outsource-issue";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "PENDING_APPROVAL", label: "Pending approval" },
  { key: "INCOMPLETE", label: "Incomplete" },
  { key: "COMPLETED", label: "Completed" },
  { key: "ALL", label: "All" },
];

const FEEDBACK_STYLES: Record<FeedbackTone, string> = {
  success: "bg-[#EEF3E4] border-[#C6DBA8] text-[#3F6430]",
  warning: "bg-[#FAEFCB] border-[#E8D597] text-[#8A5F14]",
  danger: "bg-[#F9E1DA] border-[#E8B2A1] text-[#9A3A2D]",
};

const SELECT_CLASS =
  "h-10 rounded-md border border-[#E2DDD8] bg-white px-2 text-sm text-[#1F1D1B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]";

function FeedbackIcon({ tone }: { tone: FeedbackTone }): JSX.Element {
  if (tone === "success") return <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />;
  if (tone === "warning") return <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />;
  return <XCircle className="h-5 w-5 shrink-0" aria-hidden />;
}

const STATUS_PILL_STYLES: Record<OutsourceIssueWithDone["status"], string> = {
  INCOMPLETE: "border-[#E8D597] bg-[#FAEFCB] text-[#8A5F14]",
  PENDING_APPROVAL: "border-[#B9D3DA] bg-[#E0EDF0] text-[#3E6570]",
  COMPLETED: "border-[#C6DBA8] bg-[#EEF3E4] text-[#3F6430]",
};

function StatusCell({ issue }: { issue: OutsourceIssueWithDone }): JSX.Element {
  const needsCheck = issue.status === "INCOMPLETE" && issue.workDone;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_PILL_STYLES[issue.status]}`}>
        {issueStatusLabel(issue.status)}
      </span>
      {needsCheck ? (
        <span
          title="The work is already done but this issue is still open"
          className="rounded-full border border-[#E8B2A1] bg-[#F9E1DA] px-2 py-0.5 text-xs font-semibold text-[#9A3A2D]"
        >
          Check
        </span>
      ) : null}
    </span>
  );
}

interface ReviewPermissions {
  issue: UseOutsourceIssueResult;
  canApprove: boolean;
  canSendBack: boolean;
}

function ReviewCell({ row, review }: { row: OutsourceIssueWithDone; review: ReviewPermissions }): JSX.Element | null {
  const { issue, canApprove, canSendBack } = review;
  if (row.status !== "PENDING_APPROVAL" || (!canApprove && !canSendBack)) return null;
  const isBusy = issue.reviewingId === row.id;
  return (
    <span className="inline-flex items-center gap-2">
      {canApprove ? (
        <Button type="button" variant="primary" size="sm" disabled={isBusy} onClick={() => void issue.approveIssue(row)}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Approve
        </Button>
      ) : null}
      {canSendBack ? (
        <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void issue.sendBackIssue(row)}>
          <CornerUpLeft className="h-3.5 w-3.5" aria-hidden />
          Send back
        </Button>
      ) : null}
    </span>
  );
}

function buildColumns(review: ReviewPermissions): Column<OutsourceIssueWithDone>[] {
  return [
    {
      key: "issuedAt",
      label: "Issued at",
      width: "150px",
      sortable: true,
      render: (_value, row) => formatIssueDateTime(row.issuedAt),
      exportValue: (row) => formatIssueDateTime(row.issuedAt),
    },
    { key: "workerName", label: "Worker", width: "150px", sortable: true },
    { key: "departmentName", label: "Department", width: "140px", sortable: true },
    { key: "poNo", label: "PO no", width: "130px", sortable: true, type: "docno" },
    { key: "productName", label: "Product", width: "200px", sortable: true },
    { key: "itemLabel", label: "Item", width: "150px", sortable: true },
    {
      key: "piece",
      label: "Piece",
      width: "80px",
      align: "right",
      render: (_value, row) => formatPiece(row),
      exportValue: (row) => formatPiece(row),
      filterAccessor: (row) => formatPiece(row),
    },
    {
      key: "status",
      label: "Status",
      width: "190px",
      sortable: true,
      noClip: true,
      render: (_value, row) => <StatusCell issue={row} />,
      exportValue: (row) =>
        row.status === "INCOMPLETE" && row.workDone ? "Incomplete (check)" : issueStatusLabel(row.status),
    },
    {
      key: "review",
      label: "Approve",
      width: "220px",
      noClip: true,
      render: (_value, row) => <ReviewCell row={row} review={review} />,
      exportValue: () => "",
    },
    {
      key: "submittedAt",
      label: "Finished scan",
      width: "150px",
      sortable: true,
      render: (_value, row) => formatIssueDateTime(row.submittedAt),
      exportValue: (row) => formatIssueDateTime(row.submittedAt),
    },
    {
      key: "completedAt",
      label: "Approved at",
      width: "150px",
      sortable: true,
      render: (_value, row) => formatIssueDateTime(row.completedAt),
      exportValue: (row) => formatIssueDateTime(row.completedAt),
    },
    { key: "approvedBy", label: "Approved by", width: "130px", sortable: true },
    {
      key: "payrollPeriod",
      label: "Payroll",
      width: "100px",
      sortable: true,
      render: (_value, row) => row.payrollPeriod || "—",
      exportValue: (row) => row.payrollPeriod,
    },
    { key: "issuedBy", label: "Issued by", width: "130px", sortable: true },
    {
      key: "daysOut",
      label: "Days out",
      width: "90px",
      align: "right",
      sortable: true,
      sortAccessor: (row) => daysOut(row),
      render: (_value, row) => formatDays(daysOut(row)),
      exportValue: (row) => daysOut(row),
      filterAccessor: (row) => daysOut(row),
    },
  ];
}

function EnforceToggle(): JSX.Element {
  const { isEnforced, isLoading, isSaving, error, setEnforced } = useEnforceSwitch();
  return (
    <div className="rounded-lg border border-[#E6E0D9] bg-white p-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[#6B5C32]"
          checked={isEnforced}
          disabled={isLoading || isSaving}
          onChange={(event) => void setEnforced(event.target.checked)}
        />
        <span className="text-sm text-[#1F1D1B]">
          <span className="font-semibold">Only allow issued items</span>
          <span className="block text-xs text-[#6B7280]">
            When on, an outsourced worker can finish work in their department only on an item issued to them here.
            Turn on after every item they hold has been issued.
          </span>
        </span>
      </label>
      {error ? <p className="mt-2 text-xs text-[#9A3A2D]">{error}</p> : null}
    </div>
  );
}

export default function OutsourceIssuePage(): JSX.Element {
  const issue = useOutsourceIssue();
  const { permissions, hasPermission, loading: isPermissionsLoading } = usePermissions();
  const isSuperAdmin = permissions.has("*");
  const canIssue = isPermissionsLoading || hasPermission("outsource-issues", "create");
  const canUndo = isPermissionsLoading || hasPermission("outsource-issues", "delete");
  const canApprove = !isPermissionsLoading && hasPermission("production-orders", "create");
  const canSendBack = !isPermissionsLoading && hasPermission("outsource-issues", "update");
  const columns = buildColumns({ issue, canApprove, canSendBack });

  const [scanText, setScanText] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const { selectedWorkerId, isIssuing } = issue;
  useEffect(() => {
    if (selectedWorkerId && !isIssuing && !isCameraOpen) scanInputRef.current?.focus();
  }, [selectedWorkerId, isIssuing, isCameraOpen]);

  const isScanDisabled = !issue.selectedWorker || !canIssue;

  const submitScan = (): void => {
    const text = scanText;
    setScanText("");
    void issue.issueByScan(text);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Outsource Work"
        subtitle="Issue work to outsourced workers, approve what they bring back, and track what is still out."
      />
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <section className="space-y-3" aria-label="Issue work">
          <div className="rounded-lg border border-[#E6E0D9] bg-white p-4 space-y-3">
            <div>
              <label htmlFor="outsource-worker" className="mb-1 block text-xs font-medium text-[#6B7280]">
                Worker
              </label>
              <select
                id="outsource-worker"
                className={`${SELECT_CLASS} w-full`}
                value={issue.selectedWorkerId}
                onChange={(event) => issue.selectWorker(event.target.value)}
                disabled={issue.isWorkersLoading}
              >
                <option value="">
                  {issue.isWorkersLoading ? "Loading workers…" : "Select a worker"}
                </option>
                {issue.workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.empNo} · {worker.name} · {worker.departmentNames.join(" / ") || "No department"} ({worker.incompleteCount} open)
                  </option>
                ))}
              </select>
              {issue.workersError ? (
                <p className="mt-1 text-xs text-[#9A3A2D]">Could not load workers: {issue.workersError}</p>
              ) : null}
              {!issue.isWorkersLoading && !issue.workersError && issue.workers.length === 0 ? (
                <p className="mt-1 text-xs text-[#6B7280]">No active outsourced workers.</p>
              ) : null}
            </div>

            {!canIssue ? (
              <p className="text-xs text-[#9A3A2D]">You do not have permission to issue work.</p>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitScan();
              }}
            >
              <label htmlFor="outsource-scan" className="mb-1 block text-xs font-medium text-[#6B7280]">
                Scan sticker
              </label>
              <div className="flex gap-2">
                <Input
                  id="outsource-scan"
                  ref={scanInputRef}
                  value={scanText}
                  onChange={(event) => setScanText(event.target.value)}
                  placeholder={issue.selectedWorker ? "Scan or paste the sticker code" : "Pick a worker first"}
                  disabled={isScanDisabled}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <Button type="submit" variant="primary" disabled={isScanDisabled || issue.isIssuing || !scanText.trim()}>
                  <ScanLine className="h-4 w-4" aria-hidden />
                  Issue
                </Button>
              </div>
            </form>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isScanDisabled}
              onClick={() => {
                setCameraError(null);
                setIsCameraOpen(true);
              }}
            >
              <Camera className="h-4 w-4" aria-hidden />
              Camera
            </Button>
            {cameraError ? <p className="text-xs text-[#9A3A2D]">{cameraError}</p> : null}

            {isCameraOpen ? (
              <QrCameraScanner
                onDecode={(text) => void issue.issueByScan(text)}
                onClose={() => setIsCameraOpen(false)}
                onError={(message) => {
                  setCameraError(message);
                  setIsCameraOpen(false);
                }}
                statusText={issue.feedback?.message}
              />
            ) : null}

            {issue.feedback ? (
              <div
                role="status"
                aria-live="polite"
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm font-medium ${FEEDBACK_STYLES[issue.feedback.tone]}`}
              >
                <FeedbackIcon tone={issue.feedback.tone} />
                <span className="min-w-0 break-words">{issue.feedback.message}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-[#E6E0D9] bg-white p-4">
            <h2 className="text-sm font-bold text-[#1F1D1B]">
              Issued this session
              {issue.sessionIssues.length > 0 ? (
                <span className="ml-2 text-xs font-semibold text-[#6B5C32]">{issue.sessionIssues.length}</span>
              ) : null}
            </h2>
            {issue.sessionIssues.length === 0 ? (
              <p className="mt-2 text-sm text-[#6B7280]">Nothing issued yet. Scan a sticker to start.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[#F0ECE9]">
                {issue.sessionIssues.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-[#1F1D1B]">{describeIssue(item)}</p>
                      <p className="text-xs text-[#6B7280]">{item.workerName}</p>
                    </div>
                    {canUndo ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={issue.undoingId === item.id}
                        onClick={() => void issue.undoIssue(item)}
                      >
                        <Undo2 className="h-3.5 w-3.5" aria-hidden />
                        Undo
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isSuperAdmin ? <EnforceToggle /> : null}
        </section>

        <section className="min-w-0 space-y-3" aria-label="Tracking">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#E6E0D9] bg-white p-3">
            <div role="group" aria-label="Status" className="flex rounded-md border border-[#E2DDD8] bg-[#F0ECE9] p-0.5">
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={issue.filters.status === option.key}
                  onClick={() => issue.setFilters({ status: option.key })}
                  className={`h-9 rounded px-3 text-sm font-medium ${
                    issue.filters.status === option.key ? "bg-white text-[#1F1D1B] shadow-sm" : "text-[#6B7280]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="outsource-filter-worker" className="mb-1 block text-xs font-medium text-[#6B7280]">
                Worker
              </label>
              <select
                id="outsource-filter-worker"
                className={SELECT_CLASS}
                value={issue.filters.workerId}
                onChange={(event) => issue.setFilters({ workerId: event.target.value })}
              >
                <option value="">All workers</option>
                {issue.workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.empNo} · {worker.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="outsource-filter-from" className="mb-1 block text-xs font-medium text-[#6B7280]">
                Issued from
              </label>
              <Input
                id="outsource-filter-from"
                type="date"
                className="w-40"
                value={issue.filters.from}
                onChange={(event) => issue.setFilters({ from: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="outsource-filter-to" className="mb-1 block text-xs font-medium text-[#6B7280]">
                Issued to
              </label>
              <Input
                id="outsource-filter-to"
                type="date"
                className="w-40"
                value={issue.filters.to}
                onChange={(event) => issue.setFilters({ to: event.target.value })}
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <label htmlFor="outsource-filter-query" className="mb-1 block text-xs font-medium text-[#6B7280]">
                Search
              </label>
              <Input
                id="outsource-filter-query"
                type="search"
                placeholder="PO no or product"
                value={issue.filters.query}
                onChange={(event) => issue.setFilters({ query: event.target.value })}
              />
            </div>
            <Button type="button" variant="outline" onClick={issue.refreshList} aria-label="Refresh list">
              <RefreshCw className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          {issue.listError ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-[#E8B2A1] bg-[#F9E1DA] p-3 text-sm text-[#9A3A2D]">
              <span>Could not load the list: {issue.listError}</span>
              <Button type="button" variant="outline" size="sm" onClick={issue.refreshList}>
                Retry
              </Button>
            </div>
          ) : null}
          {issue.isListTruncated ? (
            <p className="text-xs text-[#9C6F1E]">
              Showing the newest {LIST_CAP} issues. Narrow the filters to see older ones.
            </p>
          ) : null}

          <div className="rounded-lg border border-[#E6E0D9] bg-white overflow-visible">
            <DataGrid<OutsourceIssueWithDone>
              columns={columns}
              data={issue.issues}
              keyField="id"
              stickyHeader
              maxHeight="calc(100dvh - 300px)"
              loading={issue.isListLoading}
              emptyMessage="No issues match these filters."
              gridId="outsource-issue-tracking"
              exportName="outsource-work"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
