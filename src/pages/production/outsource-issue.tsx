import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CornerUpLeft,
  RefreshCw,
  ScanLine,
  Undo2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCameraScanner } from "@/components/qr-camera-scanner";
import { Input } from "@/components/ui/input";
import { DataGrid } from "@/components/ui/data-grid";
import type { Column } from "@/components/ui/data-grid";
import { PageHeader } from "@/components/ui/page-header";
import { usePermissions } from "@/lib/use-permission";
import {
  daysOut,
  describeIssue,
  formatDays,
  formatIssueDateTime,
  formatPiece,
  issueStatusLabel,
  shortWorkerName,
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

const NEUTRAL_GRID_SURFACE = [
  "rounded-lg border border-slate-200 bg-white",
  "[&_thead_tr]:!border-b [&_thead_tr]:!border-slate-200 [&_thead_tr]:!bg-slate-50",
  "[&_thead_th]:!bg-slate-50 [&_thead_th]:!text-slate-600",
  "[&_[data-dg=row]]:!bg-white [&_[data-dg=row]:hover]:!bg-slate-50",
  "[&_[data-dg=row]>td.sticky]:!bg-white [&_[data-dg=row]:hover>td.sticky]:!bg-slate-50",
  "[&_td.sticky.right-0]:border-l [&_td.sticky.right-0]:border-stone-200 [&_th.sticky.right-0]:border-l [&_th.sticky.right-0]:border-stone-200",
].join(" ");

const APPROVE_BUTTON_CLASS = "bg-emerald-700 text-white hover:bg-emerald-800";

function FeedbackIcon({ tone }: { tone: FeedbackTone }): JSX.Element {
  if (tone === "success") return <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />;
  if (tone === "warning") return <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />;
  return <XCircle className="h-5 w-5 shrink-0" aria-hidden />;
}

function NumericText({ value }: { value: string }): JSX.Element {
  return <span className="tabular-nums">{value}</span>;
}

function ClippedText({ value, title }: { value: string; title?: string }): JSX.Element {
  return (
    <span className="block max-w-[200px] truncate" title={title ?? value}>
      {value}
    </span>
  );
}

function DateTimeCell({ value }: { value: string }): JSX.Element {
  const splitAt = value.lastIndexOf(" ");
  if (splitAt < 0) return <NumericText value={value} />;
  return (
    <span className="block leading-tight tabular-nums">
      <span className="block">{value.slice(0, splitAt)}</span>
      <span className="block text-xs text-[#6B7280]">{value.slice(splitAt + 1)}</span>
    </span>
  );
}

function ProductItemCell({ product, item }: { product: string; item: string }): JSX.Element {
  return (
    <span className="block max-w-[260px] leading-tight" title={`${product}\n${item}`}>
      <span className="block truncate font-medium text-[#1F1D1B]">{product}</span>
      <span className="block truncate text-xs text-[#6B7280]">{item}</span>
    </span>
  );
}

function StatusCell({ issue }: { issue: OutsourceIssueWithDone }): JSX.Element {
  const needsCheck = issue.status === "INCOMPLETE" && issue.workDone;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
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
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {canApprove ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          className={APPROVE_BUTTON_CLASS}
          disabled={isBusy}
          onClick={() => void issue.approveIssue(row)}
        >
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
    width: "100px",
    sortable: true,
    defaultHidden: isHiddenByDefault,
    render: (_value, row) => <DateTimeCell value={formatIssueDateTime(row[key])} />,
    exportValue: (row) => formatIssueDateTime(row[key]),
  };
}

function buildColumns(review: ReviewPermissions): Column<OutsourceIssueWithDone>[] {
  return [
    dateTimeColumn("issuedAt", "Issued at", false),
    {
      key: "workerName",
      label: "Worker",
      width: "120px",
      sortable: true,
      render: (_value, row) => <ClippedText value={shortWorkerName(row.workerName)} title={row.workerName} />,
    },
    { key: "departmentName", label: "Department", width: "100px", sortable: true, defaultHidden: true },
    {
      key: "poNo",
      label: "PO no",
      width: "108px",
      sortable: true,
      render: (_value, row) => <NumericText value={row.poNo} />,
    },
    {
      key: "productName",
      label: "Product & Item",
      width: "200px",
      sortable: true,
      render: (_value, row) => <ProductItemCell product={row.productName} item={row.itemLabel} />,
      exportValue: (row) => `${row.productName} / ${row.itemLabel}`,
      filterAccessor: (row) => `${row.productName} ${row.itemLabel}`,
    },
    {
      key: "piece",
      label: "Piece",
      width: "64px",
      align: "right",
      defaultHidden: true,
      render: (_value, row) => <NumericText value={formatPiece(row)} />,
      exportValue: (row) => formatPiece(row),
      filterAccessor: (row) => formatPiece(row),
    },
    {
      key: "status",
      label: "Status",
      width: "130px",
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
      width: "220px",
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

function IssueWorkBar({
  issue,
  canIssue,
  canUndo,
  isSuperAdmin,
}: {
  issue: UseOutsourceIssueResult;
  canIssue: boolean;
  canUndo: boolean;
  isSuperAdmin: boolean;
}): JSX.Element {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
        <div className="flex flex-wrap items-center gap-3">
          {isSuperAdmin ? <EnforceSwitch /> : null}
          <SessionIssuesPopover issue={issue} canUndo={canUndo} />
        </div>
      </div>

      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          submitScan();
        }}
      >
        <div className="min-w-0">
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
        </div>

        <div className="min-w-0">
          <label htmlFor="outsource-scan" className="mb-1 block text-xs font-medium text-[#6B7280]">
            Scan sticker
          </label>
          <div className="flex gap-2">
            <Input
              id="outsource-scan"
              ref={scanInputRef}
              value={scanText}
              onChange={(event) => setScanText(event.target.value)}
              placeholder={issue.selectedWorker ? "Scan, type or paste the sticker code" : "Pick a worker first"}
              disabled={isScanDisabled}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-describedby="outsource-scan-hint"
              className="h-10 min-w-0 flex-1"
            />
            <Button type="submit" variant="primary" className="h-10 shrink-0" disabled={isScanDisabled || issue.isIssuing || !scanText.trim()}>
              <ArrowRight className="h-4 w-4" aria-hidden />
              Issue
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-10 w-full md:w-auto"
          disabled={isScanDisabled}
          onClick={() => {
            setCameraError(null);
            setIsCameraOpen(true);
          }}
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          Scan QR
        </Button>
      </form>

      <p id="outsource-scan-hint" className="text-xs text-[#6B7280]">
        {issue.isIssuing
          ? "Issuing…"
          : "Scan the QR on the item's production sticker or its job card. Each scan issues one item to this worker."}
      </p>
      {issue.workersError ? <p className="text-xs text-[#9A3A2D]">Could not load workers: {issue.workersError}</p> : null}
      {!issue.isWorkersLoading && !issue.workersError && issue.workers.length === 0 ? (
        <p className="text-xs text-[#6B7280]">No active outsourced workers.</p>
      ) : null}
      {!canIssue ? <p className="text-xs text-[#9A3A2D]">You do not have permission to issue work.</p> : null}
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

function SessionIssuesPopover({ issue, canUndo }: { issue: UseOutsourceIssueResult; canUndo: boolean }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const count = issue.sessionIssues.length;

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutside = (event: MouseEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="session-issues-panel"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#E2DDD8] bg-[#F7F4F0] px-3 text-sm font-semibold text-[#6B5C32] hover:bg-[#EFEAE3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]"
      >
        Issued this session
        <span className="rounded-full bg-white px-1.5 text-xs tabular-nums text-[#1F1D1B]">{count}</span>
      </button>
      {isOpen ? (
        <div
          id="session-issues-panel"
          className="absolute right-0 z-30 mt-2 max-h-80 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[#E6E0D9] bg-white p-3 shadow-lg"
        >
          {count === 0 ? (
            <p className="text-sm text-[#6B7280]">Nothing issued yet. Scan a sticker to start.</p>
          ) : (
            <ul className="divide-y divide-[#F0ECE9]">
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
      ) : null}
    </div>
  );
}

function EnforceSwitch(): JSX.Element {
  const { isEnforced, isLoading, isSaving, error, setEnforced } = useEnforceSwitch();
  return (
    <div
      className="flex items-center gap-2"
      title="When on, an outsourced worker can finish work in their department only on an item issued to them here. Turn on after every item they hold has been issued."
    >
      <span className="text-sm font-semibold text-[#1F1D1B]" id="enforce-switch-label">
        Only allow issued items
      </span>
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
      {error ? <span className="text-xs text-[#9A3A2D]">{error}</span> : null}
    </div>
  );
}

function StatusTabs({ issue }: { issue: UseOutsourceIssueResult }): JSX.Element {
  return (
    <div role="group" aria-label="Status" className="flex max-w-full overflow-x-auto rounded-md bg-slate-100 p-1">
      {STATUS_FILTERS.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={issue.filters.status === option.key}
          onClick={() => issue.setFilters({ status: option.key })}
          className={`h-8 whitespace-nowrap rounded px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
            issue.filters.status === option.key ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {option.label}
          {issue.statusCounts ? (
            <span className="ml-1.5 tabular-nums text-xs font-semibold text-slate-500">{issue.statusCounts[option.key]}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function TrackingFilters({ issue }: { issue: UseOutsourceIssueResult }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
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
      <div className={NEUTRAL_GRID_SURFACE}>
        <DataGrid<OutsourceIssueWithDone>
          columns={buildColumns(review)}
          data={issue.issues}
          keyField="id"
          stickyHeader
          maxHeight="calc(100dvh - 260px)"
          loading={issue.isListLoading}
          emptyMessage="No issues match these filters."
          gridId="outsource-issue-tracking-v4"
          hideToolbarCount
          exportName="outsource-work"
          toolbarStart={<StatusTabs issue={issue} />}
          toolbarSecondRow={<TrackingFilters issue={issue} />}
          searchPlaceholder="Search PO no, product, or item…"
          onSearchChange={(query) => issue.setFilters({ query })}
        />
      </div>
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
      <IssueWorkBar issue={issue} canIssue={canIssue} canUndo={canUndo} isSuperAdmin={isSuperAdmin} />
      <TrackingLedger issue={issue} review={review} />
    </div>
  );
}
