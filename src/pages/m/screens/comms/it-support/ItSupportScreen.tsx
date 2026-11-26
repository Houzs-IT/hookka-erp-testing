// ---------------------------------------------------------------------------
// /m/it-support — IT Support v3 (Batch 2, approved Claude Design prototype
// "IT Support (standalone)", 2026-11-26). Phone, tablet and foldable; light
// and dark. Replaces the embedded desktop page.
//
// Views by query string, the same links desktop uses:
//   (none)          my requests (All / Active / Resolved, search, filter)
//   ?new=1[&from=]  report a problem (ItReportForm)
//   ?sent=CODE      "Request sent"
//   ?ticket=CODE    one request (ItTicket); on a tablet beside the list
//
// Every login sees only its own requests: the server reads the reporter off
// the session (src/api/routes/it-support.ts). A failed load is shown as one,
// with the server's own message (e.g. "IT Support is not connected yet…").
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, CloudOff, Inbox, Plus, RotateCw, SearchX, UserRound, X } from "lucide-react";
import { useInterval } from "@/lib/scheduler";
import { useResponsiveLayout } from "../../../lib/responsive-layout";
import {
  BTN, C, CardGrid, Chip, Column, CommsHeader, CommsScreen, CommsSheet, CommsSplit, CountBadge, CountLine, FilterButton, GhostButton, NUM,
  PrimaryButton, RoundPlus, SearchField, Segmented, SheetFooter, Skeletons, StateCard, fmtAgo, fmtDay,
} from "../comms-kit";
import {
  PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, emptyText, filterTickets, inTab, listCountLabel, priorityTone, readTickets, statusTone, tabCounts,
  type Priority, type Status, type Tab, type TicketRow,
} from "./it-lib";
import { itApi } from "./it-api";
import { PRIORITY_ICON } from "./it-ui";
import { ItTicket } from "./ItTicket";
import { ItReportForm } from "./ItReportForm";

export default function ItSupportScreen() {
  const [params, setParams] = useSearchParams();
  const ticket = params.get("ticket") ?? "";
  const isNew = params.get("new") === "1";
  const sent = params.get("sent") ?? "";
  const from = params.get("from") ?? "";
  const layout = useResponsiveLayout();

  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [listError, setListError] = useState("");
  const loadList = useCallback(async () => {
    const res = await itApi<{ tickets: unknown[] }>("/tickets");
    if (res.ok) {
      setRows(readTickets(res.data));
      setListError("");
    } else {
      setListError(res.error);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount (desktop pattern)
    void loadList();
  }, [loadList]);
  useInterval(loadList, 60_000);

  const go = useCallback((next: Record<string, string>, replace = false) => setParams(next, { replace }), [setParams]);
  const openTicket = (code: string) => go({ ticket: code });
  const openNew = () => go({ new: "1" });

  if (isNew) {
    return (
      <ItReportForm
        from={from}
        onCancel={() => go({}, true)}
        onSent={(code) => {
          void loadList();
          go({ sent: code }, true);
        }}
      />
    );
  }
  if (sent) return <SentPage code={sent} onView={() => go({ ticket: sent }, true)} onBack={() => go({}, true)} />;

  const list = <TicketList rows={rows} error={listError} onRetry={loadList} selected={ticket} onOpen={openTicket} onNew={openNew} />;
  if (ticket) {
    const detail = <ItTicket key={ticket} code={ticket} onChanged={loadList} onBack={() => go({})} onNew={openNew} />;
    return layout.canSplitDetail ? <CommsSplit left={list} right={detail} /> : detail;
  }
  return list;
}

function TicketList({ rows, error, onRetry, selected, onOpen, onNew }: { rows: TicketRow[] | null; error: string; onRetry: () => Promise<void>; selected: string; onOpen: (code: string) => void; onNew: () => void }) {
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [fS, setFS] = useState<Status[]>([]);
  const [fU, setFU] = useState<Priority[]>([]);
  const [draft, setDraft] = useState<{ s: Status[]; u: Priority[] } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const all = rows ?? [];
  const counts = useMemo(() => tabCounts(all), [all]);
  const shown = useMemo(() => filterTickets(all, { tab, q, statuses: fS, priorities: fU }), [all, tab, q, fS, fU]);
  const unread = all.filter((r) => r.unread).length;
  const fN = fS.length + fU.length;
  const filtering = !!q.trim() || fN > 0;
  const draftN = draft ? all.filter((r) => inTab(r, tab) && (!draft.s.length || draft.s.includes(r.status)) && (!draft.u.length || draft.u.includes(r.priority))).length : 0;
  const retry = async () => {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  };

  const loading = rows === null && !error;
  const failed = rows === null && !!error;

  return (
    <CommsScreen>
      <CommsHeader title="IT Support" badge={<CountBadge n={unread} label={`${unread} new ${unread === 1 ? "reply" : "replies"}`} />} trailing={<RoundPlus label="Report a problem" onClick={onNew} />} />
      <Column>
        {rows && rows.length === 0 ? (
          <div style={{ padding: "12px 16px 0" }}>
            <section aria-labelledby="it-empty" style={{ padding: "36px 22px 32px", borderRadius: 20, background: C.card, boxShadow: "var(--c-sh-card)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <NoTicketsArt />
              <h2 id="it-empty" style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-.2px", color: C.ink }}>Nothing sent to IT yet</h2>
              <p style={{ margin: 0, maxWidth: 300, fontSize: 13.5, lineHeight: 1.5, color: C.body }}>When something in the system is not working, or you need a change, report it here. IT replies on this page.</p>
              <PrimaryButton height={46} onClick={onNew} icon={Plus} style={{ width: "auto", padding: "0 20px 0 16px", borderRadius: 999, fontSize: 14, marginTop: 6 }}>
                Report a problem
              </PrimaryButton>
            </section>
          </div>
        ) : (
          <>
            <div style={{ padding: "6px 18px 0" }}>
              <Segmented label="Requests" height={46} radius={14} value={tab} onChange={setTab}
                items={[{ key: "all", label: "All", count: rows ? counts.all : "" }, { key: "active", label: "Active", count: rows ? counts.active : "" }, { key: "resolved", label: "Resolved", count: rows ? counts.resolved : "" }]} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px 0" }}>
              <SearchField value={q} onChange={setQ} placeholder="Code, title, handler, status" label="Search requests" />
              <FilterButton size={44} count={fN} onClick={() => setDraft({ s: fS.slice(), u: fU.slice() })} />
            </div>
            {fN ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px 0" }}>
                {fS.map((k) => <RemovableChip key={k} label={STATUS_LABEL[k]} onRemove={() => setFS((l) => l.filter((x) => x !== k))} />)}
                {fU.map((k) => <RemovableChip key={k} label={`${PRIORITY_LABEL[k]} urgency`} onRemove={() => setFU((l) => l.filter((x) => x !== k))} />)}
                <button type="button" onClick={() => { setFS([]); setFU([]); }} style={{ ...BTN, height: 30, padding: "0 6px", background: "none", color: C.gold, fontSize: 12, fontWeight: 700 }}>Clear all</button>
              </div>
            ) : null}
          </>
        )}

        <div style={{ padding: "0 16px 32px" }}>
          {error && rows ? (
            <div role="alert" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5, lineHeight: 1.4 }}>
              <CloudOff size={16} strokeWidth={2} style={{ flex: "none" }} />
              <span style={{ flex: 1 }}>Couldn't refresh: {error}</span>
              <button type="button" onClick={retry} style={{ ...BTN, background: "none", color: C.red, fontSize: 12.5, fontWeight: 700 }}>{retrying ? "Trying…" : "Try again"}</button>
            </div>
          ) : null}
          {loading ? (
            <div style={{ paddingTop: 16 }}><Skeletons label="Loading requests" /></div>
          ) : failed ? (
            <div style={{ paddingTop: 18 }}>
              <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load your requests" text={error}
                action={<PrimaryButton height={44} busy={retrying} icon={RotateCw} onClick={retry} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5, marginTop: 4 }}>Try again</PrimaryButton>} />
            </div>
          ) : rows && rows.length > 0 && shown.length === 0 ? (
            <div style={{ paddingTop: 18 }}>
              <StateCard icon={filtering ? SearchX : Inbox} title={emptyText(tab, filtering)}
                action={filtering ? <GhostButton onClick={() => { setQ(""); setFS([]); setFU([]); }}>Clear search and filters</GhostButton> : null} />
            </div>
          ) : rows && shown.length ? (
            <>
              <CountLine label={listCountLabel(shown.length, counts[tab], filtering)} style={{ padding: "16px 4px 8px" }} />
              <CardGrid>
                {shown.map((t) => <TicketCard key={t.code} t={t} on={t.code === selected} onOpen={() => onOpen(t.code)} />)}
              </CardGrid>
            </>
          ) : null}
        </div>
      </Column>

      <CommsSheet open={draft !== null} onClose={() => setDraft(null)} title="Filter requests"
        footer={draft ? <SheetFooter onReset={() => setDraft({ s: [], u: [] })} onApply={() => { setFS(draft.s); setFU(draft.u); setDraft(null); }} applyLabel={draftN === 1 ? "Show 1 request" : `Show ${draftN} requests`} /> : null}>
        {draft ? (
          <div style={{ padding: "4px 16px 0", display: "grid", gap: 18 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Status</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {STATUSES.map((k) => {
                  const on = draft.s.includes(k);
                  return <Chip key={k} role="checkbox" on={on} label={STATUS_LABEL[k]} dot={statusTone(k).dot} onClick={() => setDraft((d) => d && { ...d, s: on ? d.s.filter((x) => x !== k) : [...d.s, k] })} />;
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Urgency</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PRIORITIES.map((k) => {
                  const on = draft.u.includes(k);
                  return <Chip key={k} role="checkbox" on={on} label={PRIORITY_LABEL[k]} dot={priorityTone(k).fg} onClick={() => setDraft((d) => d && { ...d, u: on ? d.u.filter((x) => x !== k) : [...d.u, k] })} />;
                })}
              </div>
            </div>
          </div>
        ) : null}
      </CommsSheet>
    </CommsScreen>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} style={{ ...BTN, height: 30, padding: "0 9px 0 12px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
      {label}<X size={12} strokeWidth={2.4} />
    </button>
  );
}

function TicketCard({ t, on, onOpen }: { t: TicketRow; on: boolean; onOpen: () => void }) {
  const st = statusTone(t.status);
  const ur = priorityTone(t.priority);
  const UrIcon = PRIORITY_ICON[t.priority];
  return (
    <button type="button" onClick={onOpen} className="c-press" aria-current={on || undefined}
      aria-label={`${t.code}, ${t.title}, ${STATUS_LABEL[t.status]}${t.unread ? ", new reply" : ""}`}
      style={{ ...BTN, position: "relative", overflow: "hidden", width: "100%", textAlign: "left", background: C.card, color: C.ink, borderRadius: 18, padding: "13px 14px 12px 17px", boxShadow: on ? "0 0 0 2px var(--c-gold), var(--c-sh-card)" : t.unread ? "var(--c-sh-card-unread)" : "var(--c-sh-card)", display: "block" }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: st.dot }} />
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gold, letterSpacing: ".2px", ...NUM }}>{t.code}</span>
        {t.unread ? (
          <span style={{ height: 18, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 7px", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 10, fontWeight: 700 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFFFFF" }} />New reply
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>{fmtAgo(t.updatedAt)}</span>
      </span>
      <span style={{ display: "block", marginTop: 6, fontSize: 15, fontWeight: t.unread ? 800 : 700, letterSpacing: "-.2px", lineHeight: 1.35, color: C.ink, wordBreak: "break-word" }}>{t.title || "—"}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
        <span style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 999, background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />{STATUS_LABEL[t.status]}
        </span>
        <span style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 999, background: C.card, boxShadow: `inset 0 0 0 1px ${ur.ring}`, color: ur.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
          <UrIcon size={11} strokeWidth={2.4} />{PRIORITY_LABEL[t.priority]}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.track}`, fontSize: 11.5, color: C.muted, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", color: t.assignee ? C.body : C.faint }}>
          <UserRound size={12} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.assignee || "Not picked up yet"}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ flex: "none", whiteSpace: "nowrap" }}>Sent {fmtDay(t.createdAt)}</span>
      </span>
    </button>
  );
}

function SentPage({ code, onView, onBack }: { code: string; onView: () => void; onBack: () => void }) {
  return (
    <CommsScreen>
      <Column max={480}>
        <div role="status" aria-label="Request sent" className="c-anim" style={{ minHeight: "calc(100dvh - 160px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 28px 60px", textAlign: "center", animation: "c-pop .22s ease-out", boxSizing: "border-box" }}>
          <span style={{ width: 72, height: 72, borderRadius: 24, background: C.gradOk, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 18px 30px -14px rgba(79,124,58,.7)" }}>
            <Check size={34} strokeWidth={2.6} color="#FFFFFF" />
          </span>
          <div style={{ marginTop: 18, fontSize: 20, fontWeight: 700, letterSpacing: "-.3px" }}>Request sent</div>
          <div style={{ marginTop: 10, height: 30, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 999, background: C.card, boxShadow: "var(--c-sh-panel)", fontSize: 14, fontWeight: 800, color: C.gold, ...NUM }}>{code}</div>
          <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: C.body }}>IT will pick it up. You'll see their replies here.</div>
          <PrimaryButton style={{ marginTop: 24 }} onClick={onView}>View request</PrimaryButton>
          <button type="button" onClick={onBack} style={{ ...BTN, marginTop: 10, width: "100%", height: 46, borderRadius: 14, background: "transparent", color: C.gold, fontSize: 14, fontWeight: 700 }}>Back to my requests</button>
        </div>
      </Column>
    </CommsScreen>
  );
}

/** Desktop NoTicketsArt, drawn in the prototype's tones (fixed illustration colours). */
function NoTicketsArt() {
  return (
    <svg viewBox="0 0 180 150" width={176} height={144} aria-hidden="true">
      <ellipse cx="88" cy="84" rx="70" ry="58" fill="#F1E4CC" />
      <g transform="rotate(-8 84 78)" stroke="#6B5C32" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="46" y="30" width="76" height="98" rx="8" fill="#FBF6EE" />
        <rect x="68" y="22" width="32" height="16" rx="5" fill="#C9A86A" />
        <path d="M58 58l5 5 9-10M58 82l5 5 9-10M58 106l5 5 9-10" fill="none" />
        <path d="M80 58h28M80 82h28M80 106h20" stroke="#D9BE8C" strokeWidth="5" />
      </g>
      <g transform="translate(-12 4) rotate(40 132 82)" stroke="#6B5C32" strokeWidth="3" strokeLinejoin="round">
        <rect x="126" y="72" width="12" height="54" rx="6" fill="#C9A86A" />
        <path d="M120 58a14 14 0 1 0 24 0v12h-24z" fill="#C9A86A" />
        <rect x="127" y="50" width="10" height="14" fill="#F1E4CC" stroke="none" />
      </g>
      <path d="M140 22l4-8M152 32l8-4M150 46h8" stroke="#C9A86A" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
