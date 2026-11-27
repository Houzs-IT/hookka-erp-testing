// ---------------------------------------------------------------------------
// Outsource Work (mobile): the Tracking tab — search + filter button, status
// chips with the server's counts, removable filter chips, the issue cards
// (Send back / Approve on pending ones), truncated note, Show more, and the
// loading / empty / error states. Filters and data are the hook's.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { ArrowDownUp, BadgeCheck, ChevronRight, CloudOff, Factory, PackageOpen, ScanLine, SearchX, TriangleAlert, Undo2, Check, Search, UserRound, X as XIcon } from "lucide-react";
import type { OutsourceIssueWithDone, UseOutsourceIssueResult } from "@/pages/production/use-outsource-issue";
import { LIST_CAP } from "@/pages/production/use-outsource-issue";
import { daysOut, formatDays, formatIssueDateTime, shortWorkerName } from "@/lib/outsource-issue-format";
import { STATUS_CHIPS, STATUS_STYLE, hasNarrowingFilters, isoDayToLabel, itemWithPiece, productLine } from "./os-format";
import { CheckPill, OsNote, OsSheet, OsSkel, OsState, StatusPill } from "./os-kit";
import { BRAND, ELLIPSIS, FIELD_SH, MUTED_ICON, NUM, PLACEHOLDER, PRIMARY_BTN, SECONDARY_BTN, X, chipStyle } from "./os-style";

export type ReviewAccess = { canApprove: boolean; canSendBack: boolean };
export type ReviewKind = "approve" | "back";

const PAGE = 20;

export function ReviewButtons({ access, onAsk, big }: { access: ReviewAccess; onAsk: (kind: ReviewKind) => void; big?: boolean }) {
  if (!access.canApprove && !access.canSendBack) return null;
  const both = access.canApprove && access.canSendBack;
  const h = big ? 50 : 44;
  const fs = big ? 14 : 13;
  return (
    <div style={{ display: "grid", gridTemplateColumns: both ? "minmax(0,1fr) minmax(0,1.4fr)" : "minmax(0,1fr)", gap: 8 }}>
      {access.canSendBack ? (
        <button type="button" onClick={() => onAsk("back")} style={{ ...SECONDARY_BTN, height: h, fontSize: fs, borderRadius: big ? 14 : 12 }}>
          <Undo2 size={big ? 16 : 15} strokeWidth={2.2} />Send back
        </button>
      ) : null}
      {access.canApprove ? (
        <button type="button" onClick={() => onAsk("approve")} style={{ ...PRIMARY_BTN, height: h, fontSize: fs, borderRadius: big ? 14 : 12 }}>
          <Check size={big ? 16 : 15} strokeWidth={2.6} />Approve
        </button>
      ) : null}
    </div>
  );
}

function IssueCard({ item, selected, access, onOpen, onAsk }: {
  item: OutsourceIssueWithDone; selected: boolean; access: ReviewAccess; onOpen: () => void; onAsk: (kind: ReviewKind) => void;
}) {
  const st = STATUS_STYLE[item.status];
  const isCompleted = item.status === "COMPLETED";
  const needsCheck = item.status === "INCOMPLETE" && item.workDone;
  const days = daysOut(item);
  const old = !isCompleted && days !== null && days >= 7;
  const showActs = item.status === "PENDING_APPROVAL" && (access.canApprove || access.canSendBack);
  return (
    <div style={{ position: "relative", overflow: "hidden", background: X.card, borderRadius: 16, boxShadow: selected ? `0 0 0 2px ${BRAND},0 12px 28px -16px ${X.shd}` : `0 0 0 1px ${X.ring},0 12px 28px -16px ${X.shd}` }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: st.c }} />
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        aria-label={`${item.poNo} ${item.itemLabel}, ${st.l}`} style={{ padding: "12px 14px 10px 17px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 0, ...ELLIPSIS, ...NUM }}>{item.poNo}</span>
          <StatusPill status={item.status} />
          {needsCheck ? <CheckPill /> : null}
          <span style={{ flex: 1 }} />
          <ChevronRight size={17} strokeWidth={1.9} color={MUTED_ICON} style={{ flex: "none" }} />
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginTop: 5, lineHeight: 1.35, overflowWrap: "anywhere" }}>{itemWithPiece(item)}</div>
        {productLine(item) ? <div style={{ fontSize: 12, color: X.mut, marginTop: 1, overflowWrap: "anywhere" }}>{productLine(item)}</div> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 7, fontSize: 12.5, color: X.sub }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%" }}><UserRound size={13} strokeWidth={2} color={MUTED_ICON} style={{ flex: "none" }} /><span style={ELLIPSIS}>{shortWorkerName(item.workerName)}</span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%" }}><Factory size={13} strokeWidth={2} color={MUTED_ICON} style={{ flex: "none" }} /><span style={ELLIPSIS}>{item.departmentName}</span></span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, marginTop: 9 }}>
          <div style={{ minWidth: 0, padding: "6px 9px", borderRadius: 10, background: X.bg }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: MUTED_ICON, textTransform: "uppercase" }}>Issued</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 1, ...ELLIPSIS, ...NUM }}>{formatIssueDateTime(item.issuedAt)}</div>
          </div>
          <div style={{ minWidth: 0, padding: "6px 9px", borderRadius: 10, background: old ? X.warnb : X.bg }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".4px", color: MUTED_ICON, textTransform: "uppercase" }}>{isCompleted ? "Took" : "Days out"}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 1, color: old ? X.warn : X.ink, ...NUM }}>{formatDays(days)}</div>
          </div>
        </div>
        {item.submittedAt ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11.5, color: X.mut }}>
            <ScanLine size={12} strokeWidth={2.2} color="var(--xo-info)" style={{ flex: "none" }} /><span style={ELLIPSIS}>Finished scan {formatIssueDateTime(item.submittedAt)}</span>
          </div>
        ) : null}
        {item.completedAt ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11.5, color: X.mut }}>
            <BadgeCheck size={12} strokeWidth={2.2} color="var(--xo-ok)" style={{ flex: "none" }} /><span style={ELLIPSIS}>Approved {formatIssueDateTime(item.completedAt)}{item.approvedBy ? ` · ${item.approvedBy}` : ""}</span>
          </div>
        ) : null}
      </div>
      {showActs ? <div style={{ padding: "0 14px 12px 17px" }}><ReviewButtons access={access} onAsk={onAsk} /></div> : null}
    </div>
  );
}

function FilterSheet({ issue, onClose }: { issue: UseOutsourceIssueResult; onClose: () => void }) {
  const [draft, setDraft] = useState({ workerId: issue.filters.workerId, from: issue.filters.from, to: issue.filters.to });
  const bad = !!(draft.from && draft.to && draft.from > draft.to);
  const workers = [{ id: "", name: "All workers" }, ...issue.workers.map((w) => ({ id: w.id, name: shortWorkerName(w.name) }))];
  const dateField = (l: string, k: "from" | "to") => (
    <label style={{ display: "block", minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 12, color: X.mut, marginBottom: 4 }}>{l}</span>
      <input type="date" value={draft[k]} onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [k]: v })); }} aria-label={`Issued ${l.toLowerCase()}`}
        style={{ width: "100%", height: 44, boxSizing: "border-box", padding: "0 10px", borderRadius: 12, border: "none", background: X.inp, boxShadow: bad ? `0 0 0 1.5px ${X.bad}` : `0 0 0 1px ${X.ln}`, fontFamily: "inherit", fontSize: 15, color: X.ink, colorScheme: "light dark" }} />
    </label>
  );
  return (
    <OsSheet open onClose={onClose} title="Filter issues">
      <div className="os-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px calc(26px + env(safe-area-inset-bottom))", scrollbarWidth: "none" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: X.br, margin: "0 2px 8px" }}>WORKER</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {workers.map((w) => (
            <button key={w.id || "all"} type="button" aria-pressed={draft.workerId === w.id} onClick={() => setDraft((d) => ({ ...d, workerId: w.id }))}
              style={{ ...chipStyle(draft.workerId === w.id), height: 36, padding: "0 14px", fontSize: 13, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
              {w.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: X.br, margin: "18px 2px 8px" }}>ISSUED DATE</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
          {dateField("From", "from")}
          {dateField("To", "to")}
        </div>
        {bad ? <div role="alert" style={{ marginTop: 6, fontSize: 11.5, color: X.bad }}>From must be on or before To.</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 8, marginTop: 20 }}>
          <button type="button" onClick={() => setDraft({ workerId: "", from: "", to: "" })} style={{ ...SECONDARY_BTN, height: 48 }}>Reset</button>
          <button type="button" disabled={bad} onClick={() => { issue.setFilters(draft); onClose(); }}
            style={{ ...PRIMARY_BTN, height: 48, opacity: bad ? 0.5 : 1, cursor: bad ? "default" : "pointer" }}>Show results</button>
        </div>
      </div>
    </OsSheet>
  );
}

export function TrackingList({ issue, access, selectedId, wide, updated, onOpen, onAsk }: {
  issue: UseOutsourceIssueResult;
  access: ReviewAccess;
  selectedId: string;
  wide: boolean;
  updated: string;
  onOpen: (item: OutsourceIssueWithDone) => void;
  onAsk: (kind: ReviewKind, item: OutsourceIssueWithDone) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const f = issue.filters;
  const fkey = `${f.status}|${f.workerId}|${f.from}|${f.to}|${f.query}`;
  const [page, setPage] = useState({ key: fkey, n: PAGE });
  const shown = page.key === fkey ? page.n : PAGE;

  const counts = issue.statusCounts;
  const narrowing = hasNarrowingFilters(f);
  const filterWorker = issue.workers.find((w) => w.id === f.workerId);
  const fN = (f.workerId ? 1 : 0) + (f.from || f.to ? 1 : 0);
  const clearAll = () => issue.setFilters({ query: "", workerId: "", from: "", to: "" });
  const statusLabel = STATUS_CHIPS.find((c) => c.key === f.status)?.label ?? "";

  const loadingFirst = issue.isListLoading && issue.issues.length === 0 && !issue.listError;
  let state: { icon: typeof CloudOff; c: string; bg: string; t: string; s: string; btn?: { l: string; onTap: () => void } | null; role?: "alert" | "note" } | null = null;
  if (issue.listError) {
    state = { icon: CloudOff, c: X.bad, bg: X.badb, t: "Couldn't load issues", s: issue.listError, btn: { l: "Try again", onTap: issue.refreshList }, role: "alert" };
  } else if (!loadingFirst && issue.issues.length === 0 && !issue.isListLoading) {
    if (counts?.ALL === 0 && !narrowing) {
      state = { icon: PackageOpen, c: X.br, bg: X.tint, t: "No outsource work yet", s: "Issued pieces show here once you scan them on the Issue tab." };
    } else if (narrowing) {
      state = { icon: SearchX, c: X.br, bg: X.tint, t: "No issues match", s: "Try another search, worker or date.", btn: { l: "Clear filters", onTap: clearAll } };
    } else {
      state = { icon: SearchX, c: X.br, bg: X.tint, t: f.status === "ALL" ? "Nothing here" : `Nothing ${statusLabel.toLowerCase()}`, s: "Try another status chip." };
    }
  }
  const list = issue.issues;
  const n = list.length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
        <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: X.card, borderRadius: 14, boxShadow: FIELD_SH }}>
          <Search size={18} strokeWidth={1.75} color={PLACEHOLDER} style={{ flex: "none" }} />
          <input className="os-input" type="search" value={f.query} onChange={(e) => issue.setFilters({ query: e.target.value })} placeholder="PO, product, item or worker" aria-label="Search tracking" autoComplete="off"
            style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: X.ink, padding: 0 }} />
          {f.query ? (
            <button type="button" onClick={() => issue.setFilters({ query: "" })} aria-label="Clear search"
              style={{ width: 36, height: 36, flex: "none", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.mut }}>
              <XIcon size={15} strokeWidth={2.2} />
            </button>
          ) : null}
        </label>
        <button type="button" onClick={() => setFilterOpen(true)} aria-label={fN ? `Filters, ${fN} on` : "Filters"}
          style={{ position: "relative", width: 44, height: 44, flex: "none", borderRadius: "50%", border: "none", background: X.card, color: X.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: FIELD_SH }}>
          <ArrowDownUp size={17} strokeWidth={1.9} />
          {fN ? <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: BRAND, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{fN}</span> : null}
        </button>
      </div>
      <div className="os-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 4px", scrollbarWidth: "none" }}>
        {STATUS_CHIPS.map((c) => {
          const on = f.status === c.key;
          const dot = c.key === "ALL" ? null : STATUS_STYLE[c.key].c;
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => issue.setFilters({ status: c.key })} style={chipStyle(on)}>
              {dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} /> : null}
              {c.label}
              {counts ? <span style={{ opacity: 0.8, ...NUM }}>{counts[c.key]}</span> : null}
            </button>
          );
        })}
      </div>
      {fN ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 16px 0" }}>
          {f.workerId ? (
            <button type="button" onClick={() => issue.setFilters({ workerId: "" })} aria-label="Remove worker filter"
              style={{ height: 30, maxWidth: "100%", padding: "0 9px 0 12px", borderRadius: 999, border: "none", background: X.prit, color: X.br, fontFamily: "inherit", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <span style={ELLIPSIS}>{filterWorker ? shortWorkerName(filterWorker.name) : "Worker"}</span><XIcon size={12} strokeWidth={2.4} style={{ flex: "none" }} />
            </button>
          ) : null}
          {f.from || f.to ? (
            <button type="button" onClick={() => issue.setFilters({ from: "", to: "" })} aria-label="Remove date filter"
              style={{ height: 30, padding: "0 9px 0 12px", borderRadius: 999, border: "none", background: X.prit, color: X.br, fontFamily: "inherit", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              {f.from ? isoDayToLabel(f.from) : "Any"} – {f.to ? isoDayToLabel(f.to) : "Any"}<XIcon size={12} strokeWidth={2.4} />
            </button>
          ) : null}
        </div>
      ) : null}

      {loadingFirst ? <div style={{ position: "relative", padding: "12px 16px" }}><OsSkel n={3} /></div> : null}
      {state ? (
        <div style={{ padding: 16 }}>
          <OsState icon={state.icon} c={state.c} bg={state.bg} t={state.t} s={state.s} btn={state.btn} role={state.role} />
        </div>
      ) : null}
      {!state && !loadingFirst && n > 0 ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px 6px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: X.br, whiteSpace: "nowrap", ...NUM }}>{n} ISSUE{n === 1 ? "" : "S"}</span>
            <span style={{ flex: 1, height: 1, background: X.ln }} />
            <span role="status" style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: X.mut }}>{issue.isListLoading ? "Refreshing…" : updated}</span>
          </div>
          {issue.isListTruncated ? (
            <div style={{ margin: "0 16px 8px" }}>
              <OsNote icon={TriangleAlert} c={X.warn} bg={X.warnb}>Showing the newest {LIST_CAP} issues only. Narrow the dates or pick a worker to see the rest.</OsNote>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, padding: `0 16px ${wide ? 20 : 20}px` }}>
            {list.slice(0, shown).map((item) => (
              <IssueCard key={item.id} item={item} selected={wide && selectedId === item.id} access={access}
                onOpen={() => onOpen(item)} onAsk={(kind) => onAsk(kind, item)} />
            ))}
          </div>
          {n > shown ? (
            <div style={{ padding: "0 16px 20px" }}>
              <button type="button" onClick={() => setPage({ key: fkey, n: shown + PAGE })}
                style={{ width: "100%", height: 44, borderRadius: 999, border: "none", background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 6px 14px -8px ${X.shd}`, color: X.br, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Show more · {n - shown} left
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {filterOpen ? <FilterSheet issue={issue} onClose={() => setFilterOpen(false)} /> : null}
    </div>
  );
}
