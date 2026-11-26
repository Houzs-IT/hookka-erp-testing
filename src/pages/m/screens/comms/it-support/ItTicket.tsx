// ---------------------------------------------------------------------------
// /m/it-support?ticket=CODE — one IT request (IT Support v3, approved prototype).
//
// Desktop rules (src/pages/it-support/index.tsx `Ticket`):
//   • GET /tickets/:code every 30 s; opening it marks it seen, so the list
//     reloads (onChanged).
//   • Reply = POST /tickets/:code/replies (words and/or files) → reload. The
//     hub decides any status change; the phone never sets one.
//   • "Yes, it is fixed" only at resolved → POST /tickets/:code/confirm → reload.
//   • closed / rejected take no replies.
// No "which part of the system" line here: the ticket detail does not carry it.
// ---------------------------------------------------------------------------
import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Camera, Check, CircleAlert, CloudOff, Folder, Image as ImageIcon, Lock, Paperclip, RotateCw, SendHorizontal, X } from "lucide-react";
import { useInterval } from "@/lib/scheduler";
import {
  BTN, BottomBar, C, Column, CommsScreen, CommsSheet, GLASS, GhostButton, NUM, PageBar, PickRow, PrimaryButton, Skeletons, Spinner, StateCard,
  fmtDay, fmtTime, useToast,
} from "../comms-kit";
import { ConfirmDialog, MediaViewer, type ConfirmSpec, type ViewerItem } from "../comms-overlay";
import { IT_FILE_ACCEPT, itAddFiles, kindOf } from "../comms-files";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL, closedCopy, isClosed, priorityTone, readDetail, statusTone, timeline, type TicketDetail } from "./it-lib";
import { attachmentUrl, itApi } from "./it-api";
import { FILE_ICON, PRIORITY_ICON, eventIcon } from "./it-ui";

export function ItTicket({ code, onChanged, onBack, onNew }: { code: string; onChanged: () => void; onBack: () => void; onNew: () => void }) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloading, setReloading] = useState(false);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"" | "reply" | "confirm">("");
  const [error, setError] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [viewer, setViewer] = useState<ViewerItem | null>(null);
  const [toast, showToast] = useToast();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const res = await itApi<unknown>(`/tickets/${encodeURIComponent(code)}`);
    if (res.ok) {
      const d = readDetail(res.data);
      if (d) {
        setDetail(d);
        setLoadError("");
        // Opening a ticket marks it seen on the hub: the list's "New reply" is now stale.
        onChanged();
        return;
      }
      setLoadError("The server's answer could not be read.");
    } else {
      setLoadError(res.error);
    }
  }, [code, onChanged]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open (desktop pattern)
    void load();
  }, [load]);
  useInterval(load, 30_000);

  const retry = async () => {
    setReloading(true);
    await load();
    setReloading(false);
  };

  const header = (
    <PageBar
      title={code}
      onBack={onBack}
      backLabel="Back to requests"
      right={detail ? <StatusPill status={detail.status} /> : null}
    />
  );

  if (!detail) {
    return (
      <CommsScreen>
        {header}
        <Column max={720}>
          <div style={{ padding: "0 16px 24px" }}>
            {loadError ? (
              <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't open this request" text={loadError}
                action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
                  <PrimaryButton height={44} busy={reloading} icon={RotateCw} onClick={retry} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5 }}>Try again</PrimaryButton>
                  <GhostButton height={44} onClick={onBack}>Back to my requests</GhostButton>
                </div>} />
            ) : (
              <Skeletons label="Loading request" n={2} h={150} />
            )}
          </div>
        </Column>
      </CommsScreen>
    );
  }

  const st = detail.status;
  const closed = isClosed(st);
  const canSend = !!(reply.trim() || files.length) && busy === "";
  const ur = priorityTone(detail.priority);
  const UrIcon = PRIORITY_ICON[detail.priority];
  const items = timeline(detail.events);
  const cc = closedCopy(st);

  const addFiles = (picked: File[]) => {
    setPickOpen(false);
    const { files: next, rejected } = itAddFiles(files, picked);
    setFiles(next);
    if (rejected.length) showToast(rejected.join(" "));
  };

  const sendReply = async () => {
    if (!reply.trim() && files.length === 0) return setError("Write a reply or attach a file.");
    setError("");
    setBusy("reply");
    const form = new FormData();
    if (reply.trim()) form.set("body", reply.trim());
    for (const f of files) form.append("files", f, f.name);
    const res = await itApi(`/tickets/${encodeURIComponent(code)}/replies`, { method: "POST", body: form });
    setBusy("");
    if (!res.ok) return setError(res.error);
    setReply("");
    setFiles([]);
    if (replyRef.current) replyRef.current.style.height = "44px";
    showToast("Reply sent");
    await load();
  };

  const askConfirm = () =>
    setConfirm({
      title: "Close this request?",
      body: "You're confirming the problem is fixed. The request closes and replies turn off.",
      okLabel: "Yes, it's fixed",
      cancelLabel: "Not yet",
      onOk: async () => {
        setBusy("confirm");
        const res = await itApi(`/tickets/${encodeURIComponent(code)}/confirm`, { method: "POST" });
        setBusy("");
        setConfirm(null);
        if (!res.ok) return setError(res.error);
        setError("");
        showToast(`${code} closed. Thank you for confirming.`);
        await load();
      },
    });

  const openAttachment = (a: { id: number; filename: string; mime: string }) => {
    const k = kindOf(a.mime, a.filename);
    if (k === "image" || k === "video") setViewer({ name: a.filename, url: attachmentUrl(a.id), kind: k });
    else window.open(attachmentUrl(a.id), "_blank", "noopener");
  };

  const dockH = closed ? 0 : st === "resolved" ? 200 : 96;

  return (
    <CommsScreen>
      {header}
      <Column max={720}>
        <div style={{ padding: `0 16px ${dockH + 20}px`, display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={GLASS}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-.3px", lineHeight: 1.3, textWrap: "pretty", wordBreak: "break-word" }}>{detail.title || "—"}</h1>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 12 }}>
              <Tile k="Kind">{TYPE_LABEL[detail.type] ?? detail.type ?? "—"}</Tile>
              <Tile k="Urgency"><span style={{ display: "flex", alignItems: "center", gap: 4, color: ur.fg }}><UrIcon size={12} strokeWidth={2.4} />{PRIORITY_LABEL[detail.priority]}</span></Tile>
              <Tile k="Handler"><span style={{ color: detail.assignee ? C.ink : C.faint }}>{detail.assignee || "Not picked up yet"}</span></Tile>
            </div>
            {detail.description ? <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.55, color: C.body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail.description}</p> : null}
            <div style={{ marginTop: 10, fontSize: 11.5, color: C.faint, ...NUM }}>Sent {fmtDay(detail.createdAt)} {fmtTime(detail.createdAt)}</div>
          </section>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px 0" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold }}>CONVERSATION</span>
            <span style={{ flex: 1, height: 1, background: C.divider }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((m) =>
              m.type === "evt" ? (
                <EventRow key={m.id} who={m.who} text={m.text} at={m.at} kind={m.kind} to={m.to} />
              ) : (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.mine ? "flex-end" : "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, padding: "0 4px", fontSize: 11, color: C.muted }}>
                    {m.it ? <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--it-avatar)", color: "#FFFFFF", fontSize: 8.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>IT</span> : null}
                    <b style={{ color: C.ink }}>{m.who}</b>
                    <span style={{ color: C.faint, ...NUM }}>{fmtDay(m.at)} · {fmtTime(m.at)}</span>
                  </div>
                  <div style={{ maxWidth: "86%", padding: "10px 12px", borderRadius: m.mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: m.mine ? C.tint : C.card, boxShadow: m.mine ? "none" : "var(--c-sh-ring)", fontSize: 13.5, lineHeight: 1.5, color: C.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {m.text}
                    {m.attachments.length ? (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: m.text ? 8 : 0 }}>
                        {m.attachments.map((a) => {
                          const Icon = FILE_ICON[kindOf(a.mime, a.filename)];
                          return (
                            <button key={a.id} type="button" onClick={() => openAttachment(a)} style={{ ...BTN, height: 30, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px", borderRadius: 999, background: C.card, boxShadow: "var(--c-sh-ring)", color: C.body, fontSize: 11.5, fontWeight: 600, maxWidth: "100%" }}>
                              <Icon size={12} strokeWidth={2} style={{ flex: "none" }} />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
                            </button>
                          );
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              ),
            )}
          </div>

          {closed ? (
            <div style={{ borderRadius: 16, padding: 14, background: C.card, boxShadow: "var(--c-sh-panel)", display: "flex", gap: 10 }}>
              <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: C.track, display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={15} strokeWidth={2} color="var(--c-muted)" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{cc.title}</div>
                <div style={{ fontSize: 12, lineHeight: 1.45, color: C.body, marginTop: 2 }}>{cc.sub}</div>
                <GhostButton onClick={onNew} height={38} style={{ marginTop: 10, fontSize: 12.5, padding: "0 14px" }}>Report a new problem</GhostButton>
              </div>
            </div>
          ) : null}
          {closed && error ? <div role="alert" style={{ fontSize: 12.5, color: C.red }}>{error}</div> : null}
        </div>
      </Column>

      {!closed ? (
        <BottomBar background="var(--c-paper)">
          {st === "resolved" ? (
            <div style={{ margin: "10px 12px 0", padding: "12px 14px", borderRadius: 16, background: C.greenBg, boxShadow: "0 0 0 1px var(--c-green-ring)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flex: "none", color: C.green, display: "flex" }}><Check size={18} strokeWidth={2.4} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.greenInk }}>IT says this is done. Is it fixed?</div>
                  <div style={{ fontSize: 11.5, color: C.body, marginTop: 2, lineHeight: 1.4 }}>If not, reply below and it goes back to IT.</div>
                </div>
              </div>
              <button type="button" onClick={askConfirm} disabled={busy !== ""} style={{ ...BTN, marginTop: 10, width: "100%", height: 44, borderRadius: 12, background: "#4F7C3A", color: "#FFFFFF", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy !== "" ? 0.7 : 1 }}>
                {busy === "confirm" ? <Spinner size={14} color="#FFFFFF" /> : <Check size={16} strokeWidth={2.6} />}
                {busy === "confirm" ? "Closing…" : "Yes, it is fixed"}
              </button>
            </div>
          ) : null}
          <div style={{ padding: "8px 12px 12px" }}>
            {error ? (
              <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "0 4px 8px", fontSize: 12, lineHeight: 1.4, color: C.red }}>
                <CircleAlert size={14} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
                <span style={{ flex: 1 }}>{error}</span>
              </div>
            ) : null}
            {files.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 0 8px" }}>
                {files.map((f, i) => {
                  const Icon = FILE_ICON[kindOf(f.type, f.name)];
                  return (
                    <button key={`${f.name}-${i}`} type="button" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} disabled={busy !== ""}
                      style={{ ...BTN, height: 30, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px 0 10px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 11.5, fontWeight: 600, maxWidth: "100%" }}>
                      <Icon size={12} strokeWidth={2} style={{ flex: "none" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <X size={12} strokeWidth={2.4} style={{ flex: "none" }} />
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setPickOpen(true)} aria-label="Attach a file" disabled={busy !== ""} style={{ ...BTN, width: 44, height: 44, flex: "none", borderRadius: "50%", background: C.card, boxShadow: "var(--c-sh-ring)", color: C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Paperclip size={18} strokeWidth={2} />
              </button>
              <textarea ref={replyRef} className="c-input" value={reply} maxLength={10000} rows={1} disabled={busy === "reply"}
                onChange={(e) => {
                  setReply(e.target.value);
                  // Grow with the text (44 → 120 px), as a chat box does; the placeholder never grows it.
                  const el = e.currentTarget;
                  el.style.height = "44px";
                  if (el.value) el.style.height = `${Math.min(120, el.scrollHeight)}px`;
                }}
                placeholder={st === "resolved" ? "Not fixed? Tell IT what's still wrong" : "Reply to IT"} aria-label="Reply to IT"
                style={{ flex: 1, minWidth: 0, minHeight: 44, maxHeight: 120, boxSizing: "border-box", padding: "11px 14px", borderRadius: 22, border: "none", background: C.card, boxShadow: "var(--c-sh-ring)", fontFamily: "inherit", fontSize: 16, lineHeight: 1.35, color: C.ink, outline: "none", resize: "none", height: 44, overflowY: "auto" } as CSSProperties} />
              <button type="button" onClick={() => void sendReply()} aria-label={busy === "reply" ? "Sending" : "Send reply"} aria-disabled={!canSend} disabled={!canSend}
                style={{ ...BTN, width: 44, height: 44, flex: "none", borderRadius: "50%", background: canSend || busy === "reply" ? C.grad : C.line, color: canSend || busy === "reply" ? "#FFFFFF" : C.faint, display: "flex", alignItems: "center", justifyContent: "center", cursor: canSend ? "pointer" : "default", boxShadow: canSend ? "0 8px 16px -8px rgba(107,92,50,.7)" : "none" }}>
                {busy === "reply" ? <Spinner size={16} color="#FFFFFF" /> : <SendHorizontal size={18} strokeWidth={2.2} />}
              </button>
            </div>
          </div>
        </BottomBar>
      ) : null}

      <CommsSheet open={pickOpen} onClose={() => setPickOpen(false)} title="Add a file" sub="Up to 5 files, 10 MB each · images, PDF, MP4, MOV, ZIP">
        <div style={{ display: "grid", gap: 8, padding: "4px 16px 30px" }}>
          <PickRow icon={Camera} label="Take a photo" sub="Use the phone camera" fg="var(--c-gold)" bg={C.cream} onClick={() => camRef.current?.click()} />
          <PickRow icon={ImageIcon} label="Photo or video" sub="From your gallery" fg="var(--c-teal)" bg={C.tealBg} onClick={() => libRef.current?.click()} />
          <PickRow icon={Folder} label="Files" sub="PDF, ZIP and more" fg="var(--c-red)" bg={C.redBg} onClick={() => fileRef.current?.click()} />
        </div>
      </CommsSheet>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={libRef} type="file" accept="image/*,video/mp4,video/quicktime" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept={IT_FILE_ACCEPT} multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <ConfirmDialog spec={confirm} busy={busy === "confirm"} onCancel={() => setConfirm(null)} />
      <MediaViewer item={viewer} onClose={() => setViewer(null)} />
      {toast}
    </CommsScreen>
  );
}

function StatusPill({ status }: { status: TicketDetail["status"] }) {
  const t = statusTone(status);
  return (
    <span style={{ height: 24, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", flex: "none" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot }} />{STATUS_LABEL[status]}
    </span>
  );
}

function Tile({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0, padding: "8px 10px", borderRadius: 12, background: C.card, boxShadow: "var(--c-sh-panel)" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".3px", color: C.gold, textTransform: "uppercase" }}>{k}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 3, lineHeight: 1.3, color: C.ink, wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function EventRow({ who, text, at, kind, to }: { who: string; text: string; at: string; kind: string; to: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 6px", fontSize: 11.5, color: C.muted }}>
      <span style={{ width: 22, height: 22, flex: "none", borderRadius: "50%", background: C.track, display: "flex", alignItems: "center", justifyContent: "center" }}>{createElement(eventIcon(kind, to), { size: 11, strokeWidth: 2.2, color: "var(--c-gold)" })}</span>
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}><b style={{ color: C.ink, fontWeight: 700 }}>{who}</b> {text}</span>
      <span style={{ flex: "none", color: C.faint, ...NUM }}>{fmtDay(at)} · {fmtTime(at)}</span>
    </div>
  );
}
