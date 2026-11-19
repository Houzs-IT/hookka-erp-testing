import { useMemo, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, Search, Undo2, X, XCircle } from "lucide-react";
import { QrCameraScanner } from "@/components/qr-camera-scanner";
import { usePermissions } from "@/lib/use-permission";
import {
  daysOut,
  describeIssue,
  formatDays,
  formatIssueDateTime,
  formatPiece,
} from "@/lib/outsource-issue-format";
import {
  useOutsourceIssue,
} from "@/pages/production/use-outsource-issue";
import type {
  FeedbackTone,
  OutsourceIssue,
  OutsourceIssueWithDone,
  OutsourceWorkerSummary,
  StatusFilter,
  UseOutsourceIssueResult,
} from "@/pages/production/use-outsource-issue";
import { MobileCard, MobileHeader, SegmentedSwitch, Sheet, StatusPill } from "../components";
import { ResponsiveActionDock } from "../components/ResponsiveActionDock";
import { chip, CHIP_ROW, CHIP_ROW_CLASS } from "../lib/control-styles";
import { M, M_ACCENT, SEMANTIC } from "../theme";

type ScreenTab = "issue" | "tracking";

const SCREEN_TABS: { key: ScreenTab; label: string }[] = [
  { key: "issue", label: "Issue" },
  { key: "tracking", label: "Tracking" },
];

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "INCOMPLETE", label: "Incomplete" },
  { key: "COMPLETED", label: "Completed" },
  { key: "ALL", label: "All" },
];

const FEEDBACK_TONES: Record<FeedbackTone, { bg: string; fg: string }> = {
  success: M_ACCENT.moss,
  warning: M_ACCENT.warning,
  danger: M_ACCENT.danger,
};

const INPUT_STYLE: CSSProperties = {
  width: "100%",
  height: 48,
  boxSizing: "border-box",
  padding: "0 14px",
  borderRadius: 12,
  border: `1px solid ${M.border}`,
  backgroundColor: M.card,
  color: M.raisin,
  fontFamily: "inherit",
  fontSize: 16,
};

const PRIMARY_BUTTON: CSSProperties = {
  height: 52,
  border: "none",
  borderRadius: 14,
  backgroundColor: M.taupe,
  color: "var(--m-text-on-accent)",
  fontFamily: "inherit",
  fontSize: 16,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const MESSAGE_STYLE: CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: M.muted,
  fontSize: 14,
};

function FeedbackBanner({ tone, message }: { tone: FeedbackTone; message: string }): JSX.Element {
  const colors = FEEDBACK_TONES[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "warning" ? AlertTriangle : XCircle;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 14,
        backgroundColor: colors.bg,
        color: colors.fg,
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 1.4,
        overflowWrap: "anywhere",
      }}
    >
      <Icon size={20} style={{ flex: "none", marginTop: 1 }} aria-hidden />
      <span>{message}</span>
    </div>
  );
}

interface WorkerListProps {
  workers: OutsourceWorkerSummary[];
  selectedId: string;
  allLabel?: string;
  onSelect: (workerId: string) => void;
}

function WorkerList({ workers, selectedId, allLabel, onSelect }: WorkerListProps): JSX.Element {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? workers.filter((worker) => `${worker.empNo} ${worker.name}`.toLowerCase().includes(needle))
      : workers;
  }, [workers, search]);
  const rows: { id: string; title: string; detail: string }[] = [
    ...(allLabel ? [{ id: "", title: allLabel, detail: "" }] : []),
    ...visible.map((worker) => ({
      id: worker.id,
      title: worker.name,
      detail: `${worker.empNo} · ${worker.departmentNames.join(" / ") || "No department"} · ${worker.incompleteCount} open`,
    })),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name or employee no"
        aria-label="Search workers"
        autoComplete="off"
        style={INPUT_STYLE}
      />
      {rows.length === 0 ? (
        <div style={MESSAGE_STYLE}>{workers.length === 0 ? "No active outsourced workers." : "No worker matches."}</div>
      ) : (
        rows.map((row) => {
          const isSelected = row.id === selectedId;
          return (
            <button
              key={row.id || "all"}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(row.id)}
              style={{
                minHeight: 56,
                padding: "8px 14px",
                borderRadius: 14,
                border: `1px solid ${isSelected ? M.taupe : M.border}`,
                backgroundColor: isSelected ? M_ACCENT.gold.bg : M.card,
                color: M.raisin,
                fontFamily: "inherit",
                textAlign: "left",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700 }}>{row.title}</div>
              {row.detail ? <div style={{ fontSize: 12.5, color: M.muted }}>{row.detail}</div> : null}
            </button>
          );
        })
      )}
    </div>
  );
}

function WorkerPickerView({
  workers,
  selectedId,
  onSelect,
  onClose,
}: {
  workers: OutsourceWorkerSummary[];
  selectedId: string;
  onSelect: (workerId: string) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div style={{ padding: "0 16px 24px", minHeight: "calc(100dvh - 120px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin }}>Pick a worker</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 44,
            height: 44,
            border: "none",
            background: "none",
            color: M.muted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={22} />
        </button>
      </div>
      <WorkerList workers={workers} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

function SessionCard({
  item,
  canUndo,
  isUndoing,
  onUndo,
}: {
  item: OutsourceIssue;
  canUndo: boolean;
  isUndoing: boolean;
  onUndo: () => void;
}): JSX.Element {
  return (
    <MobileCard style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>
          {describeIssue(item)}
        </div>
        <div style={{ fontSize: 12.5, color: M.muted }}>{item.workerName}</div>
      </div>
      {canUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={isUndoing}
          style={{
            flex: "none",
            minWidth: 44,
            height: 44,
            padding: "0 12px",
            borderRadius: 12,
            border: `1px solid ${M.border}`,
            backgroundColor: M.card,
            color: M.raisin,
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            opacity: isUndoing ? 0.5 : 1,
          }}
        >
          <Undo2 size={16} aria-hidden />
          Undo
        </button>
      ) : null}
    </MobileCard>
  );
}

function IssuePane({
  issue,
  canIssue,
  canUndo,
}: {
  issue: UseOutsourceIssueResult;
  canIssue: boolean;
  canUndo: boolean;
}): JSX.Element {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typedCode, setTypedCode] = useState("");
  const isScanDisabled = !issue.selectedWorker || !canIssue;

  const submitTypedCode = (): void => {
    const code = typedCode;
    setTypedCode("");
    void issue.issueByScan(code);
  };

  if (isPickerOpen) {
    return (
      <WorkerPickerView
        workers={issue.workers}
        selectedId={issue.selectedWorkerId}
        onSelect={(workerId) => {
          issue.selectWorker(workerId);
          setIsPickerOpen(false);
        }}
        onClose={() => setIsPickerOpen(false)}
      />
    );
  }

  return (
    <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <button
        type="button"
        onClick={() => setIsPickerOpen(true)}
        aria-label={issue.selectedWorker ? `Worker: ${issue.selectedWorker.name}. Change worker` : "Pick a worker"}
        style={{
          minHeight: 64,
          padding: "10px 14px",
          borderRadius: 16,
          border: `1px solid ${issue.selectedWorker ? M.taupe : M.border}`,
          backgroundColor: issue.selectedWorker ? M_ACCENT.gold.bg : M.card,
          color: M.raisin,
          fontFamily: "inherit",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, color: M.muted, fontWeight: 600 }}>Issuing to</div>
          <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: "anywhere" }}>
            {issue.selectedWorker ? issue.selectedWorker.name : "Pick a worker"}
          </div>
          {issue.selectedWorker ? (
            <div style={{ fontSize: 12.5, color: M.muted }}>
              {issue.selectedWorker.empNo} · {issue.selectedWorker.departmentNames.join(" / ") || "No department"} · {issue.selectedWorker.incompleteCount} open
            </div>
          ) : null}
        </div>
        <ChevronDown size={20} color={M.muted} aria-hidden />
      </button>

      {isTyping ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitTypedCode();
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            value={typedCode}
            onChange={(event) => setTypedCode(event.target.value)}
            placeholder="Type or paste the sticker code"
            aria-label="Sticker code"
            inputMode="text"
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={isScanDisabled}
            autoFocus
            style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
          />
          <button
            type="submit"
            disabled={isScanDisabled || issue.isIssuing || !typedCode.trim()}
            style={{ ...PRIMARY_BUTTON, height: 48, padding: "0 16px", opacity: typedCode.trim() ? 1 : 0.5 }}
          >
            Issue
          </button>
        </form>
      ) : null}
      {issue.isWorkersLoading ? <div style={{ ...MESSAGE_STYLE, padding: 8 }}>Loading workers…</div> : null}
      {issue.workersError ? (
        <FeedbackBanner tone="danger" message={`Could not load workers: ${issue.workersError}`} />
      ) : null}
      {!canIssue ? (
        <FeedbackBanner tone="danger" message="You do not have permission to issue work." />
      ) : null}
      {cameraError ? <FeedbackBanner tone="danger" message={cameraError} /> : null}
      {issue.feedback ? <FeedbackBanner tone={issue.feedback.tone} message={issue.feedback.message} /> : null}

      <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>
        Issued this session{issue.sessionIssues.length > 0 ? ` · ${issue.sessionIssues.length}` : ""}
      </div>
      {issue.sessionIssues.length === 0 ? (
        <div style={{ ...MESSAGE_STYLE, padding: "16px 8px" }}>
          Nothing issued yet. Pick a worker, then tap Scan.
        </div>
      ) : (
        issue.sessionIssues.map((item) => (
          <SessionCard
            key={item.id}
            item={item}
            canUndo={canUndo}
            isUndoing={issue.undoingId === item.id}
            onUndo={() => void issue.undoIssue(item)}
          />
        ))
      )}

      <ResponsiveActionDock scope="auto" phoneBottom={64} zIndex={45}>
        <div
          style={{
            width: "100%",
            maxWidth: 414,
            boxSizing: "border-box",
            padding: "10px 16px",
            backgroundColor: M.paper,
            borderTop: `1px solid ${M.border}`,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <button
            type="button"
            disabled={isScanDisabled}
            onClick={() => {
              setCameraError(null);
              setIsCameraOpen(true);
            }}
            style={{ ...PRIMARY_BUTTON, opacity: isScanDisabled ? 0.45 : 1 }}
          >
            <Camera size={20} aria-hidden />
            {issue.selectedWorker ? "Scan" : "Pick a worker to scan"}
          </button>
          <button
            type="button"
            onClick={() => setIsTyping((current) => !current)}
            style={{
              height: 44,
              border: "none",
              background: "none",
              color: M.taupe,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {isTyping ? "Hide code field" : "Type code"}
          </button>
        </div>
      </ResponsiveActionDock>

      {isCameraOpen ? (
        <QrCameraScanner
          isFullScreen
          onDecode={(text) => void issue.issueByScan(text)}
          onClose={() => setIsCameraOpen(false)}
          onError={(message) => {
            setCameraError(message);
            setIsCameraOpen(false);
          }}
          statusText={issue.feedback?.message}
        />
      ) : null}
    </div>
  );
}

function TrackingCard({ item }: { item: OutsourceIssueWithDone }): JSX.Element {
  const isCompleted = item.status === "COMPLETED";
  const needsCheck = !isCompleted && item.workDone;
  const days = daysOut(item);
  const daysText = days === null ? "" : isCompleted ? `took ${formatDays(days)}` : `${formatDays(days)} out`;
  return (
    <MobileCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>{item.poNo}</div>
          <div style={{ fontSize: 13.5, color: M.body, overflowWrap: "anywhere" }}>
            {item.itemLabel}
            {item.pieceNo === null ? "" : ` · ${formatPiece(item)}`}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flex: "none" }}>
          <StatusPill
            style={isCompleted ? SEMANTIC.SUCCESS : SEMANTIC.WARNING}
            label={isCompleted ? "Completed" : "Incomplete"}
            size="sm"
          />
          {needsCheck ? <StatusPill style={SEMANTIC.DANGER} label="Check" size="sm" /> : null}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: M.muted }}>
        {item.workerName} · {item.departmentName} · Issued {formatIssueDateTime(item.issuedAt)} · {daysText}
      </div>
      {isCompleted ? (
        <div style={{ fontSize: 12.5, color: M.muted }}>Completed {formatIssueDateTime(item.completedAt)}</div>
      ) : null}
    </MobileCard>
  );
}

function TrackingPane({ issue }: { issue: UseOutsourceIssueResult }): JSX.Element {
  const [isWorkerSheetOpen, setIsWorkerSheetOpen] = useState(false);
  const filterWorker = issue.workers.find((worker) => worker.id === issue.filters.workerId) ?? null;
  return (
    <div style={{ paddingBottom: 24 }}>
      <div className={CHIP_ROW_CLASS} style={CHIP_ROW}>
        {STATUS_CHIPS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={issue.filters.status === option.key}
            onClick={() => issue.setFilters({ status: option.key })}
            style={chip(issue.filters.status === option.key)}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setIsWorkerSheetOpen(true)}
          style={chip(Boolean(filterWorker))}
          aria-label="Filter by worker"
        >
          {filterWorker ? filterWorker.name : "All workers"}
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>
      <div style={{ padding: "10px 16px 0", position: "relative" }}>
        <Search
          size={18}
          color={M.muted}
          aria-hidden
          style={{ position: "absolute", left: 30, top: 25, pointerEvents: "none" }}
        />
        <input
          type="search"
          value={issue.filters.query}
          onChange={(event) => issue.setFilters({ query: event.target.value })}
          placeholder="Search PO no or product"
          aria-label="Search issues"
          autoComplete="off"
          style={{ ...INPUT_STYLE, paddingLeft: 42 }}
        />
      </div>
      <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {issue.listError ? (
          <div style={MESSAGE_STYLE}>
            <div>Could not load the list: {issue.listError}</div>
            <button
              type="button"
              onClick={issue.refreshList}
              style={{ ...PRIMARY_BUTTON, height: 44, margin: "12px auto 0", padding: "0 20px" }}
            >
              Retry
            </button>
          </div>
        ) : issue.isListLoading ? (
          <div style={MESSAGE_STYLE}>Loading…</div>
        ) : issue.issues.length === 0 ? (
          <div style={MESSAGE_STYLE}>No issues match these filters.</div>
        ) : (
          <>
            {issue.issues.map((item) => (
              <TrackingCard key={item.id} item={item} />
            ))}
            {issue.isListTruncated ? (
              <div style={{ ...MESSAGE_STYLE, padding: 8, fontSize: 12.5 }}>
                Showing the newest {issue.issues.length}. Narrow the filters to see older ones.
              </div>
            ) : null}
          </>
        )}
      </div>
      <Sheet open={isWorkerSheetOpen} onClose={() => setIsWorkerSheetOpen(false)} title="Filter by worker">
        <WorkerList
          workers={issue.workers}
          selectedId={issue.filters.workerId}
          allLabel="All workers"
          onSelect={(workerId) => {
            issue.setFilters({ workerId });
            setIsWorkerSheetOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}

export function OutsourceIssueScreen(): JSX.Element {
  const navigate = useNavigate();
  const issue = useOutsourceIssue();
  const { hasPermission, loading: isPermissionsLoading } = usePermissions();
  const canIssue = isPermissionsLoading || hasPermission("outsource-issues", "create");
  const canUndo = isPermissionsLoading || hasPermission("outsource-issues", "delete");
  const [tab, setTab] = useState<ScreenTab>("issue");

  return (
    <>
      <MobileHeader title="Outsource Work" onBack={() => navigate(-1)} menu />
      <div style={{ padding: "10px 16px 0" }}>
        <SegmentedSwitch options={SCREEN_TABS} value={tab} onChange={setTab} ariaLabel="Outsource Work view" />
      </div>
      {tab === "issue" ? (
        <div style={{ paddingBottom: 200 }}>
          <IssuePane issue={issue} canIssue={canIssue} canUndo={canUndo} />
        </div>
      ) : (
        <TrackingPane issue={issue} />
      )}
    </>
  );
}
