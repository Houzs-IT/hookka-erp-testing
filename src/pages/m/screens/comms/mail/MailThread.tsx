// ---------------------------------------------------------------------------
// One conversation (Mail Center v3, approved prototype). Desktop rules
// (src/pages/mail-center/detail.tsx):
//   • GET /threads/:id (marks it read for me), refreshed every 30 s by the cache.
//   • Header: mailbox, Archived / In Trash / Starred, Read by X of Y (who, when),
//     Assign to (/api/users), labels add / remove — all PATCH /threads/:id.
//   • Star, Unread, Archive ⇄ Move to Inbox, Trash (confirm) ⇄ Restore.
//   • Each message: HTML in a sandboxed frame (no scripts) or plain text, To,
//     attachments, delivery chip on what we sent, acknowledgement per message
//     with Acknowledge when it is pending for me.
//   • "X is writing a reply" from the server (reply guard, #1623).
//   • Reply / Reply all / Forward open the composer page (?reply=).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock, CloudOff, Ellipsis, Eye, EyeOff, FileText, FileX, Forward, Inbox, Info, Mail, PenLine,
  Reply, ReplyAll, RotateCw, Star, Tag, Trash2, Undo2, X, Download, CircleAlert,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { BTN, BottomBar, C, Column, CommsScreen, CommsSheet, GhostButton, InfoNote, NUM, PageBar, PrimaryButton, Skeletons, Spinner, StateCard, useToast } from "../comms-kit";
import { ConfirmDialog, MediaViewer, type ConfirmSpec, type ViewerItem } from "../comms-overlay";
import {
  ackIsMine, ackState, deliveryLabel, deliveryTone, emailSrcDoc, fullWhen, hasLabel, humanSize, isImageType, labelColor, labelList, mailboxName, messageBody, withLabel, withoutLabel,
  type MailLabel, type MailMessage, type ThreadDetail,
} from "./mail-lib";
import {
  createLabel, deleteLabel, joinNames, patchThreadAssignment, patchThreadLabels, patchThreadStarred, patchThreadStatus, patchThreadTrashed, patchThreadUnread, postAcknowledge,
  refreshThread, refreshThreads, useMailCtx, type MailCtx,
} from "./mail-api";
import { ActionSheet, LabelPickSheet, LabelsSheet } from "./MailSheets";
import { Avatar, MiniPill, PlainSelect, RoundBtn, RowGroup } from "./mail-ui";
import { takeFlash } from "./mail-store";

type UsersEnvelope = { success?: boolean; data?: { id: string; email: string; displayName: string }[] };
type Sheet = null | "readers" | "more" | "labels" | "manage";

export function MailThread({ id, onBack, onReply, showBack = true }: { id: string; onBack: () => void; onReply: (mode: "reply" | "reply_all" | "forward") => void; showBack?: boolean }) {
  const ctx = useMailCtx();
  const url = `/api/mail-center/threads/${encodeURIComponent(id)}`;
  const q = useCachedJson<ThreadDetail>(url, 30);
  const usersQ = useCachedJson<UsersEnvelope>(ctx.canUpdate ? "/api/users" : null, 300);
  const [toast, showToast] = useToast();
  useEffect(() => {
    const m = takeFlash();
    if (m) showToast(m);
  }, [showToast]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerItem | null>(null);

  // Opening it read it on the server: the list's unread marks are stale now.
  const loadedId = q.data?.thread.id;
  useEffect(() => {
    if (loadedId) refreshThreads();
  }, [loadedId]);

  const data = q.data;
  if (!data) {
    return (
      <CommsScreen>
        <PageBar title="" onBack={onBack} backLabel="Back to conversations" />
        <Column max={760}>
          <div style={{ padding: "0 16px 24px" }}>
            {q.error ? (
              <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't open this conversation" text={q.error}
                action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
                  <PrimaryButton height={44} icon={RotateCw} onClick={() => q.refresh()} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5 }}>Try again</PrimaryButton>
                  <GhostButton height={44} onClick={onBack}>Back to conversations</GhostButton>
                </div>} />
            ) : q.loading ? (
              <Skeletons label="Loading conversation" n={3} h={130} />
            ) : (
              <StateCard icon={Mail} title="This conversation couldn't be opened" action={<GhostButton onClick={onBack}>Back to conversations</GhostButton>} />
            )}
          </div>
        </Column>
      </CommsScreen>
    );
  }

  const t = data.thread;
  const messages = data.messages ?? [];
  const trashed = t.trashedAt != null;
  const archived = t.status === "closed";
  const mbx = ctx.addresses.find((a) => a.address === t.mailboxAddress);
  const canSend = ctx.canCreate && ctx.addresses.length > 0;
  const users = usersQ.data?.data ?? [];
  const labelNames = labelList(ctx.labels, [t]);

  const run = async (fn: () => Promise<boolean>, ok: string, fail = "Couldn't update. Please try again.") => {
    if (mutating) return false;
    setMutating(true);
    const r = await fn();
    setMutating(false);
    showToast(r ? ok : fail);
    return r;
  };
  const toggleStar = () => void run(() => patchThreadStarred(t.id, !t.starred), t.starred ? "Unstarred." : "Starred.");
  const archiveOrInbox = async () => {
    if (trashed) return void run(() => patchThreadTrashed(t.id, false), "Restored from Trash.", "Couldn't restore. Please try again.");
    const done = await run(() => patchThreadStatus(t.id, archived ? "open" : "closed"), archived ? "Moved to Inbox." : "Archived.");
    if (done && !archived) onBack();
  };
  const askTrash = () =>
    setConfirm({
      title: "Move to Trash?",
      body: "This conversation moves to the Trash folder. You can restore it from there.",
      okLabel: "Move to Trash",
      danger: true,
      icon: Trash2,
      onOk: async () => {
        setBusy(true);
        const ok = await patchThreadTrashed(t.id, true);
        setBusy(false);
        setConfirm(null);
        showToast(ok ? "Moved to Trash." : "Couldn't move to Trash. Please try again.");
        if (ok) onBack();
      },
    });
  const setLabels = async (next: string[]) => {
    if (!(await patchThreadLabels(t.id, next))) showToast("Couldn't change the labels. Please try again.");
  };
  const addLabel = async (name: string) => {
    if (!ctx.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) await createLabel(name, labelColor(name, ctx.labels));
    await setLabels(withLabel(t.labels, name));
  };
  const assign = async (userId: string) => {
    const u = users.find((x) => x.id === userId);
    const name = u ? u.displayName || u.email : null;
    if (await run(() => patchThreadAssignment(t.id, userId || null, name), name ? `Assigned to ${name}.` : "Assignment cleared.", "Couldn't assign. Please try again.")) refreshThread(t.id);
  };
  const acknowledge = async (mid: string) => {
    if (acking) return;
    setAcking(mid);
    const r = await postAcknowledge(t.id, mid);
    setAcking(null);
    showToast(r.ok ? "Acknowledged." : r.error || "Could not acknowledge. Please try again.");
    if (r.ok) refreshThread(t.id);
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
        showToast(ok ? "Label deleted." : "Couldn't delete the label. Please try again.");
      },
    });

  const readBy = t.readBy ?? [];
  const states = [
    archived && !trashed ? { l: "Archived", I: Archive, fg: C.grey, bg: C.greyBg } : null,
    trashed ? { l: "In Trash", I: Trash2, fg: C.red, bg: C.redBg } : null,
    t.starred ? { l: "Starred", I: Star, fg: C.amber, bg: C.amberBg } : null,
  ].filter(Boolean) as { l: string; I: typeof Star; fg: string; bg: string }[];
  const ackMsgs = messages.filter((m) => m.ackRequired).slice().reverse();
  const replying = data.replying ?? [];
  const assignOpts = [{ v: "", l: "Unassigned" }, ...users.map((u) => ({ v: u.id, l: u.displayName || u.email }))];
  if (t.assignedToUserId && !users.some((u) => u.id === t.assignedToUserId)) assignOpts.push({ v: t.assignedToUserId, l: t.assignedToName || "Assigned" });

  return (
    <CommsScreen>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper, paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 52, padding: "0 14px 0 12px" }}>
          {showBack ? (
            <button type="button" onClick={onBack} aria-label="Back to conversations" style={{ ...BTN, width: 44, height: 44, marginLeft: -10, background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: C.ink }}>
              <ChevronLeft size={22} strokeWidth={2} />
            </button>
          ) : null}
          <span style={{ flex: 1 }} />
          {ctx.canUpdate ? (
            <>
              <RoundBtn icon={Star} label={t.starred ? "Unstar" : "Star"} pressed={t.starred} fg={t.starred ? "var(--mc-star)" : undefined} fill={t.starred ? "var(--mc-star)" : "none"} onClick={toggleStar} />
              <RoundBtn icon={trashed ? Undo2 : archived ? Inbox : Archive} label={trashed ? "Restore" : archived ? "Move to Inbox" : "Archive"} onClick={() => void archiveOrInbox()} />
              <RoundBtn icon={Ellipsis} label="More actions" size={20} haspopup onClick={() => setSheet("more")} />
            </>
          ) : null}
        </div>
      </div>

      <Column max={760}>
        <div style={{ padding: `0 16px ${canSend ? 110 : 28}px`, display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={{ borderRadius: 22, padding: 16, background: "var(--mc-thread-hero)", boxShadow: "var(--mc-thread-hero-sh)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <MiniPill fg={C.gold} bg={C.cream} icon={Inbox} h={22} size={11}>{mbx ? `${mailboxName(mbx)} · ${t.mailboxAddress}` : t.mailboxAddress || "Mailbox"}</MiniPill>
              {states.map((s) => <MiniPill key={s.l} fg={s.fg} bg={s.bg} icon={s.I} h={22} size={11}>{s.l}</MiniPill>)}
            </div>
            <h1 style={{ margin: "10px 0 0", fontSize: 19, fontWeight: 700, letterSpacing: "-.3px", lineHeight: 1.3, wordBreak: "break-word" }}>{t.subject || "(no subject)"}</h1>
            <div style={{ marginTop: 4, fontSize: 12.5, color: C.body, wordBreak: "break-word" }}>
              {t.counterpartyName || t.counterpartyEmail || "(unknown sender)"}
              {t.counterpartyName && t.counterpartyEmail ? ` · ${t.counterpartyEmail}` : ""}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 12 }}>
              <button type="button" onClick={() => setSheet("readers")} aria-haspopup="dialog" style={{ ...BTN, minWidth: 0, minHeight: 52, padding: "9px 10px", borderRadius: 12, background: C.card, boxShadow: "var(--c-sh-ring)", textAlign: "left" }}>
                <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".3px", color: C.gold }}>READ BY</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 13, fontWeight: 700, color: C.ink, ...NUM }}>{readBy.length} of {t.audience ?? "—"}<ChevronRight size={13} strokeWidth={2.2} color="var(--c-chev)" /></span>
              </button>
              <label style={{ minWidth: 0, minHeight: 52, padding: "9px 10px", borderRadius: 12, background: C.card, boxShadow: "var(--c-sh-ring)", display: "block", boxSizing: "border-box" }}>
                <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".3px", color: C.gold }}>ASSIGNED TO</span>
                {ctx.canUpdate && users.length ? (
                  <span style={{ display: "flex", marginTop: 2 }}><PlainSelect value={t.assignedToUserId ?? ""} onChange={(v) => void assign(v)} options={assignOpts} label="Assign to" disabled={mutating} /></span>
                ) : (
                  <span style={{ display: "block", marginTop: 3, fontSize: 13, fontWeight: 700, color: t.assignedToName ? C.ink : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.assignedToName || "Unassigned"}</span>
                )}
              </label>
            </div>
            {t.labels.length || ctx.canUpdate ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {t.labels.map((l) => {
                  const c = labelColor(l, ctx.labels);
                  return ctx.canUpdate ? (
                    <button key={l} type="button" onClick={() => void setLabels(withoutLabel(t.labels, l))} aria-label={`Remove label ${l}`}
                      style={{ ...BTN, minHeight: 32, padding: "0 8px 0 9px", borderRadius: 999, background: C.card, boxShadow: `inset 0 0 0 1px ${c}66`, color: C.body, fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />{l}<X size={11} strokeWidth={2.4} />
                    </button>
                  ) : (
                    <span key={l} style={{ minHeight: 28, padding: "0 9px", borderRadius: 999, background: C.card, boxShadow: `inset 0 0 0 1px ${c}66`, color: C.body, fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />{l}
                    </span>
                  );
                })}
                {ctx.canUpdate ? (
                  <button type="button" onClick={() => setSheet("labels")} style={{ ...BTN, minHeight: 32, padding: "0 10px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                    <Tag size={12} strokeWidth={2.2} />Add label
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {replying.length ? (
            <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 14, background: C.amberBg, color: C.amber, fontSize: 12.5, lineHeight: 1.45, boxShadow: "var(--mc-guard-ring)" }}>
              <PenLine size={16} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
              <span><b>{joinNames(replying.map((r) => r.name))}</b> {replying.length === 1 ? "is" : "are"} writing a reply to this conversation now. Check with them before you reply too.</span>
            </div>
          ) : null}

          {ackMsgs.map((m) => <AckBlock key={m.id} m={m} ctx={ctx} busy={acking === m.id} onAck={() => void acknowledge(m.id)} />)}

          {messages.map((m) => <MessageCard key={m.id} m={m} onImage={(a) => setViewer({ name: a.filename, url: a.url!, kind: "image" })} />)}
          {!messages.length ? <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: C.muted }}>No messages in this conversation yet.</div> : null}
        </div>
      </Column>

      {canSend ? (
        <BottomBar>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: "10px 16px 12px" }}>
            {([["Reply", Reply, "reply", true], ["Reply all", ReplyAll, "reply_all", false], ["Forward", Forward, "forward", false]] as const).map(([l, I, mode, primary]) => (
              <button key={mode} type="button" onClick={() => onReply(mode)} className="c-press"
                style={{ ...BTN, height: 48, borderRadius: 14, background: primary ? C.grad : C.card, color: primary ? "#FFFFFF" : C.gold, boxShadow: primary ? "var(--c-sh-cta)" : "var(--c-sh-secondary)", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap", minWidth: 0 }}>
                <I size={16} strokeWidth={2.2} />{l}
              </button>
            ))}
          </div>
        </BottomBar>
      ) : null}

      <CommsSheet open={sheet === "readers"} onClose={() => setSheet(null)} title="Read by" sub={`${readBy.length} of ${t.audience ?? "—"} people with access`}>
        <div style={{ padding: "4px 16px calc(24px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 10 }}>
          <RowGroup rows={readBy.length ? readBy.map((r) => ({ key: r.userId, label: r.userName || r.userId, sub: `Read ${fullWhen(r.readAt)}`, icon: Eye })) : [{ key: "none", label: "Nobody has read the latest message yet", icon: EyeOff, fg: C.muted }]} />
          <InfoNote icon={Info} style={{ padding: "0 4px" }}>Who opened it since the latest message — not an acknowledgement.</InfoNote>
        </div>
      </CommsSheet>
      <ActionSheet open={sheet === "more"} onClose={() => setSheet(null)} title={t.subject || "(no subject)"} sub={t.counterpartyName || t.counterpartyEmail}
        rows={[
          { key: "unread", label: "Mark as unread", icon: Mail, onClick: async () => { setSheet(null); if (await run(() => patchThreadUnread(t.id, true), "Marked as unread.")) onBack(); } },
          ...(trashed ? [] : [archived ? { key: "arch", label: "Move to Inbox", icon: Inbox, onClick: () => { setSheet(null); void archiveOrInbox(); } } : { key: "arch", label: "Archive", icon: Archive, onClick: () => { setSheet(null); void archiveOrInbox(); } }]),
          { key: "label", label: "Add or remove labels", icon: Tag, onClick: () => setSheet("labels") },
          trashed
            ? { key: "trash", label: "Restore from Trash", icon: Undo2, onClick: () => { setSheet(null); void archiveOrInbox(); } }
            : { key: "trash", label: "Move to Trash", icon: Trash2, fg: "var(--c-red)", iconFg: "var(--c-red)", iconBg: "var(--c-red-bg)", onClick: () => { setSheet(null); askTrash(); } },
        ]} />
      <LabelPickSheet open={sheet === "labels"} onClose={() => setSheet(null)} mode="toggle" names={labelNames} catalog={ctx.labels} current={t.labels}
        onPick={(name, on) => void (on ? setLabels(withoutLabel(t.labels, name)) : addLabel(name))}
        onNew={ctx.canCreate ? () => setSheet("manage") : null} />
      <LabelsSheet open={sheet === "manage"} onClose={() => setSheet(null)} ctx={ctx} onDelete={deleteLabelAsk} toast={showToast}
        apply={async (name) => { if (!hasLabel(t.labels, name)) await setLabels(withLabel(t.labels, name)); setSheet(null); showToast(`Labelled "${name}".`); }} />
      <ConfirmDialog spec={confirm} busy={busy} onCancel={() => setConfirm(null)} />
      <MediaViewer item={viewer} onClose={() => setViewer(null)} />
      {toast}
    </CommsScreen>
  );
}

function AckBlock({ m, ctx, busy, onAck }: { m: MailMessage; ctx: MailCtx; busy: boolean; onAck: () => void }) {
  const acks = m.acks ?? [];
  const now = new Date().toISOString();
  const done = acks.filter((a) => a.ackedAt).length;
  const late = !!m.ackDueAt && m.ackDueAt < now && done < acks.length;
  const mine = acks.some((a) => !a.ackedAt && ackIsMine(a, ctx.myId, ctx.myAddresses));
  return (
    <section style={{ borderRadius: 20, padding: 14, background: C.card, boxShadow: "var(--c-sh-info)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: C.gradTile, display: "flex", alignItems: "center", justifyContent: "center" }}><ClipboardCheck size={16} strokeWidth={2} color="#FFFFFF" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>Acknowledgement requested</div>
          <div style={{ fontSize: 12, color: late ? C.red : C.amber, marginTop: 1, fontWeight: 600 }}>
            On {m.fromName || m.fromAddress}'s message{m.ackDueAt ? ` · ${late ? "was due" : "due"} ${fullWhen(m.ackDueAt)}` : ""}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, ...NUM }}>{done} of {acks.length}</span>
      </div>
      <div style={{ height: 7, borderRadius: 999, background: C.track, overflow: "hidden", marginTop: 12 }}>
        <div style={{ height: "100%", width: `${acks.length ? Math.round((done / acks.length) * 100) : 0}%`, background: C.barOk, borderRadius: 999 }} />
      </div>
      {acks.length ? (
        <div style={{ marginTop: 10, borderRadius: 12, background: C.paper, overflow: "hidden" }}>
          {acks.map((a, i) => {
            const s = ackState(a, now);
            const me = ackIsMine(a, ctx.myId, ctx.myAddresses);
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderTop: i ? `1px solid ${C.hair}` : "none" }}>
                <Avatar name={a.userName || a.address} size={28} font={10} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, wordBreak: "break-word" }}>
                  {a.userName || a.address}{me ? " (you)" : ""}
                  {s === "overdue" && a.chasedAt ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberBg, padding: "1px 6px", borderRadius: 999 }}>Reminded</span> : null}
                </span>
                <MiniPill fg={s === "acked" ? C.green : s === "overdue" ? C.red : C.grey} bg={s === "acked" ? C.greenBg : s === "overdue" ? C.redBg : C.greyBg} h={20}>
                  {s === "acked" ? `Acknowledged ${fullWhen(a.ackedAt)}` : s === "overdue" ? "Overdue" : "Pending"}
                </MiniPill>
              </div>
            );
          })}
        </div>
      ) : null}
      {mine ? (
        <button type="button" onClick={onAck} disabled={busy} style={{ ...BTN, marginTop: 10, width: "100%", height: 46, borderRadius: 12, background: "var(--mc-ack)", color: "#FFFFFF", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy ? 0.7 : 1 }}>
          {busy ? <Spinner size={14} color="#FFFFFF" /> : <Check size={16} strokeWidth={2.6} />}Acknowledge
        </button>
      ) : null}
      <InfoNote icon={Info} style={{ marginTop: 10 }}>Acknowledging is a separate step from reading it.</InfoNote>
    </section>
  );
}

function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => emailSrcDoc(html), [html]);
  const fit = () => {
    try {
      const d = ref.current?.contentWindow?.document;
      if (d && ref.current) ref.current.style.height = `${Math.min(d.body.scrollHeight + 8, 4000)}px`;
    } catch {
      /* keep the minimum height */
    }
  };
  return (
    <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={fit}
      style={{ display: "block", width: "100%", minHeight: 80, marginTop: 10, border: "none", borderRadius: 10, background: "#FFFFFF", boxShadow: "var(--mc-frame-ring)" }} />
  );
}

function MessageCard({ m, onImage }: { m: MailMessage; onImage: (a: NonNullable<MailMessage["attachments"]>[number]) => void }) {
  const out = m.direction === "outbound";
  const name = m.fromName || m.fromAddress || "(unknown sender)";
  const body = messageBody(m);
  const del = out ? deliveryLabel(m.deliveryStatus) : null;
  const tone = deliveryTone(m.deliveryStatus);
  const atts = m.attachments ?? [];
  const imgs = atts.filter((a) => isImageType(a.contentType) && a.url);
  const files = atts.filter((a) => !(isImageType(a.contentType) && a.url));
  return (
    <article style={{ borderRadius: 18, background: C.card, boxShadow: "var(--mc-msg-sh)", padding: "13px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Avatar name={name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 120px", minWidth: 0, fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            <MiniPill fg={out ? C.gold : C.teal} bg={out ? C.tint : C.tealBg} icon={out ? ArrowUpRight : ArrowDownLeft}>{out ? "Sent" : "Received"}</MiniPill>
            {del ? <MiniPill fg={tone === "good" ? C.green : tone === "bad" ? C.red : C.amber} bg={tone === "good" ? C.greenBg : tone === "bad" ? C.redBg : C.amberBg} icon={tone === "good" ? Check : tone === "bad" ? CircleAlert : Clock}>{del}</MiniPill> : null}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.fromAddress}</div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2, wordBreak: "break-word" }}>{fullWhen(m.sentAt || m.receivedAt || m.createdAt)}{m.toAddresses.length ? ` · To ${m.toAddresses.join(", ")}` : ""}</div>
        </div>
      </div>
      {body.html ? <EmailFrame html={body.html} /> : <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55, color: C.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{body.text || "(empty)"}</div>}
      {m.deliveryStatus === "queued" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "8px 10px", borderRadius: 10, background: C.amberBg, color: C.amber, fontSize: 12, fontWeight: 600 }}>
          <Clock size={13} strokeWidth={2.2} />Not sent yet. It is queued and will retry within a few minutes.
        </div>
      ) : null}
      {imgs.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 10 }}>
          {imgs.map((a) => (
            <button key={a.id} type="button" onClick={() => onImage(a)} aria-label={`Open ${a.filename}`} style={{ ...BTN, aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: C.cream }}>
              <img src={a.url!} alt={a.filename} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {files.map((a) => {
            const ok = !!a.url;
            const inner = (
              <>
                <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: ok ? C.redBg : C.track, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {ok ? <FileText size={15} strokeWidth={2} color="var(--c-red)" /> : <FileX size={15} strokeWidth={2} color="var(--c-faint)" />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.filename}</span>
                  <span style={{ display: "block", fontSize: 11, color: ok ? C.muted : C.red, marginTop: 1 }}>{ok ? [a.contentType === "application/pdf" ? "PDF" : isImageType(a.contentType) ? "Image" : "File", humanSize(a.sizeBytes)].filter(Boolean).join(" · ") : "Unavailable right now"}</span>
                </span>
                {ok ? <Download size={15} strokeWidth={2} color="var(--c-gold-mid)" /> : null}
              </>
            );
            const st = { display: "flex", alignItems: "center", gap: 10, minHeight: 46, padding: "6px 10px", borderRadius: 12, background: "var(--mc-file-bg)", boxShadow: "var(--mc-file-ring)", textDecoration: "none", opacity: ok ? 1 : 0.65 } as const;
            return ok ? <a key={a.id} href={a.url!} target="_blank" rel="noopener noreferrer" style={st}>{inner}</a> : <div key={a.id} style={st}>{inner}</div>;
          })}
        </div>
      ) : null}
    </article>
  );
}
