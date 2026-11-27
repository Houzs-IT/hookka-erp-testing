// ---------------------------------------------------------------------------
// Outsource Work (mobile): the issue record page (phone: its own page with a
// back chevron; tablet: the right-hand pane) and the Approve / Send back
// confirm sheet with its result states. The writes are the hook's
// approveIssue / sendBackIssue; the result shown after a successful write is
// read back from the server (the same list endpoint the hook reads), never
// assumed — an approve can leave the issue pending until every slot is done.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import { BadgeCheck, CircleAlert, CircleCheck, CircleX, Factory, FileText, History, Info, Package, Puzzle, ScanLine, Send, Sofa, TriangleAlert, Undo2, type LucideIcon } from "lucide-react";
import type { IssueFeedback, OutsourceIssueWithDone, OutsourceWorkerSummary, UseOutsourceIssueResult } from "@/pages/production/use-outsource-issue";
import { daysOut, describeIssue, formatDays, formatIssueDateTime, formatPiece, shortWorkerName } from "@/lib/outsource-issue-format";
import { initials, itemWithPiece, productLine } from "./os-format";
import { CheckPill, OsBar, OsHeader, OsNote, OsSheet, Spinner, StatusPill } from "./os-kit";
import { CARD_SH, ELLIPSIS, MUTED_ICON, NUM, PRIMARY_BTN, SECONDARY_BTN, X } from "./os-style";
import { ReviewButtons, type ReviewAccess, type ReviewKind } from "./os-tracking";

type Row = { k: string; v: string; icon: LucideIcon; c?: string };

function Group({ t, icon: Icon, rows }: { t: string; icon: LucideIcon; rows: Row[] }) {
  return (
    <section style={{ borderRadius: 16, background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 2px 4px ${X.ring},0 10px 22px -14px ${X.shd}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 6px" }}>
        <Icon size={16} strokeWidth={1.9} color="var(--xo-br)" />
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t}</span>
      </div>
      {rows.map((r, i) => {
        const RIcon = r.icon;
        const has = !!r.v;
        return (
          <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${X.ln}` : "none" }}>
            <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: has ? (r.c ? `color-mix(in srgb,${r.c} 14%,transparent)` : X.tint) : X.neub, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RIcon size={15} strokeWidth={2} color={has ? (r.c ?? "var(--xo-br)") : "var(--xo-mut)"} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11.5, color: X.mut }}>{r.k}</span>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, marginTop: 1, color: has ? X.ink : X.mut, overflowWrap: "anywhere", ...NUM }}>{has ? r.v : "Not yet"}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

export function IssueDetail({ item, worker, access, wide, onBack, onAsk }: {
  item: OutsourceIssueWithDone;
  worker: OutsourceWorkerSummary | undefined;
  access: ReviewAccess;
  wide: boolean;
  onBack: () => void;
  onAsk: (kind: ReviewKind) => void;
}) {
  const needsCheck = item.status === "INCOMPLETE" && item.workDone;
  const isCompleted = item.status === "COMPLETED";
  const days = daysOut(item);
  const old = !isCompleted && days !== null && days >= 7;
  const name = shortWorkerName(item.workerName);
  const showActs = item.status === "PENDING_APPROVAL" && (access.canApprove || access.canSendBack);
  const tiles = [
    { l: "Piece", v: item.pieceNo === null ? "Whole card" : formatPiece(item), warn: false },
    { l: isCompleted ? "Took" : "Days out", v: formatDays(days), warn: old },
    { l: "Payroll", v: item.payrollPeriod || "Not recorded", warn: false },
  ];
  return (
    <section aria-label="Issue detail" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: X.bg, animation: wide ? "none" : "os-page .2s ease-out" }}>
      <OsHeader title={item.poNo || "Issue"} left={wide ? null : "back"} onLeft={onBack} />
      <div className={wide ? "os-scroll" : undefined}
        style={{ flex: 1, minHeight: 0, overflowY: wide ? "auto" : undefined, scrollbarWidth: "none", padding: `2px 16px ${wide ? 20 : showActs ? 100 : 24}px`, display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gridAutoRows: "max-content", gap: 12 }}>
        <section style={{ borderRadius: 20, padding: 14, background: X.card, boxShadow: CARD_SH }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <StatusPill status={item.status} big />
            {needsCheck ? <CheckPill big /> : null}
          </div>
          <h2 style={{ margin: "10px 0 0", fontSize: 20, lineHeight: 1.3, fontWeight: 700, letterSpacing: "-.3px", overflowWrap: "anywhere" }}>{itemWithPiece(item)}</h2>
          {productLine(item) ? <div style={{ fontSize: 13, color: X.sub, marginTop: 3, overflowWrap: "anywhere" }}>{productLine(item)}</div> : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${X.ln}`, flexWrap: "wrap" }}>
            <span style={{ width: 40, height: 40, flex: "none", borderRadius: "50%", background: X.prit, color: X.br, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(name)}</span>
            <span style={{ flex: 1, minWidth: 120 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{name}</span>
              <span style={{ display: "block", fontSize: 12, color: X.mut, marginTop: 1, ...NUM }}>{item.empNo || worker?.empNo || ""}</span>
            </span>
            <span style={{ flex: "none", maxWidth: "100%", height: 26, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px", borderRadius: 999, background: X.tint, color: X.sub, fontSize: 12, fontWeight: 600 }}>
              <Factory size={13} strokeWidth={2} color={MUTED_ICON} style={{ flex: "none" }} /><span style={ELLIPSIS}>{item.departmentName}</span>
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 12 }}>
            {tiles.map((t) => (
              <div key={t.l} style={{ minWidth: 0, padding: "8px 10px", borderRadius: 12, background: t.warn ? X.warnb : X.bg }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: MUTED_ICON, textTransform: "uppercase", whiteSpace: "nowrap" }}>{t.l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, marginTop: 2, color: t.warn ? X.warn : X.ink, overflowWrap: "anywhere", ...NUM }}>{t.v}</div>
              </div>
            ))}
          </div>
        </section>
        {needsCheck ? (
          <OsNote icon={CircleAlert} c={X.sub} bg={X.badb} rail>
            The worker's finished scan is in, but this issue is still open. Check it on the production order — nothing here changes it.
          </OsNote>
        ) : null}
        <Group t="Work" icon={Package} rows={[
          { k: "PO number", v: item.poNo, icon: FileText },
          { k: "Product", v: productLine(item), icon: Sofa },
          { k: "Item", v: item.itemLabel, icon: Puzzle },
        ]} />
        <Group t="Timeline" icon={History} rows={[
          { k: "Issued", v: `${formatIssueDateTime(item.issuedAt)}${item.issuedBy ? ` · by ${item.issuedBy}` : ""}`, icon: Send, c: "var(--xo-info)" },
          { k: "Finished scan", v: item.submittedAt ? formatIssueDateTime(item.submittedAt) : "", icon: ScanLine, c: "var(--xo-warn)" },
          { k: "Approved", v: item.completedAt ? `${formatIssueDateTime(item.completedAt)}${item.approvedBy ? ` · by ${item.approvedBy}` : ""}` : "", icon: BadgeCheck, c: "var(--xo-ok)" },
        ]} />
      </div>
      {showActs ? <OsBar inline={wide}><ReviewButtons access={access} onAsk={onAsk} big /></OsBar> : null}
    </section>
  );
}

// ---- confirm sheet ------------------------------------------------------------------------------
/** Reads one issue back through the list endpoint the hook uses (worker + PO narrow it). */
async function fetchIssueRow(item: OutsourceIssueWithDone): Promise<OutsourceIssueWithDone | null> {
  try {
    const params = new URLSearchParams();
    if (item.workerId) params.set("workerId", item.workerId);
    if (item.poNo) params.set("q", item.poNo);
    const response = await fetch(`/api/outsource-issues?${params.toString()}`);
    if (!response.ok) return null;
    const envelope = (await response.json().catch(() => null)) as { data?: OutsourceIssueWithDone[] } | null;
    return envelope?.data?.find((row) => row.id === item.id) ?? null;
  } catch {
    return null;
  }
}

type Run = { startFeedback: IssueFeedback | null; settled: boolean; verified: OutsourceIssueWithDone | null | undefined };
type Result = { icon: LucideIcon; c: string; bg: string; t: string; s: string; failed: boolean };

function resultOf(kind: ReviewKind, run: Run, feedback: IssueFeedback | null): Result | null {
  if (!run.settled) return null;
  const fb = feedback !== run.startFeedback ? feedback : null;
  if (!fb || fb.tone !== "success") {
    return { icon: CircleX, c: X.bad, bg: X.badb, t: "Couldn't save.", s: fb?.message ?? "Nothing changed. Try again.", failed: true };
  }
  if (run.verified === undefined) return null; // still reading the row back
  const row = run.verified;
  if (kind === "back") {
    return row && row.status === "PENDING_APPROVAL"
      ? { icon: TriangleAlert, c: X.warn, bg: X.warnb, t: "Still pending approval.", s: "The server accepted the request but the issue still shows a finished scan. Refresh to check.", failed: false }
      : { icon: Undo2, c: X.info, bg: X.infob, t: "Sent back.", s: "Now Incomplete — the worker needs to finish and scan again.", failed: false };
  }
  if (!row) return { icon: Info, c: X.info, bg: X.infob, t: "Approved.", s: "Couldn't read the new status back. Refresh the list to check it.", failed: false };
  if (row.status === "COMPLETED") return { icon: CircleCheck, c: X.ok, bg: X.okb, t: "Completed.", s: "Approved and closed.", failed: false };
  return {
    icon: TriangleAlert, c: X.warn, bg: X.warnb,
    t: row.status === "PENDING_APPROVAL" ? "Still pending approval." : "Still open.",
    s: "The finished scan was saved, but this issue closes only when every piece it covers is done.",
    failed: false,
  };
}

export function ReviewSheet({ kind, item, issue, onClose, onVerified }: {
  kind: ReviewKind;
  item: OutsourceIssueWithDone;
  issue: UseOutsourceIssueResult;
  onClose: () => void;
  onVerified: (row: OutsourceIssueWithDone) => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const approve = kind === "approve";
  const busy = !!run && (!run.settled || (run.verified === undefined && issue.feedback !== run.startFeedback && issue.feedback?.tone === "success"));
  const result = run ? resultOf(kind, run, issue.feedback) : null;
  const done = !!result && !result.failed;

  const go = async () => {
    const startFeedback = issue.feedback;
    setRun({ startFeedback, settled: false, verified: undefined });
    await (approve ? issue.approveIssue(item) : issue.sendBackIssue(item));
    setRun({ startFeedback, settled: true, verified: undefined });
    const row = await fetchIssueRow(item);
    if (row) onVerified(row);
    setRun({ startFeedback, settled: true, verified: row });
  };

  const close = () => {
    // The review's own result is shown here; don't leave it on the Issue tab's banner.
    if (run?.settled) issue.clearFeedback();
    onClose();
  };

  const okLabel = busy ? (approve ? "Approving…" : "Sending back…") : result?.failed ? "Try again" : approve ? "Approve" : "Send back";
  const body: ReactNode = approve
    ? "The server decides the result. It may complete the piece, or keep it pending if the production order isn't ready."
    : "It goes back to Incomplete and the finished scan is cleared. The worker scans again when done.";

  return (
    <OsSheet open onClose={close} closeDisabled={busy} title={approve ? "Approve this piece?" : "Send back to worker?"}>
      <div style={{ padding: "4px 16px calc(26px + env(safe-area-inset-bottom))", overflowY: "auto" }}>
        <div style={{ borderRadius: 14, background: X.card, boxShadow: `0 0 0 1px ${X.ln}`, padding: "12px 14px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, overflowWrap: "anywhere" }}>{describeIssue(item)}</div>
          <div style={{ fontSize: 12.5, color: X.sub, marginTop: 3, overflowWrap: "anywhere" }}>{shortWorkerName(item.workerName)} · finished {formatIssueDateTime(item.submittedAt)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
            <span style={{ height: 24, maxWidth: "100%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 999, background: X.prit, color: X.br, fontSize: 11.5, fontWeight: 700 }}>
              <Factory size={12} strokeWidth={2.2} style={{ flex: "none" }} /><span style={ELLIPSIS}>{item.departmentName}</span>
            </span>
          </div>
        </div>
        {result ? (
          <div role={result.failed ? "alert" : "status"} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, padding: "11px 12px", borderRadius: 12, background: result.bg, boxShadow: `inset 3px 0 0 ${result.c}`, fontSize: 12.5, lineHeight: 1.45, color: X.sub }}>
            <result.icon size={16} strokeWidth={2} color={result.c} style={{ flex: "none", marginTop: 1 }} />
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b style={{ color: result.c }}>{result.t}</b> {result.s}</span>
          </div>
        ) : null}
        {done ? (
          <button type="button" onClick={close} style={{ ...PRIMARY_BTN, marginTop: 14, width: "100%", height: 48 }}>Done</button>
        ) : (
          <>
            {result ? null : <div style={{ fontSize: 12.5, color: X.sub, lineHeight: 1.45, marginTop: 10 }}>{body}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={close} disabled={busy} style={{ ...SECONDARY_BTN, height: 48, opacity: busy ? 0.6 : 1 }}>Cancel</button>
              <button type="button" onClick={() => void go()} disabled={busy}
                style={{ ...PRIMARY_BTN, height: 48, background: approve ? "#6B5C32" : "var(--xo-bad)", opacity: busy ? 0.75 : 1, cursor: busy ? "default" : "pointer" }}>
                {busy ? <Spinner size={14} /> : null}{okLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </OsSheet>
  );
}

export function DetailPlaceholder() {
  return (
    <section style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: X.mut, fontSize: 13 }}>
      Pick an issue to see its details.
    </section>
  );
}
