// ---------------------------------------------------------------------------
// New email / Reply / Reply all / Forward (Mail Center v3, approved prototype
// compose page) — a page in the flow, not a layer. The rules are desktop's:
//   • compose.tsx: From = my pick → the draft's → my own mailbox → first one;
//     Send needs a From, ≥1 To, every address valid, a subject and a message;
//     Save draft keeps To / Cc / Bcc / subject / message on this device only
//     (never attachments); POST /compose; a queued send says so.
//   • detail.tsx: Reply From = my pick → my own mailbox → the thread's mailbox;
//     To / Cc pre-filled by mode (replyRecipients, our own addresses left out);
//     no subject field; POST /threads/:id/reply with afterMessageId; a 409
//     "a colleague already replied" offers Discard mine / Send mine too; the
//     20 s "writing a reply" heartbeat.
//   • Forward = "Fwd: " once, the whole conversation quoted newest first,
//     original attachments not carried, To blank, forwardOf sent.
//   • Recipients: chips; Enter / comma / semicolon / Tab add; a pasted
//     "Name <a@b>" list parses; Backspace on an empty box removes the last;
//     a bad address is red. Org chart picker = GET /directory.
//   • Attachments: images + PDF, 10 files, 5 MB in total (mail-attachments.ts).
//   • Request acknowledgement: 1 day / 2 days (default) / 3 days / 1 week; needs
//     at least one staff (@hookka.com) recipient.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, BadgeCheck, Camera, Check, ClipboardCheck, FileText, FileX, Image as ImageIcon, Info, Network, Paperclip, PenLine, Search, Send, ShoppingBag, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { BTN, BottomBar, C, Column, CommsScreen, CommsSheet, InfoNote, NUM, PickRow, Spinner, Switch, useToast } from "../comms-kit";
import { ConfirmDialog, type ConfirmSpec } from "../comms-overlay";
import {
  ACK_DUES, COMMIT_KEYS, addRecipients, forwardBody, forwardSubject, isStaffAddress, isValidEmail, mb, pasteCommits, replySubject, sendBlocker,
  type Directory, type DirectoryPerson, type ThreadDetail,
} from "./mail-lib";
import {
  MAIL_ATTACH_MAX_COUNT, MAIL_ATTACH_MAX_TOTAL_BYTES, agoLabel, alreadyRepliedFrom, decodedBase64Bytes, deleteDraft, isAllowedMailAttachment, joinNames, postCompose, postReply,
  readFileAsBase64, refreshThread, refreshThreads, replyRecipients, saveDraft, sentToast, useDrafts, useMailCtx, useReplyingHeartbeat, validateMailAttachments,
  type AlreadyReplied, type OutAttachment,
} from "./mail-api";
import { Avatar, PlainSelect } from "./mail-ui";
import { setFlash } from "./mail-store";

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";
/** Opened from another module (e.g. a PO's "Email to supplier"): starts filled, attachments included. */
export type MailPrefill = { to: string[]; cc?: string[]; subject: string; body: string; attachments?: OutAttachment[]; banner?: string; fromAddress?: string };

const HEAD: Record<ComposeMode, string> = { new: "New email", reply: "Reply", reply_all: "Reply all", forward: "Forward" };

export function MailComposer({ mode, threadId, draftId, prefill, onClose, onSent }: { mode: ComposeMode; threadId?: string; draftId?: string; prefill?: MailPrefill | null; onClose: () => void; onSent: (threadId?: string) => void }) {
  const ctx = useMailCtx();
  const isReply = mode === "reply" || mode === "reply_all";
  const threadQ = useCachedJson<ThreadDetail>(threadId && mode !== "new" ? `/api/mail-center/threads/${encodeURIComponent(threadId)}` : null, 30);
  const thread = threadQ.data;
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const newestId = messages.length ? messages[messages.length - 1].id : null;
  const threadMailbox = thread?.thread.mailboxAddress ?? "";
  const drafts = useDrafts();
  const draft = draftId ? drafts.find((d) => d.id === draftId) ?? null : null;
  const [toast, showToast] = useToast();

  // ---- the form (seeded once: a resumed draft, or a prefill) ----
  const [s0] = useState<{ to: string[]; cc: string[]; bcc: string[]; subject: string; body: string }>(() => {
    const split = (s?: string) => addRecipients([], s ?? "");
    return draft
      ? { to: split(draft.to), cc: split(draft.cc), bcc: split(draft.bcc), subject: draft.subject, body: draft.body }
      : prefill
        ? { to: prefill.to, cc: prefill.cc ?? [], bcc: [], subject: prefill.subject, body: prefill.body }
        : { to: [], cc: [], bcc: [], subject: "", body: "" };
  });
  const [manual, setManual] = useState<{ to: string[]; cc: string[]; bcc: string[] } | null>(isReply ? null : { to: s0.to, cc: s0.cc, bcc: s0.bcc });
  const [pending, setPending] = useState({ to: "", cc: "", bcc: "" });
  const [showCc, setShowCc] = useState(s0.cc.length > 0 || s0.bcc.length > 0);
  const [subject, setSubject] = useState(s0.subject);
  const [body, setBody] = useState(s0.body);
  const [fromOverride, setFromOverride] = useState(prefill?.fromAddress ?? "");
  const [files, setFiles] = useState<OutAttachment[]>(prefill?.attachments ?? []);
  const [attErr, setAttErr] = useState("");
  const [ack, setAck] = useState(false);
  const [ackHours, setAckHours] = useState(48);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<(AlreadyReplied & { now: number }) | null>(null);
  const [picker, setPicker] = useState<null | "to" | "cc">(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  // Forward: "Fwd: subject" once the conversation is here.
  const fwdSeeded = useRef(false);
  useEffect(() => {
    if (mode === "forward" && thread && !fwdSeeded.current) {
      fwdSeeded.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed when the conversation loads
      setSubject(forwardSubject(thread.thread.subject));
    }
  }, [mode, thread]);
  const quoted = mode === "forward" && thread ? forwardBody(messages) : "";

  // ---- From ----
  const active = ctx.addresses;
  const draftFrom = draft?.fromAddress ?? "";
  const from =
    (fromOverride && (active.some((a) => a.address === fromOverride) || (isReply && fromOverride === threadMailbox)) && fromOverride) ||
    (!isReply && draftFrom && active.some((a) => a.address === draftFrom) && draftFrom) ||
    ctx.myAddress ||
    (isReply ? threadMailbox : "") ||
    active[0]?.address ||
    "";
  const fromOpts = [
    ...(isReply && threadMailbox && !active.some((a) => a.address === threadMailbox) ? [{ v: threadMailbox, l: threadMailbox }] : []),
    ...active.map((a) => ({ v: a.address, l: a.label ? `${a.label} · ${a.address}` : a.address })),
  ];

  // ---- recipients: reply modes derive To / Cc until edited (desktop `manual`) ----
  const derived = useMemo(() => (isReply ? replyRecipients(messages, mode === "reply_all" ? "reply_all" : "reply", [from, threadMailbox].filter(Boolean)) : null), [isReply, messages, mode, from, threadMailbox]);
  const to = manual?.to ?? derived?.to ?? [];
  const cc = manual?.cc ?? derived?.cc ?? [];
  const bcc = manual?.bcc ?? [];
  const edit = (patch: Partial<{ to: string[]; cc: string[]; bcc: string[] }>) => setManual({ to, cc, bcc, ...patch });
  const ccShown = showCc || cc.length > 0 || bcc.length > 0;

  // ---- reply guard heartbeat ----
  const beat = useReplyingHeartbeat(isReply ? threadId ?? null : null, isReply && body.trim().length > 0);
  useEffect(() => {
    if (threadId && beat.latestMessageId && newestId && beat.latestMessageId !== newestId) refreshThread(threadId);
  }, [threadId, beat.latestMessageId, newestId]);
  const replyingNow = isReply ? (body.trim() ? beat.replying : thread?.replying ?? []) : [];

  const fullText = mode === "forward" ? `${body}${body.trim() ? "\n\n" : ""}${quoted}` : body;
  const why = sendBlocker({ from, to, cc, bcc, pending: [pending.to, pending.cc, pending.bcc].map((x) => x.trim()).filter(Boolean).find((x) => !isValidEmail(x)) ?? "", subject, body: fullText, ack, reply: isReply });
  const noFrom = active.length === 0;
  const can = !why && !busy && !conflict && ctx.canCreate && (!isReply || !!thread);
  const staffN = [...to, ...cc, ...bcc].filter(isStaffAddress).length;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const dirty = !!(subject.trim() !== s0.subject.trim() || body !== s0.body || files.length !== (prefill?.attachments?.length ?? 0) || (manual && (manual.to.join() !== s0.to.join() || manual.cc.join() !== s0.cc.join() || manual.bcc.join() !== s0.bcc.join())));
  const canSaveDraft = mode === "new" && !noFrom && !busy && (to.length > 0 || cc.length > 0 || bcc.length > 0 || !!subject.trim() || !!body.trim());

  const cancel = () => {
    if (busy) return;
    if (!dirty) return onClose();
    setConfirm({ title: "Discard this email?", body: mode === "new" ? "What you've written will be lost. Save a draft to keep it." : "What you've written will be lost.", okLabel: "Discard", danger: true, icon: X, onOk: () => { setConfirm(null); onClose(); } });
  };

  const addFiles = async (picked: File[]) => {
    setAttachOpen(false);
    if (!picked.length) return;
    setAttErr("");
    const bad = picked.find((f) => !isAllowedMailAttachment(f.name));
    if (bad) return setAttErr(`"${bad.name}" is not an allowed type. Only images and PDF files can be attached.`);
    if (totalBytes + picked.reduce((n, f) => n + f.size, 0) > MAIL_ATTACH_MAX_TOTAL_BYTES) return setAttErr("Attachments exceed the 5.0 MB limit.");
    let read: OutAttachment[];
    try {
      read = await Promise.all(picked.map(async (f) => { const b64 = await readFileAsBase64(f); return { name: f.name, type: f.type, size: decodedBase64Bytes(b64), contentBase64: b64 }; }));
    } catch {
      return setAttErr("Could not read one of the files. Please try again.");
    }
    const next = [...files, ...read];
    const check = validateMailAttachments(next.map((f) => ({ filename: f.name, contentBase64: f.contentBase64 })));
    if (!check.ok) return setAttErr(check.error ?? "Invalid attachments.");
    setFiles(next);
  };

  const send = async (force = false) => {
    if (!can && !(force && conflict)) {
      setTried(true);
      return;
    }
    setBusy(true);
    if (isReply && threadId) {
      const r = await postReply(threadId, { text: body.trim(), afterMessageId: newestId, force, mode: mode === "reply_all" ? "reply_all" : "reply", to, cc, bcc, ackDueHours: ack ? ackHours : null, fromAddress: from, files });
      setBusy(false);
      if (!r.ok) {
        const hit = alreadyRepliedFrom(r.status, r.data);
        if (hit) {
          setConflict({ ...hit, now: Date.now() });
          refreshThread(threadId);
          return;
        }
        return showToast(r.error || "Failed to send reply. Please try again.");
      }
      refreshThread(threadId);
      refreshThreads();
      setFlash(sentToast(r.data?.queued, "Reply sent."));
      return onSent(threadId);
    }
    const r = await postCompose({ fromAddress: from, to, cc, bcc, subject, text: fullText, forwardOf: mode === "forward" ? threadId : undefined, ackDueHours: ack ? ackHours : null, files });
    setBusy(false);
    if (!r.ok || !r.data?.ok) return showToast(r.data?.error || (!r.ok ? r.error : "") || "Failed to send email. Please try again.");
    if (draftId) deleteDraft(draftId);
    refreshThreads();
    setFlash(sentToast(r.data.queued, "Email sent."));
    onSent(r.data.threadId);
  };

  if (picker) {
    return (
      <OrgPicker
        already={{ to, cc, bcc }}
        onCancel={() => setPicker(null)}
        onAdd={(list, field) => {
          edit(field === "to" ? { to: addRecipients(to, list.join(",")) } : { cc: addRecipients(cc, list.join(",")) });
          if (field === "cc") setShowCc(true);
          setPicker(null);
          showToast(`Added ${list.length} to ${field === "to" ? "To" : "Cc"}`);
        }}
      />
    );
  }

  const fieldRows: ReactNode[] = [
    <RecipientRow key="to" label="To" list={to} text={pending.to} onText={(v) => setPending((p) => ({ ...p, to: v }))} onList={(l) => edit({ to: l })} onOrg={() => setPicker("to")} placeholder="Email address" />,
  ];
  if (ccShown) {
    fieldRows.push(<RecipientRow key="cc" label="Cc" list={cc} text={pending.cc} onText={(v) => setPending((p) => ({ ...p, cc: v }))} onList={(l) => edit({ cc: l })} onOrg={() => setPicker("cc")} />);
    fieldRows.push(<RecipientRow key="bcc" label="Bcc" list={bcc} text={pending.bcc} onText={(v) => setPending((p) => ({ ...p, bcc: v }))} onList={(l) => edit({ bcc: l })} />);
  }

  return (
    <CommsScreen>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper, paddingTop: "env(safe-area-inset-top)", borderBottom: `1px solid ${C.hair}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 52, padding: "0 14px" }}>
          <button type="button" onClick={cancel} style={{ ...BTN, height: 44, marginLeft: -6, padding: "0 6px", background: "none", fontSize: 14, fontWeight: 600, color: C.muted }}>Cancel</button>
          <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{HEAD[mode]}</div>
          <button type="button" onClick={() => setAttachOpen(true)} aria-label="Attach images or PDF" disabled={busy} style={{ ...BTN, width: 44, height: 44, background: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 42, height: 42, borderRadius: "50%", background: C.card, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--c-sh-field)" }}><Paperclip size={18} strokeWidth={2} /></span>
          </button>
        </div>
      </div>

      <Column max={760}>
        <div style={{ padding: "12px 16px 130px", display: "flex", flexDirection: "column", gap: 12 }}>
          {prefill?.banner ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 12, background: C.tealBg, color: "var(--mc-teal-ink)", fontSize: 12.5, fontWeight: 600 }}>
              <ShoppingBag size={14} strokeWidth={2.2} style={{ flex: "none" }} />{prefill.banner}
            </div>
          ) : null}
          {replyingNow.length ? (
            <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 14, background: C.amberBg, color: C.amber, fontSize: 12.5, lineHeight: 1.45, boxShadow: "var(--mc-guard-ring)" }}>
              <PenLine size={16} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
              <span><b>{joinNames(replyingNow.map((r) => r.name))}</b> {replyingNow.length === 1 ? "is" : "are"} writing a reply to this conversation now. Check with them before you reply too.</span>
            </div>
          ) : null}

          <div style={{ borderRadius: 16, background: C.card, boxShadow: "var(--mc-msg-sh)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "0 12px", borderBottom: `1px solid ${C.hair}` }}>
              <span style={{ width: 44, flex: "none", fontSize: 12.5, fontWeight: 700, color: C.gold }}>From</span>
              {noFrom ? (
                <span style={{ flex: 1, fontSize: 12.5, color: C.red, fontWeight: 600, lineHeight: 1.4, padding: "8px 0" }}>You have no @hookka.com mailbox assigned, so you can't send. Ask an admin to assign one.</span>
              ) : fromOpts.length > 1 ? (
                <PlainSelect value={from} onChange={setFromOverride} options={fromOpts} label="From mailbox" size={15} disabled={busy} />
              ) : (
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fromOpts[0]?.l ?? from}</span>
              )}
            </div>
            {fieldRows}
            {!ccShown ? (
              <button type="button" onClick={() => setShowCc(true)} style={{ ...BTN, width: "100%", minHeight: 44, borderBottom: `1px solid ${C.hair}`, background: "none", fontSize: 12.5, fontWeight: 700, color: C.gold, textAlign: "left", padding: "0 12px 0 66px" }}>Add Cc / Bcc</button>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "0 12px" }}>
              <span style={{ width: 44, flex: "none", fontSize: 12.5, fontWeight: 700, color: C.gold }}>Subject</span>
              {isReply ? (
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thread ? replySubject(thread.thread.subject) : "…"}</span>
              ) : (
                <input className="c-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" disabled={busy}
                  style={{ flex: 1, minWidth: 0, height: 44, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, fontWeight: 600, color: C.ink, padding: 0 }} />
              )}
            </div>
          </div>

          <textarea className="c-input" value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder={mode === "forward" ? "Add a message (optional)" : "Write your message"} aria-label="Message" disabled={busy}
            style={{ width: "100%", boxSizing: "border-box", minHeight: 180, padding: "12px 13px", borderRadius: 16, border: "none", background: C.card, boxShadow: "var(--mc-msg-sh)", fontFamily: "inherit", fontSize: 16, lineHeight: 1.5, color: C.ink, outline: "none", resize: "vertical" }} />

          {quoted ? (
            <>
              <div className="c-scroll" style={{ borderRadius: 14, padding: "10px 12px", background: "var(--mc-quote-bg)", fontSize: 12, lineHeight: 1.5, color: C.body, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 180, overflow: "auto" }}>
                <b style={{ display: "block", fontSize: 10.5, letterSpacing: ".6px", color: C.gold, marginBottom: 4 }}>FORWARDED CONVERSATION · NEWEST FIRST</b>
                {quoted}
              </div>
              <div style={{ fontSize: 11, color: C.faint, padding: "0 4px" }}>Original attachments aren't forwarded.</div>
            </>
          ) : mode === "forward" && !thread ? <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}><Spinner /> Loading the conversation…</div> : null}

          {files.length ? (
            <div style={{ display: "grid", gap: 6 }}>
              {files.map((f, i) => {
                const pdf = /\.pdf$/i.test(f.name);
                return (
                  <div key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "6px 4px 6px 10px", borderRadius: 12, background: C.card, boxShadow: "var(--c-sh-ring)" }}>
                    <span style={{ width: 34, height: 34, flex: "none", borderRadius: 9, background: pdf ? C.redBg : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {pdf ? <FileText size={16} strokeWidth={2} color="var(--c-red)" /> : <ImageIcon size={16} strokeWidth={2} color="var(--c-gold)" />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: C.muted, ...NUM }}>{pdf ? "PDF" : "Image"} · {mb(f.size)} MB</span>
                    </span>
                    <button type="button" onClick={() => { setFiles((l) => l.filter((_, j) => j !== i)); setAttErr(""); }} aria-label={`Remove ${f.name}`} disabled={busy} style={{ ...BTN, width: 44, height: 44, background: "none", color: C.faint, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={16} strokeWidth={2} /></button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "0 4px", fontSize: 11, color: totalBytes > MAIL_ATTACH_MAX_TOTAL_BYTES ? C.red : C.faint }}>
            <span>Images and PDF only · up to {MAIL_ATTACH_MAX_COUNT} files</span>
            <span style={{ ...NUM, whiteSpace: "nowrap" }}>{files.length}/{MAIL_ATTACH_MAX_COUNT} · {mb(totalBytes)} of 5 MB</span>
          </div>
          {attErr ? (
            <div role="alert" style={{ display: "flex", gap: 8, padding: "9px 11px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12, lineHeight: 1.45 }}>
              <FileX size={15} strokeWidth={2} style={{ flex: "none" }} /><span>{attErr}</span>
            </div>
          ) : null}

          <div style={{ borderRadius: 16, background: C.card, boxShadow: "var(--mc-msg-sh)", padding: "4px 12px" }}>
            <button type="button" role="switch" aria-checked={ack} onClick={() => setAck(!ack)} disabled={busy} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, background: "none", textAlign: "left" }}>
              <ClipboardCheck size={17} strokeWidth={2} color="var(--c-gold)" style={{ flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.ink }}>Request acknowledgement</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>Staff recipients confirm from the thread; overdue ones are reminded by email.</span>
              </span>
              <Switch on={ack} />
            </button>
            {ack ? (
              <>
                <div role="radiogroup" aria-label="Acknowledge within" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: "0 0 10px" }}>
                  {ACK_DUES.map((d) => {
                    const on = ackHours === d.hours;
                    return (
                      <button key={d.hours} type="button" role="radio" aria-checked={on} onClick={() => setAckHours(d.hours)}
                        style={{ ...BTN, minHeight: 40, borderRadius: 10, background: on ? "#6B5C32" : C.card, color: on ? "#FFFFFF" : C.chipText, boxShadow: on ? "var(--c-sh-chip-on)" : "var(--c-sh-chip)", fontSize: 12, fontWeight: on ? 700 : 600, whiteSpace: "nowrap" }}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                {!staffN ? <div style={{ padding: "0 0 10px", fontSize: 11.5, color: C.red }}>Add at least one staff (@hookka.com) recipient.</div> : null}
              </>
            ) : null}
          </div>

          {conflict ? (
            <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", borderRadius: 14, background: C.redBg, boxShadow: "0 0 0 1px var(--c-red-ring)" }}>
              <p style={{ margin: 0, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: C.ink }}>
                <AlertTriangle size={16} strokeWidth={2} color="var(--c-red)" style={{ flex: "none", marginTop: 1 }} />
                <span><b>{conflict.by}</b> replied {agoLabel(conflict.at, conflict.now)}, while you were writing. Their reply is now in the conversation. <b>Yours has not been sent.</b></span>
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <button type="button" disabled={busy} onClick={() => { setConflict(null); setBody(""); setFiles([]); onClose(); }} style={{ ...BTN, height: 44, borderRadius: 12, background: C.card, color: C.body, fontSize: 13, fontWeight: 700, boxShadow: "var(--c-sh-ring)" }}>Discard mine</button>
                <button type="button" disabled={busy} onClick={() => void send(true)} style={{ ...BTN, height: 44, borderRadius: 12, background: C.grad, color: "#FFFFFF", fontSize: 13, fontWeight: 700 }}>Send mine too</button>
              </div>
            </div>
          ) : null}

          {(tried || noFrom) && why ? <InfoNote icon={Info} style={{ padding: "0 4px" }}>{why}</InfoNote> : null}
          {!noFrom && from ? <div style={{ fontSize: 11, color: C.faint, padding: "0 4px" }}>Sent via Brevo from {from}.</div> : null}
        </div>
      </Column>

      <BottomBar>
        <div style={{ display: "grid", gridTemplateColumns: mode === "new" ? "minmax(0,1fr) minmax(0,1.6fr)" : "minmax(0,1fr)", gap: 8, padding: "12px 16px" }}>
          {mode === "new" ? (
            <button type="button" disabled={!canSaveDraft} onClick={() => {
              saveDraft({ id: draftId ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `d${Date.now()}`), to: to.join(", "), cc: cc.join(", "), bcc: bcc.join(", "), subject: subject.trim(), body, fromAddress: from, updatedAt: Date.now() });
              showToast(files.length ? "Draft saved on this device · attachments aren't kept" : "Draft saved on this device");
              setTimeout(onClose, 600);
            }} style={{ ...BTN, height: 50, borderRadius: 14, background: C.card, color: C.gold, fontSize: 14, fontWeight: 700, boxShadow: "var(--c-sh-secondary)", opacity: canSaveDraft ? 1 : 0.5 }}>Save draft</button>
          ) : null}
          <button type="button" onClick={() => void send()} aria-disabled={!can}
            style={{ ...BTN, height: 50, borderRadius: 14, background: can ? C.grad : C.line, color: can ? "#FFFFFF" : C.faint, fontSize: 15, fontWeight: 700, cursor: can ? "pointer" : "default", boxShadow: can ? "var(--c-sh-cta)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy ? <Spinner size={14} color="#FFFFFF" /> : <Send size={17} strokeWidth={2.2} />}
            {busy ? "Sending…" : isReply ? "Send reply" : "Send"}
          </button>
        </div>
      </BottomBar>

      <CommsSheet open={attachOpen} onClose={() => setAttachOpen(false)} title="Attach" sub="Images and PDF · up to 10 files, 5 MB in total">
        <div style={{ padding: "4px 16px calc(24px + env(safe-area-inset-bottom))", display: "grid", gap: 8 }}>
          <PickRow icon={Camera} label="Take a photo" sub="Opens the camera" fg="var(--c-gold)" bg="var(--c-cream)" onClick={() => camRef.current?.click()} />
          <PickRow icon={ImageIcon} label="Photo library" sub="Pick one or more images" fg="var(--c-gold)" bg="var(--c-cream)" onClick={() => libRef.current?.click()} />
          <PickRow icon={FileText} label="PDF from files" sub="Pick one or more PDF files" fg="var(--c-red)" bg="var(--c-red-bg)" onClick={() => pdfRef.current?.click()} />
        </div>
      </CommsSheet>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(l); }} />
      <input ref={libRef} type="file" accept="image/*" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(l); }} />
      <input ref={pdfRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(l); }} />
      <ConfirmDialog spec={confirm} onCancel={() => setConfirm(null)} />
      {toast}
    </CommsScreen>
  );
}

/** One To / Cc / Bcc row as chips (desktop RecipientsInput rules). */
function RecipientRow({ label, list, text, onText, onList, onOrg, placeholder }: { label: string; list: string[]; text: string; onText: (v: string) => void; onList: (l: string[]) => void; onOrg?: () => void; placeholder?: string }) {
  const commit = (raw: string) => {
    const next = addRecipients(list, raw);
    if (next.length !== list.length) onList(next);
    onText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (COMMIT_KEYS.includes(e.key)) {
      if (text.trim()) {
        e.preventDefault();
        commit(text);
      }
      return;
    }
    if (e.key === "Backspace" && !text && list.length) {
      e.preventDefault();
      onList(list.slice(0, -1));
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const p = e.clipboardData.getData("text");
    if (pasteCommits(p)) {
      e.preventDefault();
      commit(`${text}${p}`);
    }
  };
  const bad = list.filter((a) => !isValidEmail(a));
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 6px 8px 12px", borderBottom: `1px solid ${C.hair}` }}>
        <span style={{ width: 44, flex: "none", fontSize: 12.5, fontWeight: 700, color: C.gold, paddingTop: 11 }}>{label}</span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", paddingTop: 2 }}>
          {list.map((a) => {
            const ok = isValidEmail(a);
            const staff = ok && isStaffAddress(a);
            return (
              <button key={a} type="button" onClick={() => onList(list.filter((x) => x !== a))} aria-label={`Remove ${a}`} title={ok ? a : "Not a valid email address"}
                style={{ ...BTN, minHeight: 32, maxWidth: "100%", padding: "0 7px 0 10px", borderRadius: 999, background: !ok ? C.redBg : staff ? C.tint : C.track, color: !ok ? C.red : staff ? C.gold : C.body, boxShadow: ok ? "none" : "var(--mc-chip-bad-ring)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                {staff ? <BadgeCheck size={12} strokeWidth={2.2} style={{ flex: "none" }} /> : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a}</span>
                <X size={12} strokeWidth={2.4} style={{ flex: "none" }} />
              </button>
            );
          })}
          <input className="c-input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} onBlur={() => { if (text.trim()) commit(text); }}
            placeholder={list.length ? "" : placeholder ?? ""} aria-label={`${label} recipients`}
            style={{ flex: 1, minWidth: 80, height: 36, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: C.ink, padding: 0 }} />
        </div>
        {onOrg ? (
          <button type="button" onClick={onOrg} aria-label={`Pick staff from the org chart for ${label}`} style={{ ...BTN, width: 44, height: 44, flex: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 38, height: 38, borderRadius: "50%", background: C.cream, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}><Network size={16} strokeWidth={2} /></span>
          </button>
        ) : null}
      </div>
      {bad.length ? <div style={{ padding: "6px 12px", background: C.redBg, color: C.red, fontSize: 11.5 }}>Not a valid email address: {bad.join(", ")}</div> : null}
    </>
  );
}

type Group = "department" | "team" | "managers" | "everyone";
const GROUPS: { id: Group; label: string }[] = [
  { id: "department", label: "Department" },
  { id: "team", label: "My team" },
  { id: "managers", label: "My managers" },
  { id: "everyone", label: "Everyone" },
];

/** Org chart picker (desktop recipient-picker.tsx): tick people, add to To or Cc. */
function OrgPicker({ already, onCancel, onAdd }: { already: { to: string[]; cc: string[]; bcc: string[] }; onCancel: () => void; onAdd: (list: string[], field: "to" | "cc") => void }) {
  const { data, error, refresh } = useCachedJson<Directory>("/api/mail-center/directory", 120);
  const [grp, setGrp] = useState<Group>("department");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const on = (list: string[], e: string) => list.some((x) => x.toLowerCase() === e.toLowerCase());
  const where = (e: string) => (on(already.to, e) ? "In To" : on(already.cc, e) ? "In Cc" : on(already.bcc, e) ? "In Bcc" : "");
  const needle = q.trim().toLowerCase();
  const rows: DirectoryPerson[] = (data?.[grp] ?? []).filter((p) => !needle || `${p.name} ${p.email} ${p.position} ${p.department}`.toLowerCase().includes(needle));
  const n = sel.length;
  return (
    <CommsScreen>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper, paddingTop: "env(safe-area-inset-top)", borderBottom: `1px solid ${C.hair}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 52, padding: "0 14px" }}>
          <button type="button" onClick={onCancel} style={{ ...BTN, height: 44, marginLeft: -6, padding: "0 6px", background: "none", fontSize: 14, fontWeight: 600, color: C.muted }}>Cancel</button>
          <div style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 700 }}>Add staff</div>
          <span style={{ width: 56 }} />
        </div>
      </div>
      <Column max={760}>
        <div style={{ padding: "10px 16px 0" }}>
          <div role="group" aria-label="Group" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 3, minHeight: 46, boxSizing: "border-box", padding: 3, borderRadius: 12, background: C.track }}>
            {GROUPS.map((g) => {
              const active = grp === g.id;
              return (
                <button key={g.id} type="button" aria-pressed={active} onClick={() => setGrp(g.id)}
                  style={{ ...BTN, borderRadius: 9, background: active ? C.card : "transparent", color: active ? C.ink : C.body, fontWeight: active ? 700 : 600, boxShadow: active ? "var(--c-sh-seg-on)" : "none", fontSize: 11.5, whiteSpace: "nowrap", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.15, minWidth: 0, overflow: "hidden" }}>
                  {g.label}
                  <span style={{ fontSize: 10, opacity: 0.75, ...NUM }}>{data ? data[g.id].length : ""}</span>
                </button>
              );
            })}
          </div>
          <label style={{ marginTop: 10, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: C.card, borderRadius: 12, boxShadow: "var(--c-sh-ring)" }}>
            <Search size={16} strokeWidth={1.9} color="var(--c-faint)" />
            <input className="c-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or position" aria-label="Search staff" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: C.ink, padding: 0 }} />
          </label>
        </div>
        <div style={{ padding: "10px 16px 130px" }}>
          {!data ? (
            error ? (
              <div role="alert" style={{ padding: 16, borderRadius: 14, background: C.redBg, color: C.red, fontSize: 12.5 }}>Couldn't load the org chart: {error} <button type="button" onClick={() => refresh()} style={{ ...BTN, background: "none", color: C.red, fontWeight: 700, textDecoration: "underline" }}>Try again</button></div>
            ) : <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted, padding: 12 }}><Spinner /> Loading the org chart…</div>
          ) : (
            <div style={{ borderRadius: 14, background: C.card, boxShadow: "var(--mc-msg-sh)", overflow: "hidden" }}>
              {rows.map((p, i) => {
                const al = where(p.email);
                const ticked = sel.includes(p.email) || !!al;
                return (
                  <button key={p.key} type="button" role="checkbox" aria-checked={ticked} disabled={!!al || !p.email} onClick={() => setSel((s) => (s.includes(p.email) ? s.filter((x) => x !== p.email) : [...s, p.email]))}
                    style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 12px", borderTop: i ? `1px solid ${C.hair}` : "none", background: sel.includes(p.email) ? C.rowOn : "transparent", textAlign: "left", cursor: al ? "default" : "pointer" }}>
                    <span style={{ width: 22, height: 22, flex: "none", borderRadius: 7, background: ticked ? "#6B5C32" : C.card, boxShadow: ticked ? "none" : "inset 0 0 0 1.5px var(--c-sand)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", opacity: al ? 0.6 : 1 }}>
                      {ticked ? <Check size={14} strokeWidth={3} /> : null}
                    </span>
                    <Avatar name={p.name} size={32} font={11} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.ink }}>{p.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[p.position, p.department, p.email].filter(Boolean).join(" · ")}</span>
                    </span>
                    {al ? <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, background: C.greenBg, color: C.green, fontSize: 10, fontWeight: 700 }}>{al}</span> : null}
                  </button>
                );
              })}
              {!rows.length ? <div style={{ padding: 18, textAlign: "center", fontSize: 12.5, color: C.muted }}>Nobody matches.</div> : null}
            </div>
          )}
        </div>
      </Column>
      <BottomBar>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, padding: "12px 16px" }}>
          <button type="button" disabled={!n} onClick={() => onAdd(sel, "cc")} style={{ ...BTN, height: 48, borderRadius: 14, background: C.card, color: C.gold, fontSize: 13.5, fontWeight: 700, boxShadow: "var(--c-sh-secondary)", opacity: n ? 1 : 0.5 }}>{n ? `Add ${n} to Cc` : "Add to Cc"}</button>
          <button type="button" disabled={!n} onClick={() => onAdd(sel, "to")} style={{ ...BTN, height: 48, borderRadius: 14, background: C.grad, color: "#FFFFFF", fontSize: 13.5, fontWeight: 700, opacity: n ? 1 : 0.5 }}>{n ? `Add ${n} to To` : "Add to To"}</button>
        </div>
      </BottomBar>
    </CommsScreen>
  );
}
