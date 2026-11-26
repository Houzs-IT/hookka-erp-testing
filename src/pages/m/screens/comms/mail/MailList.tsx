// ---------------------------------------------------------------------------
// /m/mail-center — the list (Mail Center v3, approved prototype "Mail Centre
// (standalone)" revised). Folders, mailbox / department filter, labels,
// category tabs, search over the loaded rows, row actions, multi-select,
// Load more, Drafts (this device), Auto-sent outbox.
//
// Server rules are desktop's (src/pages/mail-center/index.tsx): folder →
// GET /threads params, 100 per page, client-side search / Starred / department
// / category; unread counts come from the loaded rows only. Every thread
// change is the desktop PATCH helper. What the user may not do is hidden:
// update = star / read / archive / trash / labels; create = send + new label;
// delete = delete a label. No Undo: the API has none.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownUp, Bell, Check, ChevronDown, CloudOff, CornerUpRight, EllipsisVertical, FilePen, Inbox, Info, Layers, Mail, MailOpen, MailX, Plus, RotateCw,
  SearchX, Star, Tag, Trash2, Undo2, User, X, type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { ResponsiveActionDock } from "../../../components";
import { useResponsiveLayout } from "../../../lib/responsive-layout";
import { BTN, C, Column, CommsHeader, CommsScreen, CountBadge, CountLine, GhostButton, InfoNote, NUM, PrimaryButton, SearchField, Segmented, Spinner, StateCard, useToast } from "../comms-kit";
import { ConfirmDialog, type ConfirmSpec } from "../comms-overlay";
import {
  CANONICAL_DEPT_MAILBOXES, FOLDER_LABEL, OUTBOX_FILTERS, sortDepts, byCategory, cleanSnippet, deptGroups, emptyCopy, fullWhen, hasLabel, isConvFolder, isFolder, labelColor, labelList, listWhen,
  mailboxName, narrowThreads, outboxStatusLabel, outboxWhen, senderLabel, threadsUrl, type Folder, type MailLabel, type MailThread, type OutboxCounts, type OutboxItem,
} from "./mail-lib";
import {
  createDeptMailbox, deleteDraft, deleteLabel, fetchThreadsPage, patchManyAddLabel, patchManyStatus, patchManyTrashed, patchManyUnread, patchThreadStarred,
  patchThreadStatus, patchThreadTrashed, patchThreadUnread, postTestInject, refreshThreads, useDrafts, useMailCtx, usePrefs, createLabel, type MailCtx,
} from "./mail-api";
import { setList, useListState } from "./mail-store";
import { ActionSheet, FOLDER_ICON, FoldersSheet, LabelPickSheet, LabelsSheet, SeeSheet, ViewSheet, type FolderTileInfo } from "./MailSheets";
import { Avatar, MiniPill, RoundBtn, useMailNav } from "./mail-ui";
import { takeFlash } from "./mail-store";

type Sheet =
  | null
  | { t: "folders" }
  | { t: "see" }
  | { t: "view" }
  | { t: "labels"; apply?: string[] }
  | { t: "pick"; ids: string[]; mode: "add" | "bulk" }
  | { t: "row"; id: string };

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const OUTBOX_TONE: Record<string, [string, string]> = {
  SENT: ["var(--c-green)", "var(--c-green-bg)"],
  FAILED: ["var(--c-red)", "var(--c-red-bg)"],
  SENDING: ["var(--c-teal)", "var(--c-teal-bg)"],
  RETRYING: ["var(--c-amber)", "var(--c-amber-bg)"],
  PENDING: ["var(--c-grey)", "var(--c-grey-bg)"],
};
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const outboxTone = (s: string) => OUTBOX_TONE[(s || "").toUpperCase()] ?? OUTBOX_TONE.PENDING;

export function MailList({ selectedId = "" }: { selectedId?: string }) {
  const ctx = useMailCtx();
  const nav = useMailNav();
  const [params] = useSearchParams();
  const st = useListState();
  const prefs = usePrefs();
  const drafts = useDrafts();
  const layout = useResponsiveLayout();
  const phone = layout.mode === "phone";
  const [toast, showToast] = useToast();
  useEffect(() => {
    const m = takeFlash();
    if (m) showToast(m);
  }, [showToast]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [selOn, setSelOn] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [spin, setSpin] = useState(false);
  const [injecting, setInjecting] = useState(false);

  // ?folder= deep link (e.g. /m/mail-center?folder=autosent).
  const linkFolder = params.get("folder");
  useEffect(() => {
    if (isFolder(linkFolder)) setList({ folder: linkFolder });
  }, [linkFolder]);

  const folder: Folder = st.folder ?? (ctx.myAddress ? "my-inbox" : "inbox");
  const conv = isConvFolder(folder);
  const listUrl = threadsUrl(folder, { myAddress: ctx.myAddress, mailbox: st.mailbox, label: st.label });
  const threadsQ = useCachedJson<MailThread[]>(conv && !ctx.noMailbox ? listUrl : null, 60);

  // "Load more" pages, keyed on the URL so a folder / filter change drops them.
  const [extra, setExtra] = useState<{ key: string; rows: MailThread[]; done: boolean; loading: boolean }>({ key: "", rows: [], done: false, loading: false });
  const first = threadsQ.data;
  const threads = useMemo(() => (first ? (extra.key === listUrl ? [...first, ...extra.rows] : first) : null), [first, extra, listUrl]);
  const hasMore = !!first && first.length >= 100 && !(extra.key === listUrl && extra.done);
  const loadMore = async () => {
    if (!threads || extra.loading) return;
    setExtra((p) => ({ key: listUrl, rows: p.key === listUrl ? p.rows : [], done: false, loading: true }));
    const page = await fetchThreadsPage(listUrl, threads.length);
    setExtra((p) => ({ key: listUrl, rows: [...(p.key === listUrl ? p.rows : []), ...(page ?? [])], done: page != null && page.length < 100, loading: false }));
    if (page == null) showToast("Couldn't load more. Please try again.");
  };

  const groups = useMemo(() => deptGroups(ctx.addresses), [ctx.addresses]);
  // SUPER_ADMIN also sees the canonical Support / Finance / HR departments, so a
  // missing shared box can be set up (desktop departmentGroups).
  const sheetGroups = useMemo(() => {
    if (!ctx.isSuperAdmin) return groups;
    const have = new Set(groups.map((g) => g.dept));
    const extra = CANONICAL_DEPT_MAILBOXES.filter((c) => !have.has(c.dept)).map((c) => ({ dept: c.dept, mailboxes: [] }));
    return [...groups, ...extra].sort((a, b) => sortDepts(a.dept, b.dept));
  }, [groups, ctx.isSuperAdmin]);
  const deptAddresses = useMemo(() => (st.mailbox.kind === "dept" ? new Set(groups.find((g) => g.dept === (st.mailbox as { value: string }).value)?.mailboxes.map((m) => m.address) ?? []) : null), [groups, st.mailbox]);
  const live = useMemo(() => (threads ?? []).filter((t) => !t.trashedAt), [threads]);
  const narrowed = useMemo(() => narrowThreads(threads ?? [], { folder, deptAddresses, label: st.label, q: st.q }), [threads, folder, deptAddresses, st.label, st.q]);
  const showCats = prefs.categoryTabs && conv;
  const rows = useMemo(() => (showCats ? byCategory(narrowed, st.cat) : narrowed), [narrowed, showCats, st.cat]);
  const unreadAll = live.filter((t) => t.unread).length;
  const unreadByMailbox = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of live) if (t.unread) m.set(t.mailboxAddress, (m.get(t.mailboxAddress) ?? 0) + 1);
    return m;
  }, [live]);
  const labelNames = useMemo(() => labelList(ctx.labels, live), [ctx.labels, live]);
  const filtering = !!st.q.trim() || !!st.label;
  const selected = rows.filter((t) => selIds.has(t.id));

  // Outbox (Auto-sent) — desktop OutboxPanel: GET /outbox?status=.
  const outboxQ = useCachedJson<{ rows: OutboxItem[]; counts: OutboxCounts }>(folder === "autosent" && !ctx.noMailbox ? `/api/mail-center/outbox${st.outboxFilter ? `?status=${st.outboxFilter}` : ""}` : null, 30);

  const pick = (f: Folder) => {
    setList({ folder: f, cat: "all" });
    setSelOn(false);
    setSelIds(new Set());
    setSheet(null);
  };
  const refresh = async () => {
    setSpin(true);
    if (folder === "autosent") outboxQ.refresh();
    else refreshThreads();
    setTimeout(() => setSpin(false), 700);
  };

  // ---- single-thread actions (desktop onRowAction) ----
  const act = async (fn: () => Promise<boolean>, okMsg: string, failMsg = "Couldn't update. Please try again.") => {
    const ok = await fn();
    showToast(ok ? okMsg : failMsg);
    return ok;
  };
  const askTrash = (ids: string[], after?: () => void) =>
    setConfirm({
      title: ids.length === 1 ? "Move to Trash?" : `Move ${ids.length} conversations to Trash?`,
      body: ids.length === 1 ? "This conversation moves to the Trash folder. You can restore it from there." : "They'll move to the Trash folder. You can restore them from there.",
      okLabel: "Move to Trash",
      danger: true,
      icon: Trash2,
      onOk: async () => {
        setBusy(true);
        const ok = ids.length === 1 ? ((await patchThreadTrashed(ids[0], true)) ? 1 : 0) : await patchManyTrashed(ids, true);
        setBusy(false);
        setConfirm(null);
        showToast(ok === ids.length ? (ids.length === 1 ? "Moved to Trash." : `${ok} moved to Trash.`) : ok > 0 ? `${ok} of ${ids.length} moved to Trash.` : "Couldn't move to Trash. Please try again.");
        after?.();
      },
    });
  const bulkDone = (ok: number, n: number, verb: string) => {
    showToast(ok === n ? `${ok} ${verb}.` : ok > 0 ? `${ok} of ${n} ${verb}.` : "Couldn't update. Please try again.");
    setSelIds(new Set());
  };
  const applyLabel = async (ids: string[], name: string) => {
    const items = rows.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id, labels: t.labels }));
    if (!ctx.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) await createLabel(name, labelColor(name, ctx.labels));
    const ok = await patchManyAddLabel(items, name);
    if (items.length > 1) bulkDone(ok, items.length, `labelled "${name}"`);
    else showToast(ok ? `Labelled "${name}".` : "Couldn't add the label. Please try again.");
    setSheet(null);
  };
  const deleteLabelAsk = (l: MailLabel) =>
    setConfirm({
      title: `Delete "${l.name}"?`,
      body: "It's removed from every conversation. This can't be undone.",
      okLabel: "Delete label",
      danger: true,
      icon: Trash2,
      onOk: async () => {
        setBusy(true);
        const ok = await deleteLabel(l.id);
        setBusy(false);
        setConfirm(null);
        if (ok && st.label?.toLowerCase() === l.name.toLowerCase()) setList({ label: null });
        showToast(ok ? "Label deleted." : "Couldn't delete the label. Please try again.");
      },
    });

  const rowThread = sheet?.t === "row" ? rows.find((t) => t.id === sheet.id) ?? null : null;
  const canSend = ctx.canCreate && ctx.addresses.length > 0;
  const loading = conv && !ctx.noMailbox && !threads && !threadsQ.error;
  const failed = conv && !threads && !!threadsQ.error;
  const autoRows = outboxQ.data?.rows ?? [];
  const counts = outboxQ.data?.counts;

  // ---- folder chips + the folders sheet tiles ----
  const unreadIn = (f: Folder) => (f === "inbox" || f === "my-inbox" || f === folder ? live.filter((t) => t.unread && (f !== "my-inbox" || t.mailboxAddress === ctx.myAddress)).length : 0);
  const chipFolders: Folder[] = [...(ctx.myAddress ? (["my-inbox"] as Folder[]) : []), "inbox", "starred", "sent", "drafts", "autosent", "archive", "trash"];
  const chipCount = (f: Folder) => (f === "drafts" ? drafts.length : f === "autosent" ? counts?.failed ?? 0 : f === "inbox" || f === "my-inbox" ? unreadIn(f) : 0);
  const tileOf = (f: Folder, label?: string): FolderTileInfo => ({ folder: f, label: label ?? FOLDER_LABEL[f], n: f === "drafts" ? drafts.length : f === "autosent" ? counts?.failed ?? 0 : f === folder || f === "inbox" || f === "my-inbox" ? unreadIn(f) : 0, badge: f === "autosent" ? "red" : undefined });
  const mbName = st.mailbox.kind === "all" ? "All mailboxes" : st.mailbox.kind === "dept" ? `${st.mailbox.value} · all mailboxes` : (() => { const v = (st.mailbox as { value: string }).value; const a = ctx.addresses.find((x) => x.address === v); return a ? mailboxName(a) : v; })();

  const header = (
    <CommsHeader
      title="Mail Center"
      badge={!loading && !failed ? <CountBadge n={unreadAll} label={`${unreadAll} unread in loaded conversations`} /> : null}
      trailing={
        <>
          <RoundBtn icon={RotateCw} label="Refresh" size={17} spin={spin} onClick={() => void refresh()} />
          <RoundBtn icon={Plus} label="New email" size={20} gold disabled={!canSend} onClick={() => (canSend ? nav.compose() : showToast(ctx.noMailbox ? "You have no @hookka.com mailbox assigned yet. Ask an admin." : "You don't have permission to send email."))} />
        </>
      }
    />
  );

  const FolderIc = FOLDER_ICON[folder];
  return (
    <CommsScreen>
      {header}
      <Column max={phone ? 720 : 860}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 18px 0" }}>
          <SearchField value={st.q} onChange={(q) => setList({ q })} placeholder="Search mail" label="Search subject, sender, email or preview in loaded mail" />
          <RoundBtn icon={ArrowDownUp} label="View settings" size={16} haspopup onClick={() => setSheet({ t: "view" })} />
        </div>

        <div className="c-scroll" role="tablist" aria-label="Folders" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 4px" }}>
          {chipFolders.map((f) => {
            const on = folder === f;
            const Icon = FOLDER_ICON[f];
            const n = chipCount(f);
            return (
              <button key={f} type="button" role="tab" aria-selected={on} onClick={() => pick(f)}
                style={{ ...BTN, flex: "none", minHeight: 36, padding: "0 13px 0 11px", borderRadius: 999, background: on ? "#6B5C32" : C.card, color: on ? "#FFFFFF" : C.chipText, boxShadow: on ? "var(--c-sh-chip-on)" : "var(--c-sh-chip)", fontSize: 12.5, fontWeight: on ? 700 : 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                <Icon size={14} strokeWidth={2} />
                {f === "my-inbox" ? "My inbox" : FOLDER_LABEL[f]}
                {n ? <span style={{ opacity: 0.85, ...NUM }}>{n}</span> : null}
              </button>
            );
          })}
          <button type="button" onClick={() => setSheet({ t: "folders" })} aria-haspopup="dialog"
            style={{ ...BTN, flex: "none", minHeight: 36, padding: "0 13px 0 11px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <Layers size={14} strokeWidth={2} />All folders
          </button>
        </div>

        <div style={{ margin: "12px 18px 0", paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold }}>MAILBOX</span>
          <button type="button" onClick={() => setSheet({ t: "folders" })} aria-haspopup="dialog" aria-label={`Folder ${FOLDER_LABEL[folder]}, ${mbName}. Change`}
            style={{ ...BTN, minHeight: 36, minWidth: 0, maxWidth: "100%", padding: "0 10px 0 6px", borderRadius: 10, background: C.cream, color: C.ink, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 24, height: 24, flex: "none", borderRadius: 7, background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}><Layers size={13} strokeWidth={2.2} color="var(--c-gold)" /></span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mbName}</span>
            <ChevronDown size={14} strokeWidth={2.2} color="var(--c-gold-mid)" style={{ flex: "none" }} />
          </button>
        </div>

        {showCats ? (
          <div style={{ padding: "10px 18px 0" }}>
            <Segmented label="Category" height={46} radius={14} value={st.cat} onChange={(cat) => setList({ cat })}
              items={[
                { key: "all", label: <><Inbox size={15} strokeWidth={1.9} style={{ flex: "none" }} />All</> },
                { key: "primary", label: <><User size={15} strokeWidth={1.9} style={{ flex: "none" }} />Primary</> },
                { key: "notifications", label: <><Bell size={15} strokeWidth={1.9} style={{ flex: "none" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Notifications</span></> },
              ]} />
          </div>
        ) : null}
        {folder === "autosent" ? (
          <div className="c-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 4px" }}>
            {OUTBOX_FILTERS.map((f) => {
              const on = st.outboxFilter === f.key;
              const n = !counts ? "" : f.key === "" ? counts.sent + counts.failed + counts.pending : f.key === "SENT" ? counts.sent : f.key === "FAILED" ? counts.failed : counts.pending;
              const dot = f.key === "SENT" ? "var(--c-green)" : f.key === "FAILED" ? "var(--c-red)" : f.key === "PENDING" ? "var(--c-grey)" : "";
              return (
                <button key={f.key || "all"} type="button" aria-pressed={on} onClick={() => setList({ outboxFilter: f.key })}
                  style={{ ...BTN, flex: "none", minHeight: 36, padding: "0 13px", borderRadius: 999, background: on ? "#6B5C32" : C.card, color: on ? "#FFFFFF" : C.chipText, boxShadow: on ? "var(--c-sh-chip-on)" : "var(--c-sh-chip)", fontSize: 12.5, fontWeight: on ? 700 : 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                  {dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: on ? "0 0 0 1.5px #FFFFFF" : "none" }} /> : null}
                  {f.label}
                  {n !== "" ? <span style={{ opacity: 0.8, ...NUM }}>{n}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {st.label ? (
          <div style={{ display: "flex", gap: 6, padding: "10px 18px 0" }}>
            <button type="button" onClick={() => setList({ label: null })} aria-label={`Clear label ${st.label}`}
              style={{ ...BTN, minHeight: 32, padding: "0 9px 0 11px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: labelColor(st.label, ctx.labels) }} />{st.label}<X size={12} strokeWidth={2.4} />
            </button>
          </div>
        ) : null}

        <div style={{ padding: `0 16px ${selOn ? 170 : 40}px` }}>
          {ctx.noMailbox ? (
            <Pad><StateCard icon={MailX} title="No mailbox assigned" text="You have no @hookka.com mailbox assigned yet, so there's no mail to show. Ask an admin to assign one in User Management." /></Pad>
          ) : folder === "drafts" ? (
            <DraftsView ctx={ctx} onOpen={(id) => nav.compose(id)} onDiscard={(id) => setConfirm({ title: "Discard this draft?", body: "It's removed from this device.", okLabel: "Discard", danger: true, icon: Trash2, onOk: () => { deleteDraft(id); setConfirm(null); showToast("Draft discarded."); } })} />
          ) : folder === "autosent" ? (
            !outboxQ.data ? (
              outboxQ.error ? (
                <Pad><StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load sent emails" text={outboxQ.error} action={<RetryButton onClick={() => outboxQ.refresh()} />} /></Pad>
              ) : <Pad><Skel /></Pad>
            ) : autoRows.length === 0 ? (
              <Pad><StateCard icon={Bell} title={st.outboxFilter ? "No auto-sent emails in this filter" : "No auto-sent emails yet"} text="Emails the ERP sends by itself show here." /></Pad>
            ) : (
              <div style={{ display: "grid", gap: 8, paddingTop: 12 }}>
                <CountLine label={`${autoRows.length} AUTO-SENT`} style={{ padding: "0 4px" }} />
                {autoRows.map((a) => <OutboxRow key={a.id} a={a} on={params.get("outbox") === a.id} onOpen={() => nav.openOutbox(a.id)} />)}
                <InfoNote icon={Info} style={{ padding: "4px 4px 0" }}>Emails the ERP sends by itself. Read-only.</InfoNote>
              </div>
            )
          ) : loading ? (
            <Pad><Skel /></Pad>
          ) : failed ? (
            <Pad><StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load your mail" text={threadsQ.error} action={<RetryButton onClick={() => threadsQ.refresh()} />} /></Pad>
          ) : rows.length === 0 ? (
            <Pad>
              {(() => {
                const e = emptyCopy(folder, filtering);
                return <StateCard icon={filtering ? SearchX : folder === "trash" ? Trash2 : Inbox} title={e.title} text={e.text} action={filtering ? <GhostButton onClick={() => setList({ q: "", label: null })}>Clear search and label</GhostButton> : null} />;
              })()}
            </Pad>
          ) : (
            <>
              {threadsQ.error ? (
                <div role="alert" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5 }}>
                  <CloudOff size={16} strokeWidth={2} style={{ flex: "none" }} /><span style={{ flex: 1 }}>Couldn't refresh: {threadsQ.error}</span>
                </div>
              ) : null}
              <section aria-label={FOLDER_LABEL[folder]} style={{ marginTop: 12, borderRadius: 20, background: C.card, boxShadow: "var(--c-sh-card)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 0" }}>
                  <span style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: C.gradTile, display: "flex", alignItems: "center", justifyContent: "center" }}><FolderIc size={16} strokeWidth={2} color="#FFFFFF" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.2px" }}>{FOLDER_LABEL[folder]}</div>
                    <div style={{ fontSize: 12, color: C.body, marginTop: 1, ...NUM }}>
                      {rows.length} {rows.length === 1 ? "conversation" : "conversations"}
                      {rows.some((t) => t.unread) ? ` · ${rows.filter((t) => t.unread).length} unread` : ""}
                      {filtering ? " · filtered" : ""}
                    </div>
                  </div>
                  {ctx.canUpdate ? (
                    <button type="button" onClick={() => { setSelOn(!selOn); setSelIds(new Set()); }} aria-pressed={selOn}
                      style={{ ...BTN, minHeight: 36, padding: "0 13px", borderRadius: 999, background: selOn ? "#6B5C32" : C.card, color: selOn ? "#FFFFFF" : C.gold, fontSize: 12.5, fontWeight: 700, boxShadow: selOn ? "var(--c-sh-chip-on)" : "var(--c-sh-secondary)" }}>
                      {selOn ? "Done" : "Select"}
                    </button>
                  ) : null}
                </div>
                <div style={{ height: 1, background: C.divider, margin: "12px 14px 0" }} />
                <div style={{ display: "grid", gap: prefs.density === "compact" ? 6 : 9, padding: 10 }}>
                  {rows.map((t) => (
                    <ThreadRow key={t.id} t={t} ctx={ctx} folder={folder} comfy={prefs.density === "comfortable"} showMb={st.mailbox.kind !== "mailbox" && folder !== "my-inbox"} current={t.id === selectedId}
                      selOn={selOn} sel={selIds.has(t.id)}
                      onTap={() => {
                        if (selOn) return setSelIds((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; });
                        nav.openThread(t.id);
                      }}
                      onStar={() => void act(() => patchThreadStarred(t.id, !t.starred), t.starred ? "Unstarred." : "Starred.")}
                      onMore={() => setSheet({ t: "row", id: t.id })} />
                  ))}
                </div>
              </section>
              {hasMore ? (
                <div style={{ paddingTop: 12 }}>
                  <GhostButton height={44} onClick={() => void loadMore()} style={{ width: "100%" }}>
                    {extra.loading ? <Spinner size={12} /> : null}{extra.loading ? "Loading…" : "Load more"}
                  </GhostButton>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Column>

      {selOn ? (
        <ResponsiveActionDock scope="auto" phoneBottom={phone ? 64 : 0} tabletBottom={12} zIndex={35}>
          <div role="toolbar" aria-label="Selected conversations" style={{ pointerEvents: "auto", width: "calc(100% - 24px)", maxWidth: 520, boxSizing: "border-box", borderRadius: 18, background: "var(--mc-selbar-bg)", color: "#FFFFFF", padding: "10px 10px 8px", boxShadow: "0 18px 40px -16px rgba(31,29,27,.7)", fontFamily: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 8px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, ...NUM }}>{selected.length} selected</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setSelIds(selected.length === rows.length ? new Set() : new Set(rows.map((t) => t.id)))} style={{ ...BTN, height: 44, padding: "0 14px", borderRadius: 999, background: "var(--mc-selbar-btn2)", color: "#FFFFFF", fontSize: 12.5, fontWeight: 700 }}>
                {selected.length === rows.length && rows.length ? "Clear all" : "Select all"}
              </button>
              <button type="button" onClick={() => { setSelOn(false); setSelIds(new Set()); }} aria-label="Clear selection" style={{ ...BTN, width: 44, height: 44, borderRadius: "50%", background: "var(--mc-selbar-btn2)", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} strokeWidth={2.4} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 4 }}>
              {(() => {
                const ids = selected.map((t) => t.id);
                const none = !ids.length;
                const B = (l: string, Icon: LucideIcon, fn: () => void, dis = false) => (
                  <button key={l} type="button" disabled={none || dis} onClick={fn} style={{ ...BTN, height: 52, borderRadius: 12, background: "var(--mc-selbar-btn)", color: "#FFFFFF", fontSize: 10.5, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, opacity: none || dis ? 0.45 : 1, cursor: none || dis ? "default" : "pointer" }}>
                    <Icon size={17} strokeWidth={2} />{l}
                  </button>
                );
                return [
                  B("Read", MailOpen, async () => bulkDone(await patchManyUnread(ids, false), ids.length, "marked as read")),
                  B("Unread", Mail, async () => bulkDone(await patchManyUnread(ids, true), ids.length, "marked as unread")),
                  folder === "archive"
                    ? B("To Inbox", Inbox, async () => bulkDone(await patchManyStatus(ids, "open"), ids.length, "moved to Inbox"))
                    : B("Archive", ArchiveIcon, async () => bulkDone(await patchManyStatus(ids, "closed"), ids.length, "archived"), folder === "trash"),
                  B("Label", Tag, () => setSheet({ t: "pick", ids, mode: "bulk" })),
                  B("Trash", Trash2, () => askTrash(ids, () => setSelIds(new Set())), folder === "trash"),
                ];
              })()}
            </div>
          </div>
        </ResponsiveActionDock>
      ) : null}

      <FoldersSheet
        open={sheet?.t === "folders"}
        onClose={() => setSheet(null)}
        folder={folder}
        curMailboxLine={st.mailbox.kind === "all" ? `All mailboxes · ${ctx.addresses.length} you can see` : st.mailbox.kind === "dept" ? `${st.mailbox.value} · all mailboxes` : st.mailbox.value}
        curUnread={unreadIn(folder)}
        mine={ctx.myAddress ? [tileOf("my-inbox", "Inbox"), tileOf("my-sent"), tileOf("drafts")] : null}
        all={(["inbox", "starred", "sent", "autosent", "archive", "trash", "all", ...(ctx.myAddress ? [] : ["drafts"])] as Folder[]).map((f) => tileOf(f))}
        onFolder={pick}
        labels={labelNames.map((n) => ({ name: n, color: labelColor(n, ctx.labels), count: live.filter((t) => hasLabel(t.labels, n)).length }))}
        label={st.label}
        onLabel={(label) => { setList({ label }); setSheet(null); }}
        canManageLabels={ctx.canCreate || ctx.canUpdate || ctx.canDelete}
        onManage={() => setSheet({ t: "labels" })}
        groups={sheetGroups}
        mailbox={st.mailbox}
        onMailbox={(mailbox) => { setList({ mailbox }); setSheet(null); }}
        unreadByMailbox={unreadByMailbox}
        myAddress={ctx.myAddress}
        totalMailboxes={ctx.addresses.length}
        allAddresses={ctx.allAddresses}
        isSuperAdmin={ctx.isSuperAdmin}
        onSetup={(address, dept) =>
          setConfirm({
            title: `Set up ${address}?`,
            body: `Creates the shared ${dept} mailbox so the team can receive and reply from it. You can grant people access in User Management → Mailbox Access.`,
            okLabel: "Set up mailbox",
            icon: Inbox,
            onOk: async () => {
              setBusy(true);
              const id = await createDeptMailbox(address, dept, `${dept} Team`);
              setBusy(false);
              setConfirm(null);
              showToast(id !== null ? `${address} is ready.` : "Couldn't set up the mailbox. Please try again.");
              if (id !== null) { setList({ mailbox: { kind: "mailbox", value: address } }); setSheet(null); }
            },
          })
        }
        onSee={() => setSheet({ t: "see" })}
      />
      <SeeSheet open={sheet?.t === "see"} onClose={() => setSheet(null)} />
      <ViewSheet open={sheet?.t === "view"} onClose={() => setSheet(null)} isSuperAdmin={ctx.isSuperAdmin} injecting={injecting}
        onInject={async () => {
          setInjecting(true);
          const r = await postTestInject();
          setInjecting(false);
          refreshThreads();
          showToast(r.ok ? "Test email added." : r.error);
        }} />
      <LabelsSheet open={sheet?.t === "labels"} onClose={() => setSheet(null)} ctx={ctx} onDelete={deleteLabelAsk} toast={showToast}
        apply={sheet?.t === "labels" && sheet.apply ? async (name) => applyLabel((sheet as { apply: string[] }).apply, name) : undefined} />
      <LabelPickSheet
        open={sheet?.t === "pick"}
        onClose={() => setSheet(null)}
        mode={sheet?.t === "pick" ? sheet.mode : "add"}
        names={labelNames}
        catalog={ctx.labels}
        count={sheet?.t === "pick" ? sheet.ids.length : 0}
        current={sheet?.t === "pick" && sheet.mode === "add" ? rows.find((t) => t.id === sheet.ids[0])?.labels ?? [] : []}
        onPick={(name, on) => { if (sheet?.t === "pick" && !on) void applyLabel(sheet.ids, name); }}
        onNew={ctx.canCreate && sheet?.t === "pick" ? () => setSheet({ t: "labels", apply: (sheet as { ids: string[] }).ids }) : null}
      />
      <ActionSheet
        open={!!rowThread}
        onClose={() => setSheet(null)}
        title={rowThread?.subject || "(no subject)"}
        sub={rowThread ? senderLabel(rowThread) : ""}
        rows={rowThread ? rowActions(rowThread, folder, {
          star: () => { setSheet(null); void act(() => patchThreadStarred(rowThread.id, !rowThread.starred), rowThread.starred ? "Unstarred." : "Starred."); },
          read: () => { setSheet(null); void act(() => patchThreadUnread(rowThread.id, !rowThread.unread), rowThread.unread ? "Marked as read." : "Marked as unread."); },
          archive: () => { setSheet(null); void act(() => patchThreadStatus(rowThread.id, rowThread.status === "closed" ? "open" : "closed"), rowThread.status === "closed" ? "Moved to Inbox." : "Archived."); },
          label: () => setSheet({ t: "pick", ids: [rowThread.id], mode: "add" }),
          trash: () => { setSheet(null); if (rowThread.trashedAt) void act(() => patchThreadTrashed(rowThread.id, false), "Restored from Trash.", "Couldn't restore. Please try again."); else askTrash([rowThread.id]); },
        }) : []}
      />
      <ConfirmDialog spec={confirm} busy={busy} onCancel={() => setConfirm(null)} />
      {toast}
    </CommsScreen>
  );
}

const ArchiveIcon: LucideIcon = FOLDER_ICON.archive;

function rowActions(t: MailThread, folder: Folder, h: { star: () => void; read: () => void; archive: () => void; label: () => void; trash: () => void }) {
  const trashed = !!t.trashedAt || folder === "trash";
  return [
    { key: "star", label: t.starred ? "Unstar" : "Star", icon: Star, onClick: h.star },
    { key: "read", label: t.unread ? "Mark as read" : "Mark as unread", icon: t.unread ? MailOpen : Mail, onClick: h.read },
    ...(trashed ? [] : [t.status === "closed" ? { key: "arch", label: "Move to Inbox", icon: Inbox, onClick: h.archive } : { key: "arch", label: "Archive", icon: ArchiveIcon, onClick: h.archive }]),
    { key: "label", label: "Add a label", icon: Tag, onClick: h.label },
    trashed
      ? { key: "trash", label: "Restore from Trash", icon: Undo2, onClick: h.trash }
      : { key: "trash", label: "Move to Trash", icon: Trash2, fg: "var(--c-red)", iconFg: "var(--c-red)", iconBg: "var(--c-red-bg)", onClick: h.trash },
  ];
}

const Pad = ({ children }: { children: ReactNode }) => <div style={{ paddingTop: 12 }}>{children}</div>;
function Skel() {
  return (
    <div aria-busy="true" aria-label="Loading conversations" style={{ display: "grid", gap: 8 }}>
      {[1, 2, 3, 4, 5].map((k) => <div key={k} className="c-anim" style={{ height: 78, borderRadius: 16, background: C.skel, boxShadow: "var(--c-sh-card)", animation: "c-pulse 1.2s ease-in-out infinite" }} />)}
    </div>
  );
}
function RetryButton({ onClick }: { onClick: () => void }) {
  return <PrimaryButton height={44} icon={RotateCw} onClick={onClick} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5, marginTop: 4 }}>Try again</PrimaryButton>;
}

function ThreadRow({ t, ctx, folder, comfy, showMb, current, selOn, sel, onTap, onStar, onMore }: { t: MailThread; ctx: MailCtx; folder: Folder; comfy: boolean; showMb: boolean; current: boolean; selOn: boolean; sel: boolean; onTap: () => void; onStar: () => void; onMore: () => void }) {
  const who = senderLabel(t);
  const out = t.lastDirection === "outbound";
  const mbx = ctx.addresses.find((a) => a.address === t.mailboxAddress);
  const archived = t.status === "closed" && folder !== "archive" && !t.trashedAt;
  return (
    <div role="button" tabIndex={0} aria-current={current || undefined} onClick={onTap} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}
      aria-label={`${t.unread ? "Unread, " : ""}${who}, ${t.subject || "(no subject)"}`}
      style={{ position: "relative", display: "flex", gap: 11, padding: comfy ? "13px 12px 12px 14px" : "10px 10px 9px 13px", borderRadius: 16, background: sel || current ? "var(--mc-row-sel)" : t.unread ? C.card : "var(--mc-row-read)", boxShadow: sel || current ? "var(--mc-sh-sel)" : t.unread ? "var(--mc-sh-unread)" : "var(--mc-sh-read)", cursor: "pointer", overflow: "hidden", WebkitTapHighlightColor: "transparent" }}>
      {t.unread ? <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--mc-unread-bar)" }} /> : null}
      {selOn ? (
        <span role="checkbox" aria-checked={sel} style={{ width: 24, height: 24, flex: "none", alignSelf: "center", borderRadius: 8, background: sel ? "#6B5C32" : C.card, boxShadow: sel ? "none" : "inset 0 0 0 1.5px var(--c-sand)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
          {sel ? <Check size={15} strokeWidth={3} /> : null}
        </span>
      ) : null}
      <Avatar name={who} size={comfy ? 40 : 34} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {out ? <CornerUpRight size={12} strokeWidth={2.2} color="var(--c-gold-mid)" style={{ flex: "none" }} /> : null}
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: t.unread ? 800 : 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{out ? `To ${who}` : who}</span>
          {t.messageCount > 1 ? <span style={{ flex: "none", fontSize: 11, fontWeight: 700, color: C.muted, ...NUM }}>{t.messageCount}</span> : null}
          <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: ".2px", color: t.unread ? C.gold : C.faint, whiteSpace: "nowrap", ...NUM }}>{listWhen(t.lastMessageAt)}</span>
        </span>
        <span style={{ display: "block", marginTop: 2, fontSize: 13, fontWeight: t.unread ? 700 : 500, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.subject || "(no subject)"}</span>
        <span style={{ display: "block", marginTop: 2, fontSize: 12, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cleanSnippet(t.lastSnippet)}</span>
        {(showMb && mbx) || t.labels.length || archived ? (
          <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, minWidth: 0, overflow: "hidden" }}>
            {showMb && mbx ? <MiniPill fg={C.gold} bg={C.cream} icon={Inbox}>{mailboxName(mbx)}</MiniPill> : null}
            {(comfy ? t.labels : t.labels.slice(0, 3)).map((l) => {
              const c = labelColor(l, ctx.labels);
              return (
                <span key={l} style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 6px", borderRadius: 999, background: C.card, boxShadow: `inset 0 0 0 1px ${c}55`, color: C.body, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />{l}
                </span>
              );
            })}
            {archived ? <MiniPill fg={C.grey} bg={C.greyBg}>Archived</MiniPill> : null}
          </span>
        ) : null}
      </span>
      {!selOn && ctx.canUpdate ? (
        <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 0, margin: "-8px -8px -8px 0" }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onStar(); }} aria-label={t.starred ? "Unstar" : "Star"} aria-pressed={t.starred}
            style={{ ...BTN, width: 44, height: 44, background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: t.starred ? "var(--mc-star)" : C.chev }}>
            <Star size={17} strokeWidth={2} fill={t.starred ? "var(--mc-star)" : "none"} />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onMore(); }} aria-label={`Actions for ${t.subject || "(no subject)"}`} aria-haspopup="dialog"
            style={{ ...BTN, width: 44, height: 44, background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint }}>
            <EllipsisVertical size={17} strokeWidth={2} />
          </button>
        </span>
      ) : null}
    </div>
  );
}

function DraftsView({ ctx, onOpen, onDiscard }: { ctx: MailCtx; onOpen: (id: string) => void; onDiscard: (id: string) => void }) {
  const drafts = useDrafts();
  if (!drafts.length) {
    const e = emptyCopy("drafts", false);
    return <Pad><StateCard icon={FilePen} title={e.title} text={e.text} /></Pad>;
  }
  return (
    <div style={{ display: "grid", gap: 10, paddingTop: 12 }}>
      <InfoNote icon={Info} style={{ padding: "0 4px" }}>Drafts are kept on this device only, without attachments.</InfoNote>
      {drafts.map((d) => (
        <div key={d.id} style={{ padding: "12px 12px 10px 14px", borderRadius: 16, background: C.card, boxShadow: "var(--c-sh-card)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <MiniPill fg={C.amber} bg={C.amberBg}>Draft</MiniPill>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: C.faint }}>Saved {listWhen(new Date(d.updatedAt).toISOString())}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, wordBreak: "break-word" }}>{d.subject?.trim() || "(no subject)"}</div>
          <div style={{ marginTop: 2, fontSize: 12, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>To {d.to?.trim() || "—"}</div>
          {d.body ? <div style={{ marginTop: 2, fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.body}</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={() => onDiscard(d.id)} style={{ ...BTN, height: 44, borderRadius: 10, background: C.card, boxShadow: "0 0 0 1px var(--c-red-ring)", color: C.red, fontSize: 12.5, fontWeight: 700 }}>Discard</button>
            <button type="button" onClick={() => onOpen(d.id)} disabled={!ctx.canCreate} style={{ ...BTN, height: 44, borderRadius: 10, background: C.grad, color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, opacity: ctx.canCreate ? 1 : 0.5 }}>Continue writing</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OutboxRow({ a, on, onOpen }: { a: OutboxItem; on: boolean; onOpen: () => void }) {
  const [fg, bg] = outboxTone(a.status);
  const w = outboxWhen(a);
  return (
    <button type="button" onClick={onOpen} aria-current={on || undefined} className="c-press"
      style={{ ...BTN, position: "relative", overflow: "hidden", width: "100%", textAlign: "left", background: C.card, color: C.ink, borderRadius: 16, padding: "11px 12px 10px 15px", boxShadow: on ? "0 0 0 2px var(--c-gold), var(--c-sh-card)" : "var(--c-sh-card)", display: "block" }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: fg }} />
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.toAddress || "(no recipient)"}</span>
        <MiniPill fg={fg} bg={bg} h={20} size={10.5}><span style={{ width: 5, height: 5, borderRadius: "50%", background: fg }} />{outboxStatusLabel(a.status)}</MiniPill>
      </span>
      <span style={{ display: "block", marginTop: 3, fontSize: 13, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.subject || "(no subject)"}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, fontSize: 11, color: C.muted }}>
        <span>{w.label} {fullWhen(w.at)}</span>
        {a.attachmentNames.length ? <span>· {a.attachmentNames.length} {a.attachmentNames.length === 1 ? "attachment" : "attachments"}</span> : null}
      </span>
      {(a.status || "").toUpperCase() === "FAILED" && a.lastError ? <span style={{ display: "block", marginTop: 6, padding: "6px 8px", borderRadius: 8, background: C.redBg, color: C.red, fontSize: 11.5, lineHeight: 1.4, wordBreak: "break-word" }}>{a.lastError}</span> : null}
    </button>
  );
}
