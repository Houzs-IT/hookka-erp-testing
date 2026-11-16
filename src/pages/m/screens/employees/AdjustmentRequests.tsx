// AdjustmentRequests — the Time adjustment requests card (Employees 3.dc.html), HK-0125 Phase 2.
//
// Pending requests (each with the HTML's "Approve [min] min of N requested" input and its Reject / Approve buttons, shown
// only with `attendance:update`), then Approved adjustments and Rejected history, each with the request's WORK date.
// Approve / Reject call the same endpoints as desktop (adjustment-calls.ts; rules in adjustment-actions.ts). Remove on an approved row and the Daily
// Working Hours Edit / Delete are NOT here (a separate plan).
// The lists carry no date and ignore the Working Hours date filter; each status is capped at the newest 200 by the
// server, so a full response reads "Showing latest 200" instead of an exact total.
import { useEffect, useMemo, useState } from "react";
import { useTimeout } from "@/lib/scheduler";
import { usePermissions } from "@/lib/use-permission";
import { Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, ClipboardCheck, Search } from "lucide-react";
import { ResponsiveActionDock } from "../../components";
import { M } from "../../theme";
import DecisionSheet from "./DecisionSheet";
import { approveConfirm, clampMinutes, type Outcome } from "./adjustment-actions";
import { approveRequest, rejectRequest } from "./adjustment-calls";
import { AMBER_PILL, CARD, CARD_HEAD, CARD_TITLE, COUNT_PILL, INNER, LINK_BUTTON, SEARCH_BOX, SEARCH_INPUT, TONE } from "./employees-styles";
import { fmtMin } from "./employees-format";
import {
  REQUEST_CAP,
  approvedTitle,
  historyCount,
  isCapped,
  kindLabel,
  matchesQuery,
  pendingBadge,
  approvedSub,
  pendingSub,
  rejectedSub,
  requestedMin,
  type NonprodReq,
} from "./time-adjustments-model";
import { useAdjustmentHistory, type AdjustmentList } from "./use-time-adjustments";

const PREVIEW = 5;
const PAGE = 30;

type Props = {
  /** The shell's pending list (the tab badge reads the same one). */
  pending: AdjustmentList & { allowed: boolean };
  deptName: (code: string) => string;
};

export function AdjustmentRequests({ pending, deptName }: Props) {
  const [showAllPending, setShowAllPending] = useState(false);
  const [page, setPage] = useState<"APPROVED" | "REJECTED" | null>(null);
  const approved = useAdjustmentHistory("APPROVED", pending.allowed);
  const rejected = useAdjustmentHistory("REJECTED", pending.allowed);
  // Approve / Reject need `attendance:update` (the server enforces it too).
  const { hasPermission } = usePermissions();
  const canDecide = hasPermission("attendance", "update");
  const [approveFor, setApproveFor] = useState<{ r: NonprodReq; minutes: number } | null>(null);
  const [rejectFor, setRejectFor] = useState<NonprodReq | null>(null);
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  function finish(out: Outcome) {
    setBusy(false);
    setApproveFor(null);
    setRejectFor(null);
    setReason("");
    setReasonErr("");
    // "ok" and "already decided" both refreshed the lists inside adjustment-actions; an error changed nothing.
    setToast({ text: out.message, tone: out.kind === "ok" ? "ok" : "error" });
  }
  async function confirmApprove() {
    if (!approveFor || busy) return;
    setBusy(true);
    finish(await approveRequest(approveFor.r, approveFor.minutes));
  }
  async function confirmReject() {
    if (!rejectFor || busy) return;
    if (!reason.trim()) {
      setReasonErr("Enter a reason to reject.");
      return;
    }
    setBusy(true);
    finish(await rejectRequest(rejectFor, reason));
  }

  // No `attendance:read` → the card is not shown at all (the same gate as the endpoints).
  if (!pending.allowed) return null;

  const rows = pending.rows ?? [];
  const badge = pendingBadge(pending.rows);
  const shown = showAllPending ? rows : rows.slice(0, PREVIEW);

  return (
    <section aria-label="Time adjustment requests" style={{ ...CARD, margin: "12px 18px 0" }}>
      <div style={CARD_HEAD}>
        <ClipboardCheck size={16} strokeWidth={2} color="#6B5C32" />
        <span style={CARD_TITLE}>Time adjustment requests</span>
        {badge ? <span style={AMBER_PILL}>{badge}</span> : null}
      </div>

      {pending.rows === null && pending.loading ? <Note>Loading requests…</Note> : null}
      {pending.rows === null && !pending.loading && pending.error ? <Note>Couldn't load requests.</Note> : null}
      {pending.rows !== null && rows.length === 0 ? <Note>No pending requests.</Note> : null}

      {rows.length > 0 ? (
        <>
          <div style={{ display: "grid", gap: 8, padding: "0 10px 10px" }}>
            {shown.map((r) => (
              <PendingCard
                key={r.id}
                r={r}
                deptName={deptName(r.departmentCode)}
                canDecide={canDecide}
                onApprove={(minutes) => setApproveFor({ r, minutes })}
                onReject={() => {
                  setReason("");
                  setReasonErr("");
                  setRejectFor(r);
                }}
              />
            ))}
          </div>
          {rows.length > PREVIEW ? (
            <button type="button" onClick={() => setShowAllPending((v) => !v)} style={{ ...LINK_BUTTON, marginTop: -2 }}>
              {showAllPending ? "Show fewer" : isCapped(rows) ? `Show all (latest ${REQUEST_CAP})` : `Show all ${rows.length}`}
            </button>
          ) : null}
          {isCapped(rows) ? <div style={{ padding: "0 14px 10px", fontSize: 11.5, color: M.muted }}>Showing latest {REQUEST_CAP} pending</div> : null}
        </>
      ) : null}

      <HistoryGroup
        title="Approved adjustments"
        icon={<CircleCheck size={15} strokeWidth={2} color="#4F7C3A" />}
        list={approved}
        deptName={deptName}
        mode="APPROVED"
        onViewAll={() => setPage("APPROVED")}
      />
      <HistoryGroup
        title="Rejected"
        icon={<CircleX size={15} strokeWidth={2} color="#9A3A2D" />}
        list={rejected}
        deptName={deptName}
        mode="REJECTED"
        onViewAll={() => setPage("REJECTED")}
      />

      <DecisionSheet
        open={!!approveFor}
        onClose={() => setApproveFor(null)}
        title="Approve request?"
        confirmLabel={approveFor ? `Approve ${approveFor.minutes} min` : "Approve"}
        busy={busy}
        onConfirm={() => void confirmApprove()}
      >
        <div style={{ background: M.card, borderRadius: 16, padding: 16, fontSize: 13, lineHeight: 1.55, color: "#3A352C", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)" }}>
          {approveFor ? approveConfirm(approveFor.r, deptName(approveFor.r.departmentCode), approveFor.minutes) : null}
        </div>
      </DecisionSheet>

      <DecisionSheet
        open={!!rejectFor}
        onClose={() => setRejectFor(null)}
        title="Reject request?"
        confirmLabel="Reject"
        tone="danger"
        busy={busy}
        onConfirm={() => void confirmReject()}
      >
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: M.raisin, margin: "0 2px 6px" }}>
            Reason <span style={{ color: "#9A3A2D" }}>*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setReasonErr("");
            }}
            rows={3}
            placeholder="e.g. Not supported by the job card times"
            aria-label="Rejection reason"
            aria-required="true"
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "none", borderRadius: 12, background: M.card, boxShadow: reasonErr ? "0 0 0 2px #C0574A" : "inset 0 0 0 1px #E6E0D9", fontFamily: "inherit", fontSize: 15, lineHeight: 1.5, color: M.raisin, outline: "none", resize: "vertical" }}
          />
          {reasonErr ? (
            <span role="alert" style={{ display: "block", fontSize: 12.5, color: "#7A2E24", margin: "6px 2px 0" }}>
              {reasonErr}
            </span>
          ) : null}
          <span style={{ display: "block", fontSize: 11.5, color: M.muted, margin: "6px 2px 0" }}>The worker sees this reason.</span>
        </label>
      </DecisionSheet>

      {toast ? <DecisionToast text={toast.text} tone={toast.tone} onDone={() => setToast(null)} /> : null}

      {page ? (
        <HistoryPage
          mode={page}
          list={page === "APPROVED" ? approved : rejected}
          deptName={deptName}
          onClose={() => setPage(null)}
        />
      ) : null}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "0 14px 12px", fontSize: 12.5, color: M.ink }}>{children}</div>;
}

/** One pending request: the HTML card, plus its "Approve [min] min of N requested" row and Reject / Approve buttons. */
function PendingCard({
  r,
  deptName,
  canDecide,
  onApprove,
  onReject,
}: {
  r: NonprodReq;
  deptName: string;
  canDecide: boolean;
  onApprove: (minutes: number) => void;
  onReject: () => void;
}) {
  const req = requestedMin(r);
  const [val, setVal] = useState(String(req));
  const ghost = { height: 32, padding: "0 12px", display: "flex", alignItems: "center", gap: 5, border: "1px solid #E6E0D9", borderRadius: 9, background: M.card, color: M.raisin, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const;
  return (
    <div style={INNER}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, lineHeight: 1.35, overflowWrap: "anywhere" }}>
        {r.workerName || r.workerId} · {fmtMin(req)} · {deptName}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
        <KindPill r={r} />
        <span style={{ minWidth: 0, fontSize: 12, color: M.ink, overflowWrap: "anywhere" }}>{pendingSub(r)}</span>
      </div>
      {canDecide ? (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: M.ink }}>
            <span>Approve</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={req}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={() => setVal(String(clampMinutes(val, req)))}
              aria-label="Minutes to approve"
              style={{ width: 64, height: 34, boxSizing: "border-box", padding: "0 8px", border: "1px solid #E6E0D9", borderRadius: 9, background: M.card, fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: M.raisin, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
            />
            <span>min of {req} requested</span>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onReject} style={ghost}>
              <CircleX size={14} strokeWidth={2} />
              Reject
            </button>
            <button
              type="button"
              onClick={() => {
                const minutes = clampMinutes(val, req);
                setVal(String(minutes));
                onApprove(minutes);
              }}
              style={{ ...ghost, border: "none", background: M.taupe, color: "#FFFFFF" }}
            >
              <Check size={14} strokeWidth={2.2} />
              Approve
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Result of a decision (success, "someone already acted", or an error). */
function DecisionToast({ text, tone, onDone }: { text: string; tone: "ok" | "error"; onDone: () => void }) {
  useTimeout(onDone, tone === "error" ? 5200 : 3200);
  return (
    <ResponsiveActionDock scope="auto" phoneBottom={104} tabletBottom={84} zIndex={80}>
      <div
        role={tone === "error" ? "alert" : "status"}
        onClick={onDone}
        style={{ pointerEvents: "auto", width: "max-content", maxWidth: "min(340px, calc(100% - 32px))", boxSizing: "border-box", padding: "10px 14px", borderRadius: 12, background: M.raisin, color: M.paper, fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, textAlign: "center", boxShadow: "0 10px 30px -10px rgba(31,29,27,.5)" }}
      >
        {text}
      </div>
    </ResponsiveActionDock>
  );
}

function KindPill({ r }: { r: NonprodReq }) {
  const t = r.kind === "ADD_PROD" ? TONE.teal : TONE.grey;
  return (
    <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 6, background: t.bg, color: t.fg, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {kindLabel(r)}
    </span>
  );
}

function HistoryRow({ r, mode, deptName, first }: { r: NonprodReq; mode: "APPROVED" | "REJECTED"; deptName: (c: string) => string; first: boolean }) {
  const approved = mode === "APPROVED";
  return (
    <div style={{ padding: "8px 0", borderTop: first ? "none" : "1px solid #F0ECE9" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 6px" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>
          {r.workerName || r.workerId} · {approved ? approvedTitle(r) : `${fmtMin(requestedMin(r))} · ${deptName(r.departmentCode)}`}
        </span>
        {approved ? null : (
          <span style={{ height: 18, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 5, background: TONE.red.bg, color: TONE.red.fg, fontSize: 10.5, fontWeight: 600 }}>
            Rejected
          </span>
        )}
      </div>
      {approved ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
          <KindPill r={r} />
          <span style={{ minWidth: 0, fontSize: 11.5, color: M.ink, overflowWrap: "anywhere" }}>{approvedSub(r, deptName(r.departmentCode))}</span>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: M.ink, marginTop: 2, overflowWrap: "anywhere" }}>{rejectedSub(r)}</div>
      )}
      {!approved && r.rejectReason ? (
        <div style={{ fontSize: 11.5, color: TONE.red.fg, marginTop: 2, overflowWrap: "anywhere" }}>
          <b style={{ fontWeight: 700 }}>Reason:</b> {r.rejectReason}
        </div>
      ) : null}
    </div>
  );
}

function HistoryGroup({
  title,
  icon,
  list,
  deptName,
  mode,
  onViewAll,
}: {
  title: string;
  icon: React.ReactNode;
  list: AdjustmentList;
  deptName: (c: string) => string;
  mode: "APPROVED" | "REJECTED";
  onViewAll: () => void;
}) {
  const rows = list.rows ?? [];
  return (
    <div style={{ borderTop: "1px solid #F0ECE9", padding: "12px 14px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: M.raisin }}>{title}</span>
        <span style={COUNT_PILL}>{list.rows === null ? "…" : isCapped(rows) ? `${REQUEST_CAP}+` : rows.length}</span>
      </div>
      {isCapped(rows) ? <div style={{ fontSize: 11.5, color: M.muted, marginTop: 2 }}>Showing latest {REQUEST_CAP}</div> : null}
      {list.rows === null && !list.loading && list.error ? <div style={{ fontSize: 12, color: M.ink, padding: "6px 0" }}>Couldn't load.</div> : null}
      <div style={{ marginTop: 4 }}>
        {rows.slice(0, PREVIEW).map((r, i) => (
          <HistoryRow key={r.id} r={r} mode={mode} deptName={deptName} first={i === 0} />
        ))}
      </div>
      {rows.length > PREVIEW ? (
        <button
          type="button"
          onClick={onViewAll}
          style={{ ...LINK_BUTTON, height: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 12.5, margin: "0 -14px", width: "calc(100% + 28px)" }}
        >
          {isCapped(rows) ? `View latest ${REQUEST_CAP}` : `View all ${rows.length}`}
          <ChevronRight size={15} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

/** Full page for one history list: search, newest first, 30 at a time. */
function HistoryPage({
  mode,
  list,
  deptName,
  onClose,
}: {
  mode: "APPROVED" | "REJECTED";
  list: AdjustmentList;
  deptName: (c: string) => string;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(PAGE);
  const all = useMemo(() => list.rows ?? [], [list.rows]);
  const found = useMemo(() => all.filter((r) => matchesQuery(r, q)), [all, q]);
  const noun = mode === "APPROVED" ? "approved" : "rejected";
  const searching = q.trim().length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const label = searching
    ? `${found.length} MATCHING · NEWEST FIRST`
    : `${historyCount(all, noun).toUpperCase()} · NEWEST FIRST`;

  return (
    <div role="dialog" aria-modal="true" aria-label={mode === "APPROVED" ? "Approved adjustments" : "Rejected adjustments"} style={{ position: "fixed", inset: 0, zIndex: 70, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, minHeight: 52, padding: "env(safe-area-inset-top, 0px) 14px 0 6px", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: M.raisin }}>{mode === "APPROVED" ? "Approved adjustments" : "Rejected adjustments"}</div>
      </div>
      <div style={{ flex: "none", padding: "4px 18px 8px" }}>
        <label style={SEARCH_BOX}>
          <Search size={16} strokeWidth={1.9} color={M.muted} />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setN(PAGE);
            }}
            placeholder="Search name, department or date"
            className="emp-ph"
            aria-label="Search requests"
            style={SEARCH_INPUT}
          />
        </label>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: M.taupe, margin: "10px 2px 0" }}>{label}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px 24px" }}>
        {found.length === 0 ? (
          <div style={{ ...CARD, padding: 18, fontSize: 13, color: M.ink, textAlign: "center" }}>No requests match.</div>
        ) : (
          <div style={{ ...CARD, padding: "2px 14px" }}>
            {found.slice(0, n).map((r, i) => (
              <HistoryRow key={r.id} r={r} mode={mode} deptName={deptName} first={i === 0} />
            ))}
          </div>
        )}
        {found.length > n ? (
          <button type="button" onClick={() => setN((v) => v + PAGE)} style={{ ...LINK_BUTTON, borderTop: "none", marginTop: 8, ...COUNT_PILL, width: "100%", height: 40, borderRadius: 12 }}>
            Load {PAGE} more · {found.length - n} left
          </button>
        ) : null}
      </div>
    </div>
  );
}
