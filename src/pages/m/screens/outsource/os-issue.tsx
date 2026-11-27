// ---------------------------------------------------------------------------
// Outsource Work (mobile): the Issue tab — worker card / picker (tablet: the
// worker aside), sticker code + Issue, feedback, "Issued this session" with
// Undo, and the Scan QR bar. Every read and write is the hook's.
// ---------------------------------------------------------------------------
import { useMemo, useState, type FormEvent } from "react";
import { Barcode, Check, ChevronRight, Info, ListChecks, Lock, ScanLine, ScanQrCode, Search, Undo2, UserRound, UserRoundSearch, Users } from "lucide-react";
import type { OutsourceWorkerSummary, UseOutsourceIssueResult } from "@/pages/production/use-outsource-issue";
import { describeIssue, shortWorkerName } from "@/lib/outsource-issue-format";
import { deptChips, feedbackView } from "./os-format";
import { DeptPills, OsBanner, OsBar, OsLabel, OsNote, OsSheet, Spinner } from "./os-kit";
import { BRAND, CARD_SH, ELLIPSIS, FIELD_SH, LIST_SH, MUTED_ICON, NUM, PLACEHOLDER, X } from "./os-style";

export type IssueAccess = { canIssue: boolean; canUndo: boolean };

function useWorkerSearch(workers: OutsourceWorkerSummary[]) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? workers.filter((w) => `${w.name} ${w.empNo}`.toLowerCase().includes(needle)) : workers;
  }, [workers, q]);
  return { q, setQ, rows };
}

function SearchField({ q, setQ, aria, ph, ring }: { q: string; setQ: (v: string) => void; aria: string; ph: string; ring?: string }) {
  return (
    <label style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 13px", background: X.card, borderRadius: 14, boxShadow: ring ?? FIELD_SH }}>
      <Search size={18} strokeWidth={1.75} color={PLACEHOLDER} style={{ flex: "none" }} />
      <input className="os-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ph} aria-label={aria} autoComplete="off"
        style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: X.ink, padding: 0 }} />
    </label>
  );
}

/** The worker list inside the "Select worker" sheet. */
export function WorkerPickerSheet({ open, onClose, issue, onPick }: {
  open: boolean; onClose: () => void; issue: UseOutsourceIssueResult; onPick: (id: string) => void;
}) {
  const { q, setQ, rows } = useWorkerSearch(issue.workers);
  const n = issue.workers.length;
  return (
    <OsSheet open={open} onClose={onClose} title="Select worker" sub={`${n} outsource worker${n === 1 ? "" : "s"}`}>
      <div style={{ padding: "4px 16px 8px" }}>
        <SearchField q={q} setQ={setQ} aria="Search workers" ph="Search name or employee no." ring={`0 0 0 1px ${X.ln}`} />
      </div>
      <div className="os-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px calc(26px + env(safe-area-inset-bottom))", scrollbarWidth: "none", display: "grid", alignContent: "start", gap: 8 }}>
        {rows.map((w) => {
          const on = w.id === issue.selectedWorkerId;
          return (
            <button key={w.id} type="button" aria-pressed={on} onClick={() => onPick(w.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, border: "none", background: X.card, boxShadow: on ? `0 0 0 2px ${BRAND},0 10px 22px -14px ${X.shd}` : `0 0 0 1px ${X.ring},0 8px 18px -14px ${X.shd}`, fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, ...ELLIPSIS }}>{shortWorkerName(w.name)}</span>
                  <span style={{ flex: "none", fontSize: 11.5, color: X.mut, ...NUM }}>{w.empNo}</span>
                </span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}><DeptPills depts={deptChips(w.departmentCodes, w.departmentNames)} small /></span>
              </span>
              <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, ...NUM }}>{w.incompleteCount}</span>
                <span style={{ fontSize: 10.5, color: X.mut }}>open</span>
              </span>
              <span style={{ width: 22, height: 22, flex: "none", borderRadius: "50%", boxShadow: on ? "none" : "inset 0 0 0 1.5px #CDBE98", background: on ? BRAND : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
                {on ? <Check size={13} strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
        {rows.length === 0 ? (
          <div style={{ padding: 22, borderRadius: 16, background: X.card, boxShadow: `0 0 0 1px ${X.ring}`, textAlign: "center", fontSize: 13, color: X.mut }}>
            {n === 0 ? "No active outsourced workers." : "No worker matches. Try another name or employee no."}
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 4px 0", fontSize: 11.5, lineHeight: 1.45, color: "var(--xo-note)" }}>
          <Info size={14} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
          <span>Open counts include pieces waiting for approval.</span>
        </div>
      </div>
    </OsSheet>
  );
}

/** Tablet: the always-visible worker list on the left of the Issue tab. */
export function WorkerAside({ issue, onPick }: { issue: UseOutsourceIssueResult; onPick: (id: string) => void }) {
  const { q, setQ, rows } = useWorkerSearch(issue.workers);
  return (
    <aside aria-label="Workers" style={{ flex: "none", width: "min(340px,38%)", display: "flex", flexDirection: "column", borderRight: `1px solid ${X.ln}`, minHeight: 0 }}>
      <div style={{ padding: "12px 16px 8px" }}><SearchField q={q} setQ={setQ} aria="Search workers" ph="Search name or employee no." /></div>
      <div className="os-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 16px", scrollbarWidth: "none" }}>
        <div style={{ borderRadius: 16, background: X.card, boxShadow: LIST_SH, overflow: "hidden" }}>
          {rows.map((w, i) => {
            const on = w.id === issue.selectedWorkerId;
            return (
              <button key={w.id} type="button" aria-pressed={on} onClick={() => onPick(w.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 58, padding: "8px 12px", border: "none", borderTop: i ? `1px solid ${X.ln}` : "none", background: on ? X.prit : "transparent", boxShadow: `inset 3px 0 0 ${on ? BRAND : "transparent"}`, fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, ...ELLIPSIS }}>{shortWorkerName(w.name)}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: X.mut, marginTop: 1, ...ELLIPSIS }}>{w.empNo} · {w.departmentNames.join(", ") || "No department"}</span>
                </span>
                <span style={{ flex: "none", fontSize: 11.5, fontWeight: 700, color: X.br, ...NUM }}>{w.incompleteCount} open</span>
              </button>
            );
          })}
          {rows.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", fontSize: 12.5, color: X.mut }}>
              {issue.isWorkersLoading ? "Loading workers…" : issue.workers.length === 0 ? "No active outsourced workers." : "No worker matches."}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function WorkerBlock({ issue, wide, onOpenPicker }: { issue: UseOutsourceIssueResult; wide: boolean; onOpenPicker: () => void }) {
  if (issue.isWorkersLoading && issue.workers.length === 0) {
    return <div aria-busy="true" style={{ height: 96, borderRadius: 18, background: X.card, animation: "os-pulse 1.2s ease-in-out infinite" }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Loading workers…</span></div>;
  }
  if (issue.workersError && issue.workers.length === 0) {
    return <OsBanner role="alert" view={{ tone: "danger", t: "Couldn't load workers", s: issue.workersError }} />;
  }
  if (issue.workers.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, background: X.card, boxShadow: `0 0 0 1px ${X.ring}` }}>
        <span style={{ width: 46, height: 46, flex: "none", borderRadius: "50%", background: X.tint, color: X.br, display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={20} strokeWidth={1.9} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>No active outsourced workers</span>
          <span style={{ display: "block", fontSize: 12, color: X.mut, marginTop: 2, lineHeight: 1.4 }}>Mark a worker as outsourced in HR to issue work here.</span>
        </span>
      </div>
    );
  }
  const w = issue.selectedWorker;
  if (!w) {
    return (
      <button type="button" onClick={wide ? undefined : onOpenPicker} disabled={wide}
        style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 72, padding: 14, borderRadius: 18, border: "1.5px dashed #CDBE98", background: X.tint, fontFamily: "inherit", textAlign: "left", cursor: wide ? "default" : "pointer", color: X.ink }}>
        <span style={{ width: 46, height: 46, flex: "none", borderRadius: "50%", background: X.card, color: X.br, display: "flex", alignItems: "center", justifyContent: "center" }}><UserRoundSearch size={20} strokeWidth={1.9} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>Pick a worker</span>
          <span style={{ display: "block", fontSize: 12, color: X.mut, marginTop: 2 }}>{wide ? "Choose from the list on the left" : "Work is issued to the worker you pick"}</span>
        </span>
        {wide ? null : <ChevronRight size={18} strokeWidth={2} color={MUTED_ICON} />}
      </button>
    );
  }
  const name = shortWorkerName(w.name);
  return (
    <button type="button" onClick={wide ? undefined : onOpenPicker} disabled={wide} aria-label={wide ? `Worker ${name}` : `Worker ${name}, tap to change`}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, border: "none", background: X.card, boxShadow: CARD_SH, fontFamily: "inherit", textAlign: "left", cursor: wide ? "default" : "pointer", color: X.ink, opacity: 1 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{name}</span>
        <span style={{ display: "block", fontSize: 12, color: X.mut, marginTop: 2, ...NUM }}>{w.empNo}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}><DeptPills depts={deptChips(w.departmentCodes, w.departmentNames)} /></span>
      </span>
      <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, ...NUM }}>{w.incompleteCount}</span>
        <span style={{ fontSize: 10.5, color: X.mut }}>open</span>
        {wide ? null : <span style={{ fontSize: 11.5, fontWeight: 700, color: X.br }}>Change</span>}
      </span>
    </button>
  );
}

export function IssueSection({ issue, access, wide, lastAction, onAction, onOpenPicker, onOpenScanner }: {
  issue: UseOutsourceIssueResult;
  access: IssueAccess;
  wide: boolean;
  lastAction: "issue" | "undo";
  onAction: (a: "issue" | "undo") => void;
  onOpenPicker: () => void;
  onOpenScanner: () => void;
}) {
  const [code, setCode] = useState("");
  const hasWorker = !!issue.selectedWorker;
  const canType = hasWorker && access.canIssue;
  const codeOk = !!code.trim();
  const canSubmit = canType && codeOk && !issue.isIssuing;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    const typed = code;
    setCode("");
    onAction("issue");
    void issue.issueByScan(typed);
  };

  const fb = issue.feedback ? feedbackView(issue.feedback, lastAction === "undo" ? "Couldn't undo" : "Couldn't issue") : null;
  const scanLabel = !access.canIssue ? "Issuing not allowed" : hasWorker ? "Scan QR" : "Pick a worker to scan";
  const canScan = canType;
  const n = issue.sessionIssues.length;

  return (
    <section aria-label="Issue" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className={wide ? "os-scroll" : undefined}
        style={{ flex: 1, minHeight: 0, overflowY: wide ? "auto" : undefined, scrollbarWidth: "none", padding: `12px 16px ${wide ? 16 : 100}px`, display: "grid", alignContent: "start", gridTemplateColumns: "minmax(0,1fr)", gridAutoRows: "max-content", gap: 12 }}>
        {!access.canIssue ? (
          <OsNote icon={Lock} c={X.sub} bg={X.neub}>You can view this page but can't issue work. Issuing needs the outsource-issues:create permission.</OsNote>
        ) : null}
        <OsLabel icon={UserRound} l="Worker" />
        <WorkerBlock issue={issue} wide={wide} onOpenPicker={onOpenPicker} />
        <OsLabel icon={ScanQrCode} l="Sticker" pad="4px 4px 0" />
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <label style={{ flex: 1, minWidth: 0, height: 48, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 13px", background: X.inp, borderRadius: 14, boxShadow: `0 0 0 1px ${X.ln}`, opacity: canType ? 1 : 0.55 }}>
            <Barcode size={18} strokeWidth={1.75} color={PLACEHOLDER} style={{ flex: "none" }} />
            <input className="os-input" value={code} onChange={(e) => setCode(e.target.value)} disabled={!canType}
              placeholder="Type code if it won't scan" aria-label="Sticker code"
              inputMode="text" enterKeyHint="go" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: X.ink, padding: 0, letterSpacing: ".3px" }} />
          </label>
          <button type="submit" disabled={!canSubmit}
            style={{ flex: "none", height: 48, padding: "0 18px", borderRadius: 14, border: "none", background: canType && codeOk ? BRAND : X.chip, color: canType && codeOk ? "#FFFFFF" : X.mut, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: canSubmit ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6 }}>
            {issue.isIssuing ? <Spinner light={canType && codeOk} /> : null}Issue
          </button>
        </form>
        {fb ? <OsBanner view={fb} role={fb.tone === "danger" ? "alert" : "status"} /> : null}
        <OsLabel icon={ListChecks} l="Issued this session" r={n ? `${n} issued` : undefined} pad="6px 4px 0" />
        {n === 0 ? (
          <div style={{ padding: "22px 16px", borderRadius: 16, background: X.card, boxShadow: `0 0 0 1px ${X.ring}`, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, background: X.tint, display: "flex", alignItems: "center", justifyContent: "center" }}><ScanLine size={20} strokeWidth={1.9} color="var(--xo-br)" /></span>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Nothing issued yet</div>
            <div style={{ fontSize: 12.5, color: X.sub, lineHeight: 1.45 }}>Scan or type a sticker to issue it. This list clears when the page reloads.</div>
          </div>
        ) : (
          <div style={{ borderRadius: 16, background: X.card, boxShadow: LIST_SH, overflow: "hidden" }}>
            {issue.sessionIssues.map((item, i) => {
              const busy = issue.undoingId === item.id;
              const title = describeIssue(item);
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 8px 8px 14px", borderTop: i ? `1px solid ${X.ln}` : "none", opacity: busy ? 0.55 : 1 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, overflowWrap: "anywhere", ...NUM }}>{title}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: X.mut, marginTop: 1, ...ELLIPSIS }}>{item.departmentName} · to {shortWorkerName(item.workerName)}</span>
                  </span>
                  {access.canUndo ? (
                    <button type="button" disabled={busy || issue.undoingId !== ""} aria-label={`Undo ${title}`}
                      onClick={() => { onAction("undo"); void issue.undoIssue(item); }}
                      style={{ flex: "none", height: 40, padding: "0 12px", borderRadius: 999, border: "none", background: X.neub, color: X.sub, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                      <Undo2 size={14} strokeWidth={2.2} />{busy ? "Undoing…" : "Undo"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <OsBar inline={wide}>
        <button type="button" onClick={onOpenScanner} disabled={!canScan}
          style={{ width: "100%", height: 52, borderRadius: 14, border: "none", background: canScan ? BRAND : X.chip, color: canScan ? "#FFFFFF" : X.mut, fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: canScan ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ScanQrCode size={19} strokeWidth={2} />{scanLabel}
        </button>
      </OsBar>
    </section>
  );
}
