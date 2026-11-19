import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  CornerUpLeft,
  RefreshCw,
  ScanLine,
  Undo2,
  XCircle,
} from "lucide-react";
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
import { LIST_CAP, useEnforceSwitch, useOutsourceIssue } from "./use-outsource-issue";
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

const STATUS_PILL_STYLES: Record<OutsourceIssueWithDone["status"], string> = {
  INCOMPLETE: "border-[#E8D597] bg-[#FAEFCB] text-[#8A5F14]",
  PENDING_APPROVAL: "border-[#B9D3DA] bg-[#E0EDF0] text-[#3E6570]",
  COMPLETED: "border-[#C6DBA8] bg-[#EEF3E4] text-[#3F6430]",
};

const SELECT_CLASS =
  "h-9 rounded-md border border-[#E2DDD8] bg-white px-2 text-sm text-[#1F1D1B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]";

const CARD_CLASS = "rounded-lg border border-[#E6E0D9] bg-white";

function FeedbackIcon({ tone }: { tone: FeedbackTone }): JSX.Element {
  if (tone === "success") return <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />;
  if (tone === "warning") return <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />;
  return <XCircle className="h-5 w-5 shrink-0" aria-hidden />;
}

function NumericText({ value }: { value: string }): JSX.Element {
  return <span className="tabular-nums">{value}</span>;
}

function ClippedText({ value }: { value: string }): JSX.Element {
  return (
    <span className="block max-w-[200px] truncate" title={value}>
      {value}
    </span>
  );
}

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
    <span className="inline-flex items-center gap-1.5">
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

function dateTimeColumn(
  key: "issuedAt" | "submittedAt" | "completedAt",
  label: string,
  isHiddenByDefault: boolean,
): Column<OutsourceIssueWithDone> {
  return {
    key,
    label,
    width: "128px",
    sortable: true,
    defaultHidden: isHiddenByDefault,
    render: (_value, row) => <NumericText value={formatIssueDateTime(row[key])} />,
    exportValue: (row) => formatIssueDateTime(row[key]),
  };
}

function buildColumns(review: ReviewPermissions): Column<OutsourceIssueWithDone>[] {
  return [
    dateTimeColumn("issuedAt", "Issued at", false),
    { key: "workerName", label: "Worker", width: "120px", sortable: true },
    { key: "departmentName", label: "Department", width: "110px", sortable: true },
    {
      key: "poNo",
      label: "PO no",
      width: "124px",
      sortable: true,
      render: (_value, row) => <NumericText value={row.poNo} />,
    },
    {
      key: "productName",
      label: "Product",
      width: "200px",
      sortable: true,
      render: (_value, row) => <ClippedText value={row.productName} />,
    },
    {
      key: "itemLabel",
      label: "Item",
      width: "170px",
      sortable: true,
      render: (_value, row) => <ClippedText value={row.itemLabel} />,
    },
    {
      key: "piece",
      label: "Piece",
      width: "56px",
      align: "right",
      render: (_value, row) => <NumericText value={formatPiece(row)} />,
      exportValue: (row) => formatPiece(row),
      filterAccessor: (row) => formatPiece(row),
    },
    {
      key: "status",
      label: "Status",
      width: "150px",
      sortable: true,
      noClip: true,
      render: (_value, row) => <StatusCell issue={row} />,
      exportValue: (row) =>
        row.status === "INCOMPLETE" && row.workDone ? "Incomplete (check)" : issueStatusLabel(row.status),
    },
    dateTimeColumn("submittedAt", "Finished scan", true),
    dateTimeColumn("completedAt", "Approved at", true),
    { key: "approvedBy", label: "Approved by", width: "120px", sortable: true, defaultHidden: true },
    {
      key: "payrollPeriod",
      label: "Payroll",
      width: "90px",
      sortable: true,
      defaultHidden: true,
      render: (_value, row) => <NumericText value={row.payrollPeriod || "—"} />,
      exportValue: (row) => row.payrollPeriod,
    },
    { key: "issuedBy", label: "Issued by", width: "120px", sortable: true, defaultHidden: true },
    {
      key: "daysOut",
      label: "Days out",
      width: "80px",
      align: "right",
      sortable: true,
      defaultHidden: true,
      sortAccessor: (row) => daysOut(row),
      render: (_value, row) => <NumericText value={formatDays(daysOut(row))} />,
      exportValue: (row) => daysOut(row),
      filterAccessor: (row) => daysOut(row),
    },
    {
      key: "review",
      label: "Actions",
      width: "196px",
      noClip: true,
      noFilter: true,
      stickyEnd: true,
      render: (_value, row) => <ReviewCell row={row} review={review} />,
      exportValue: () => "",
    },
  ];
}

function StepBadge({ step, label, isDone }: { step: number; label: string; isDone: boolean }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
        isDone ? "border-[#C6DBA8] bg-[#EEF3E4] text-[#3F6430]" : "border-[#E2DDD8] bg-[#F7F4F0] text-[#6B5C32]"
      }`}
    >
      <span className="tabular-nums">{step}.</span>
      {label}
    </span>
  );
}

function IssueWorkPanel({ issue, canIssue }: { issue: UseOutsourceIssueResult; canIssue: boolean }): JSX.Element {
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
    <section className={`${CARD_CLASS} space-y-3 p-4`} aria-labelledby="issue-work-heading">
      <div className="space-y-2">
        <h2 id="issue-work-heading" className="text-base font-bold text-[#1F1D1B]">
          Issue Work
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <StepBadge step={1} label="Select worker" isDone={Boolean(issue.selectedWorker)} />
          <span className="text-xs text-[#9C948C]" aria-hidden>
            →
          </span>
          <StepBadge step={2} label="Scan sticker" isDone={issue.sessionIssues.length > 0} />
        </div>
      </div>

      <div>
        <label htmlFor="outsource-worker" className="mb-1 block text-xs font-medium text-[#6B7280]">
          Worker
        </label>
        <select
          id="outsource-worker"
          className={`${SELECT_CLASS} h-10 w-full`}
          value={issue.selectedWorkerId}
          onChange={(event) => issue.selectWorker(event.target.value)}
          disabled={issue.isWorkersLoading}
        >
          <option value="">{issue.isWorkersLoading ? "Loading workers…" : "Select a worker"}</option>
          {issue.workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.empNo} · {worker.name} · {worker.departmentNames.join(" / ") || "No department"} (
              {worker.incompleteCount} open)
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

      {!canIssue ? <p className="text-xs text-[#9A3A2D]">You do not have permission to issue work.</p> : null}

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
            enterKeyHint="send"
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
    </section>
  );
}

function SessionIssues({ issue, canUndo }: { issue: UseOutsourceIssueResult; canUndo: boolean }): JSX.Element {
  return (
    <div className="p-4">
      <h3 className="text-sm font-bold text-[#1F1D1B]">
        Issued this session
        {issue.sessionIssues.length > 0 ? (
          <span className="ml-2 text-xs font-semibold tabular-nums text-[#6B5C32]">{issue.sessionIssues.length}</span>
        ) : null}
      </h3>
      {issue.sessionIssues.length === 0 ? (
        <p className="mt-1 text-sm text-[#6B7280]">Nothing issued yet. Scan a sticker to start.</p>
      ) : (
        <ul className="mt-1 divide-y divide-[#F0ECE9]">
          {issue.sessionIssues.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium tabular-nums text-[#1F1D1B]">{describeIssue(item)}</p>
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
  );
}

function EnforceSwitch(): JSX.Element {
  const { isEnforced, isLoading, isSaving, error, setEnforced } = useEnforceSwitch();
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#1F1D1B]" id="enforce-switch-label">
          Only allow issued items
        </p>
        <p
          className="truncate text-xs text-[#6B7280]"
          title="When on, an outsourced worker can finish work in their department only on an item issued to them here. Turn on after every item they hold has been issued."
        >
          Workers can finish only items issued to them.
        </p>
        {error ? <p className="mt-1 text-xs text-[#9A3A2D]">{error}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isEnforced}
        aria-labelledby="enforce-switch-label"
        disabled={isLoading || isSaving}
        onClick={() => void setEnforced(!isEnforced)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32] focus-visible:ring-offset-2 disabled:opacity-50 ${
          isEnforced ? "bg-[#6B5C32]" : "bg-[#D8D2CC]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            isEnforced ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function StatusTabs({ issue }: { issue: UseOutsourceIssueResult }): JSX.Element {
  return (
    <div role="group" aria-label="Status" className="flex rounded-md border border-[#E2DDD8] bg-[#F0ECE9] p-0.5">
      {STATUS_FILTERS.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={issue.filters.status === option.key}
          onClick={() => issue.setFilters({ status: option.key })}
          className={`h-8 whitespace-nowrap rounded px-3 text-sm font-medium ${
            issue.filters.status === option.key ? "bg-white text-[#1F1D1B] shadow-sm" : "text-[#6B7280]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TrackingFilters({ issue }: { issue: UseOutsourceIssueResult }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusTabs issue={issue} />
      <select
        aria-label="Worker"
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
      <div className="flex items-center gap-1" role="group" aria-label="Issued date range">
        <Input
          type="date"
          aria-label="Issued from"
          className="h-9 w-[138px] tabular-nums"
          value={issue.filters.from}
          onChange={(event) => issue.setFilters({ from: event.target.value })}
        />
        <span className="text-xs text-[#6B7280]" aria-hidden>
          –
        </span>
        <Input
          type="date"
          aria-label="Issued to"
          className="h-9 w-[138px] tabular-nums"
          value={issue.filters.to}
          onChange={(event) => issue.setFilters({ to: event.target.value })}
        />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={issue.refreshList} aria-label="Refresh list" title="Refresh">
        <RefreshCw className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

function TrackingLedger({ issue, review }: { issue: UseOutsourceIssueResult; review: ReviewPermissions }): JSX.Element {
  return (
    <section className="min-w-0 space-y-3" aria-label="Tracking and approval">
      {issue.listError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-[#E8B2A1] bg-[#F9E1DA] p-3 text-sm text-[#9A3A2D]"
        >
          <span>Could not load the list: {issue.listError}</span>
          <Button type="button" variant="outline" size="sm" onClick={issue.refreshList}>
            Retry
          </Button>
        </div>
      ) : null}
      {issue.isListTruncated ? (
        <p className="text-xs text-[#9C6F1E]">Showing the newest {LIST_CAP} issues. Narrow the filters to see older ones.</p>
      ) : null}
      <DataGrid<OutsourceIssueWithDone>
        columns={buildColumns(review)}
        data={issue.issues}
        keyField="id"
        stickyHeader
        maxHeight="calc(100dvh - 260px)"
        loading={issue.isListLoading}
        emptyMessage="No issues match these filters."
        gridId="outsource-issue-tracking-v2"
        exportName="outsource-work"
        toolbarStart={<TrackingFilters issue={issue} />}
        searchPlaceholder="Search PO no, product, or item…"
        onSearchChange={(query) => issue.setFilters({ query })}
      />
    </section>
  );
}

export default function OutsourceIssuePage(): JSX.Element {
  const issue = useOutsourceIssue();
  const { permissions, hasPermission, loading: isPermissionsLoading } = usePermissions();
  const isSuperAdmin = permissions.has("*");
  const canIssue = isPermissionsLoading || hasPermission("outsource-issues", "create");
  const canUndo = isPermissionsLoading || hasPermission("outsource-issues", "delete");
  const review: ReviewPermissions = {
    issue,
    canApprove: !isPermissionsLoading && hasPermission("production-orders", "create"),
    canSendBack: !isPermissionsLoading && hasPermission("outsource-issues", "update"),
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Outsource Work"
        subtitle="Issue work to outsourced workers, approve what they bring back, and track what is still out."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3">
          <IssueWorkPanel issue={issue} canIssue={canIssue} />
          <div className={`${CARD_CLASS} divide-y divide-[#F0ECE9]`}>
            <SessionIssues issue={issue} canUndo={canUndo} />
            {isSuperAdmin ? <EnforceSwitch /> : null}
          </div>
        </div>
        <TrackingLedger issue={issue} review={review} />
      </div>
    </div>
  );
}
