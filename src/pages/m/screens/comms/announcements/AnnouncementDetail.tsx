// ---------------------------------------------------------------------------
// /m/announcements/:id — Announcements v3 detail (approved prototype).
//
// Hero (category, state, title, message, attachments) · info rows · read
// receipts (GET /:id/acks) with Remind unread / Remind all · Hide / Show ·
// Delete. Each action is shown only to the permission the API checks:
// remind + hide = announcements:update, delete = announcements:delete.
//
// "Remind all" resets every receipt on the server (routes/announcements.ts
// POST /:id/remind scope=all deletes announcement_acks), so its confirmation
// says so and the receipts reload from 0 of N afterwards.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  BellRing, CalendarDays, CheckCheck, ChevronRight, Clock, CloudOff, ExternalLink, Eye, EyeOff, FileText, Film,
  Info, ListOrdered, Megaphone, Play, Repeat, RotateCw, Trash2, User, Users, type LucideIcon,
} from "lucide-react";
import { invalidateCachePrefix, useCachedJson } from "@/lib/cached-fetch";
import {
  BTN, C, Column, CommsScreen, CommsSheet, GLASS, GhostButton, InfoNote, NUM, PANEL, PageBar, Pill, PrimaryButton, Segmented,
  Skeletons, Spinner, StateCard, avatarOf, fmtDate, fmtTime, useToast,
} from "../comms-kit";
import { ConfirmDialog, MediaViewer, type ConfirmSpec, type ViewerItem } from "../comms-overlay";
import { kindLabel } from "../comms-files";
import { CATEGORY_LABEL, STATUS_LABEL, annStatus, orderChip, readPct, readReceipts, recipientLabel, sentToLine, type Ann, type Receipts } from "./ann-lib";
import { ANN_LIST_URL, CAT_UI, STATUS_UI, fileUrl, useAnnList, useAnnPerms, usePeople } from "./ann-ui";

type Tab = "ack" | "pending";

export function AnnouncementDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { list, loading, error, refresh } = useAnnList();
  const a = list?.find((x) => x.id === id) ?? null;
  const back = () => navigate("/m/announcements");

  return (
    <CommsScreen>
      <PageBar title="Announcement" onBack={back} backLabel="Back to announcements" />
      <Column max={680}>
        <div style={{ padding: "0 16px 34px", display: "flex", flexDirection: "column", gap: 12 }}>
          {a ? (
            <Detail key={a.id} a={a} />
          ) : loading && !list ? (
            <Skeletons label="Loading announcement" n={2} h={180} />
          ) : error ? (
            // Hook-error gate: a failed (re)load is never "not found" — a stale cached list may simply predate the notice.
            <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load this announcement" text="Check your connection and try again."
              action={<PrimaryButton height={44} icon={RotateCw} onClick={() => refresh()} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5 }}>Try again</PrimaryButton>} />
          ) : (
            <StateCard icon={Megaphone} title="Announcement not found" text="It may have been deleted." action={<GhostButton onClick={back}>Back to announcements</GhostButton>} />
          )}
        </div>
      </Column>
    </CommsScreen>
  );
}

function Detail({ a }: { a: Ann }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { canUpdate, canDelete } = useAnnPerms();
  const { deptName, workerById } = usePeople();
  const acksUrl = `/api/announcements/${encodeURIComponent(a.id)}/acks`;
  const acks = useCachedJson<unknown>(acksUrl, 30);
  const receipts = acks.data ? readReceipts(acks.data) : null;
  const [tab, setTab] = useState<Tab>(params.get("tab") === "pending" ? "pending" : "ack");
  const [allOpen, setAllOpen] = useState<Tab | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState<"" | "dialog" | "hide">("");
  const [viewer, setViewer] = useState<ViewerItem | null>(null);
  const [toast, showToast] = useToast();

  const st = annStatus(a);
  const cat = CAT_UI[a.category];
  const label = recipientLabel(a, deptName);
  const order = orderChip(a);
  const media = a.attachments.filter((x) => x.kind === "image" || x.kind === "video");
  const files = a.attachments.filter((x) => x.kind !== "image" && x.kind !== "video");

  const info: { icon: LucideIcon; k: string; v: string }[] = [
    ...(order ? [{ icon: ListOrdered, k: "Order", v: order }] : []),
    { icon: Users, k: "Sent to", v: sentToLine(label, receipts?.total ?? null, a.targetType) },
    { icon: CalendarDays, k: "Posted", v: a.createdAt ? `${fmtDate(a.createdAt)} · ${fmtTime(a.createdAt)}` : "—" },
    ...(a.createdByName ? [{ icon: User, k: "By", v: a.createdByName }] : []),
    ...(a.expiresAt ? [{ icon: Clock, k: st === "expired" ? "Hid on" : "Hides on", v: `${fmtDate(a.expiresAt)} · ${fmtTime(a.expiresAt)}` }] : []),
  ];

  async function call(path: string, init: RequestInit): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
    try {
      const res = await fetch(path, init);
      const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      if (res.ok && body.success !== false) return { ok: true, body };
      return { ok: false, error: String(body.error || `Request failed (${res.status})`) };
    } catch {
      return { ok: false, error: "Could not reach the server. Check your connection and try again." };
    }
  }

  const remind = (scope: "unacked" | "all", n: number) => {
    const worker = (k: number) => (k === 1 ? "worker" : "workers");
    setConfirm(
      scope === "unacked"
        ? {
            title: `Remind ${n} ${worker(n)}?`,
            body: "Only workers who haven't acknowledged will see this announcement again the next time they open their app.",
            okLabel: "Send reminder",
            icon: BellRing,
            onOk: () => doRemind("unacked"),
          }
        : {
            title: `Remind all ${n} recipients?`,
            body: `Everyone it was sent to, including those who already acknowledged, sees it again the next time they open their app. Their read receipts are reset, so the count starts again from 0 of ${n}.`,
            okLabel: "Remind all",
            icon: Repeat,
            onOk: () => doRemind("all"),
          },
    );
  };

  async function doRemind(scope: "unacked" | "all") {
    setBusy("dialog");
    const r = await call(`/api/announcements/${encodeURIComponent(a.id)}/remind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
    setBusy("");
    setConfirm(null);
    if (!r.ok) return showToast(`Couldn't send the reminder: ${r.error}`);
    const count = typeof r.body.pendingCount === "number" ? r.body.pendingCount : 0;
    if (scope === "all") {
      showToast(`Reminder set for all ${count} recipients. Receipts start again from 0.`);
      setTab("pending");
    } else {
      showToast(count === 0 ? "Everyone has acknowledged — no one to remind" : `Reminder set for ${count} ${count === 1 ? "worker" : "workers"}`);
    }
    invalidateCachePrefix(acksUrl);
    acks.refresh();
  }

  async function toggleHide() {
    setBusy("hide");
    const r = await call(`/api/announcements/${encodeURIComponent(a.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !a.isActive }) });
    setBusy("");
    if (!r.ok) return showToast(`Couldn't ${a.isActive ? "hide" : "show"} it: ${r.error}`);
    showToast(a.isActive ? "Announcement hidden" : "Announcement is showing again");
    invalidateCachePrefix(ANN_LIST_URL);
  }

  const askDelete = () =>
    setConfirm({
      title: "Delete this announcement?",
      body: `"${a.title}" and its read receipts are removed for everyone. This can't be undone.`,
      okLabel: "Delete",
      danger: true,
      icon: Trash2,
      onOk: async () => {
        setBusy("dialog");
        const r = await call(`/api/announcements/${encodeURIComponent(a.id)}`, { method: "DELETE" });
        setBusy("");
        setConfirm(null);
        if (!r.ok) return showToast(`Couldn't delete it: ${r.error}`);
        invalidateCachePrefix(ANN_LIST_URL);
        navigate("/m/announcements", { replace: true, state: { toast: "Announcement deleted" } });
      },
    });

  return (
    <>
      {/* hero */}
      <section style={GLASS}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Pill label={CATEGORY_LABEL[a.category]} fg={cat.fg} bg={cat.bg} icon={cat.icon} h={22} size={11} />
          <Pill label={STATUS_LABEL[st]} fg={STATUS_UI[st].fg} bg={STATUS_UI[st].bg} h={22} size={11} />
        </div>
        <h1 style={{ margin: "10px 0 0", fontSize: 20, fontWeight: 700, letterSpacing: "-.3px", lineHeight: 1.3, color: C.ink, textWrap: "pretty", wordBreak: "break-word" }}>{a.title || "—"}</h1>
        {a.body ? (
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: C.body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a.body}</p>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: C.faint }}>No message.</p>
        )}
        {a.attachments.length ? (
          <>
            <div style={{ marginTop: 14, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold, ...NUM }}>ATTACHMENTS · {a.attachments.length}</div>
            {media.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                {media.map((f) => (
                  <button key={f.fileId} type="button" onClick={() => setViewer({ name: f.name, url: fileUrl(f.fileId), kind: f.kind === "video" ? "video" : "image" })} aria-label={`Open ${f.name}`}
                    style={{ ...BTN, position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "linear-gradient(140deg,#B9AC97,#8B7A4E)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(31,29,27,.06)" }}>
                    {f.kind === "image" ? (
                      <img src={fileUrl(f.fileId)} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <>
                        <Film size={22} strokeWidth={1.6} color="#FFFFFF" style={{ position: "absolute", top: 8, left: 8, opacity: 0.7 }} />
                        <span style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(31,29,27,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}><Play size={16} strokeWidth={2.2} color="#FFFFFF" fill="#FFFFFF" /></span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : null}
            {files.length ? (
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {files.map((f) => (
                  <a key={f.fileId} href={fileUrl(f.fileId)} target="_blank" rel="noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "8px 12px", borderRadius: 12, background: C.card, textDecoration: "none", boxShadow: "var(--c-sh-ring)" }}>
                    <span style={{ width: 32, height: 32, flex: "none", borderRadius: 9, background: f.kind === "pdf" ? C.redBg : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <FileText size={16} strokeWidth={2} color={f.kind === "pdf" ? "var(--c-red)" : "var(--c-gold)"} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 1 }}>{kindLabel(f.kind)} · opens in a new tab</span>
                    </span>
                    <ExternalLink size={15} strokeWidth={2} color="var(--c-gold-mid)" />
                  </a>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {/* info rows */}
      <section style={{ ...PANEL, boxShadow: "var(--c-sh-info)" }}>
        {info.map((r, i) => (
          <div key={r.k} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 14px", borderTop: i ? `1px solid ${C.hair}` : "none" }}>
            <span style={{ flex: "none", width: 26, height: 26, borderRadius: 8, background: C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}><r.icon size={13} strokeWidth={2} color="var(--c-gold)" /></span>
            <span style={{ flex: "none", width: 92, fontSize: 12, color: C.muted, paddingTop: 5 }}>{r.k}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: C.ink, paddingTop: 4, lineHeight: 1.4, textAlign: "right", wordBreak: "break-word" }}>{r.v}</span>
          </div>
        ))}
      </section>

      {/* read receipts */}
      <section style={GLASS}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: C.gradTile, display: "flex", alignItems: "center", justifyContent: "center" }}><CheckCheck size={16} strokeWidth={2} color="#FFFFFF" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.2px" }}>Read receipts</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Workers tap "Got it" in their app</div>
          </div>
        </div>
        <div style={{ height: 1, background: C.divider, margin: "14px 0 12px" }} />
        {receipts ? (
          <ReceiptBlock r={receipts} posted={a.createdAt} tab={tab} setTab={setTab} sub={(id, empNo) => subOf(id, empNo, workerById, deptName)} onAll={() => setAllOpen(tab)} />
        ) : acks.loading ? (
          <div aria-busy="true" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", fontSize: 12.5, color: C.muted }}><Spinner size={14} /> Loading read receipts…</div>
        ) : (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: C.red }}>
            Couldn't load read receipts.
            <GhostButton height={36} onClick={() => acks.refresh()}>Try again</GhostButton>
          </div>
        )}
        {canUpdate && receipts ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
              <button type="button" disabled={receipts.pending.length === 0} onClick={() => remind("unacked", receipts.pending.length)}
                style={{ ...BTN, height: 44, borderRadius: 12, background: receipts.pending.length ? C.grad : C.track, color: receipts.pending.length ? "#FFFFFF" : C.faint, fontSize: 12.5, fontWeight: 700, cursor: receipts.pending.length ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: receipts.pending.length ? "0 8px 16px -10px rgba(107,92,50,.7)" : "none" }}>
                <BellRing size={15} strokeWidth={2} />Remind unread
              </button>
              <button type="button" disabled={receipts.total === 0} onClick={() => remind("all", receipts.total)}
                style={{ ...BTN, height: 44, borderRadius: 12, background: C.card, color: C.gold, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "var(--c-sh-secondary)", opacity: receipts.total === 0 ? 0.55 : 1 }}>
                <Repeat size={15} strokeWidth={2} />Remind all
              </button>
            </div>
            <InfoNote icon={Info} style={{ marginTop: 10 }}>
              A reminder shows the announcement again the next time each worker opens their app. "Remind all" also resets the receipts.
            </InfoNote>
          </>
        ) : null}
      </section>

      {/* manage */}
      {canUpdate || canDelete ? (
        <>
          <section style={PANEL}>
            {canUpdate ? (
              <ManageRow icon={a.isActive ? EyeOff : Eye} label={a.isActive ? "Hide announcement" : "Show announcement"} sub={a.isActive ? "Workers stop seeing it; receipts are kept" : "Workers can see it again"} busy={busy === "hide"} onClick={toggleHide} chevron />
            ) : null}
            {canDelete ? <ManageRow icon={Trash2} danger label="Delete announcement" sub="Removes it for everyone, with its receipts" onClick={askDelete} top={canUpdate} /> : null}
          </section>
          <InfoNote icon={Info} style={{ padding: "0 4px" }}>Announcements can't be edited after posting. Hide it and post a new one instead.</InfoNote>
        </>
      ) : null}

      {receipts ? (
        <CommsSheet open={allOpen !== null} onClose={() => setAllOpen(null)} title="Recipients" sub={`Read ${receipts.ackedCount} of ${receipts.total}`}>
          <div style={{ padding: "4px 16px 8px" }}>
            <Segmented label="Receipt list" value={allOpen ?? "ack"} onChange={(k) => setAllOpen(k)} items={[{ key: "ack", label: "Acknowledged", count: receipts.acked.length }, { key: "pending", label: "Not yet", count: receipts.pending.length }]} />
          </div>
          <div style={{ padding: "0 16px 30px" }}>
            <ReceiptRows r={receipts} tab={allOpen ?? "ack"} posted={a.createdAt} long sub={(id, empNo) => subOf(id, empNo, workerById, deptName)} />
          </div>
        </CommsSheet>
      ) : null}
      <ConfirmDialog spec={confirm} busy={busy === "dialog"} onCancel={() => setConfirm(null)} />
      <MediaViewer item={viewer} onClose={() => setViewer(null)} />
      {toast}
    </>
  );
}

function subOf(id: string, empNo: string, byId: Map<string, { dept: string }>, deptName: (c: string) => string): string {
  const d = byId.get(id)?.dept;
  return [empNo, d ? deptName(d) : ""].filter(Boolean).join(" · ");
}

function ReceiptBlock({ r, posted, tab, setTab, sub, onAll }: { r: Receipts; posted: string | null; tab: Tab; setTab: (t: Tab) => void; sub: (id: string, empNo: string) => string; onAll: () => void }) {
  const { pct, tone } = readPct(r);
  const pc = tone === "green" ? C.green : tone === "amber" ? C.amber : C.red;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px", ...NUM }}>{r.ackedCount}</span>
        <span style={{ fontSize: 13, color: C.muted, ...NUM }}>of {r.total} read</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: pc, ...NUM }}>{pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: C.track, overflow: "hidden", marginTop: 8 }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: C.barOk }} />
      </div>
      <div style={{ paddingTop: 12 }}>
        <Segmented label="Receipt list" value={tab} onChange={setTab} items={[{ key: "ack", label: "Acknowledged", count: r.acked.length }, { key: "pending", label: "Not yet", count: r.pending.length }]} />
      </div>
      <div style={{ marginTop: 10 }}>
        <ReceiptRows r={r} tab={tab} posted={posted} sub={sub} limit={5} />
      </div>
      {r.total > 5 ? (
        <GhostButton onClick={onAll} style={{ width: "100%", marginTop: 10 }}>
          See all {r.total} recipients
          <ChevronRight size={15} strokeWidth={2.2} />
        </GhostButton>
      ) : null}
    </>
  );
}

function ReceiptRows({ r, tab, posted, sub, limit, long }: { r: Receipts; tab: Tab; posted: string | null; sub: (id: string, empNo: string) => string; limit?: number; long?: boolean }) {
  const rows = tab === "ack" ? r.acked : r.pending;
  const shown = limit ? rows.slice(0, limit) : rows;
  const postedDay = posted ? new Date(posted).toDateString() : "";
  return (
    <div style={{ borderRadius: 14, background: C.card, boxShadow: "var(--c-sh-panel)", overflow: "hidden" }}>
      {shown.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: C.muted }}>
          {long ? "Nobody here." : tab === "ack" ? "Nobody has acknowledged yet." : "Everyone has acknowledged."}
        </div>
      ) : (
        shown.map((p, i) => {
          const at = "ackedAt" in p ? (p as { ackedAt: string | null }).ackedAt : null;
          const av = avatarOf(p.name || p.empNo);
          const right = tab === "pending" ? "Not yet" : at ? (long || new Date(at).toDateString() !== postedDay ? `${fmtDate(at).replace(/ \d{4}$/, "")} · ${fmtTime(at)}` : fmtTime(at)) : "Acknowledged";
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? `1px solid ${C.hair}` : "none" }}>
              <span style={{ width: 30, height: 30, flex: "none", borderRadius: "50%", background: av.bg, color: av.fg, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{av.ini}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name || p.empNo || p.id}</span>
                <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 1 }}>{sub(p.id, p.empNo)}</span>
              </span>
              <span style={{ flex: "none", fontSize: 11.5, fontWeight: 600, color: tab === "pending" ? C.faint : C.green, ...NUM }}>{right}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function ManageRow({ icon: Icon, label, sub, onClick, danger, busy, chevron, top }: { icon: LucideIcon; label: string; sub: string; onClick: () => void; danger?: boolean; busy?: boolean; chevron?: boolean; top?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} aria-busy={busy || undefined}
      style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "10px 14px", background: "none", textAlign: "left", borderTop: top ? `1px solid ${C.hair}` : "none" }}>
      <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: danger ? C.redBg : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {busy ? <Spinner size={14} /> : <Icon size={16} strokeWidth={2} color={danger ? "var(--c-red)" : "var(--c-gold)"} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: danger ? C.red : C.ink }}>{label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{sub}</span>
      </span>
      {chevron ? <ChevronRight size={16} strokeWidth={2} color="var(--c-chev)" /> : null}
    </button>
  );
}
