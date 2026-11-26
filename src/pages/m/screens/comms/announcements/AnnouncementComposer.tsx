// ---------------------------------------------------------------------------
// /m/announcements?new=1 — the Announcements v3 composer (approved prototype).
//
// Same request as the desktop composer (src/pages/announcements.tsx):
//   • each file uploads to /api/files the moment it is picked (resourceType
//     "announcement", resourceId "compose"); the post carries {fileId,name,mime}.
//     A failed upload keeps its File so Retry can send it again.
//   • POST /api/announcements { title, body, expiresAt?, attachments,
//     targetDeptCodes, targetWorkerIds, category } — empty lists = everyone.
// Only announcements:create sees this page; the API checks the same.
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Check, CircleAlert, FileText, Film, Image as ImageIcon, Lock, Paperclip, Search, Send, X } from "lucide-react";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import {
  BTN, BottomBar, C, Column, CommsScreen, CommsSheet, Counter, DashedButton, ErrorBox, FieldError, FieldHead, FormBar, NUM, PickRow,
  PrimaryButton, Segmented, Spinner, StateCard, Switch, chipStyle, fieldStyle,
} from "../comms-kit";
import { ConfirmDialog, type ConfirmSpec } from "../comms-overlay";
import { ANN_ACCEPT_MEDIA, ANN_ACCEPT_PDF, ANN_MAX_FILE_BYTES, formatBytes, kindLabel, kindOf } from "../comms-files";
import { CATEGORY_LABEL, composeBody, composerErrors, errorSentence, type AnnCategory, type Audience } from "./ann-lib";
import { ANN_LIST_URL, CAT_UI, useAnnPerms, usePeople } from "./ann-ui";

type Upload = { id: string; file: File; state: "up" | "ok" | "fail"; error?: string; fileId?: string; name: string; mime: string };

const CATS: AnnCategory[] = ["GENERAL", "WARNING", "SOP", "LEARNING"];

export function AnnouncementComposer() {
  const navigate = useNavigate();
  const { canCreate, loading: permLoading } = useAnnPerms();
  const { depts, workers, workersLoading, workersError } = usePeople();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<AnnCategory>("GENERAL");
  const [audience, setAudience] = useState<Audience>("all");
  const [selDepts, setSelDepts] = useState<string[]>([]);
  const [selPeople, setSelPeople] = useState<string[]>([]);
  const [pq, setPq] = useState("");
  const [hideOn, setHideOn] = useState(false);
  const [hideDate, setHideDate] = useState("");
  const [hideTime, setHideTime] = useState("18:00");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [rejected, setRejected] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const active = useMemo(() => (workers ?? []).filter((w) => w.active), [workers]);
  const perDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of active) m.set(w.dept, (m.get(w.dept) ?? 0) + 1);
    return m;
  }, [active]);
  const deptPeople = active.filter((w) => selDepts.includes(w.dept)).length;
  const pqn = pq.trim().toLowerCase();
  const peopleList = active.filter((w) => !pqn || w.name.toLowerCase().includes(pqn) || w.empNo.toLowerCase().includes(pqn));
  const deptNameOf = (code: string) => depts.find((d) => d.code === code)?.name ?? code;

  const uploading = uploads.some((u) => u.state === "up");
  const failed = uploads.some((u) => u.state === "fail");
  const errs = composerErrors({ title, audience, depts: selDepts, people: selPeople, hideOn, hideDate, hideTime, uploading, failed });
  const tErr = tried && !title.trim();
  const dErr = tried && audience === "depts" && !selDepts.length;
  const pErr = tried && audience === "people" && !selPeople.length;
  const hErr = tried && hideOn && errs.includes("set the date and time to hide it");
  const dirty = !!(title || message || uploads.length);

  if (permLoading) {
    return (
      <CommsScreen>
        <FormBar title="New announcement" onCancel={() => navigate("/m/announcements", { replace: true })} />
        <div aria-busy="true" style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner size={18} /></div>
      </CommsScreen>
    );
  }
  if (!canCreate) {
    return (
      <CommsScreen>
        <FormBar title="New announcement" onCancel={() => navigate("/m/announcements", { replace: true })} />
        <div style={{ padding: 16 }}><StateCard icon={Lock} title="You can't post announcements" text="Ask an admin for the Announcements create permission." /></div>
      </CommsScreen>
    );
  }

  async function upload(u: Upload) {
    const fd = new FormData();
    fd.append("file", u.file);
    fd.append("resourceType", "announcement");
    fd.append("resourceId", "compose");
    let next: Partial<Upload>;
    try {
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { id: string; filename?: string; contentType?: string } } | null;
      next = res.ok && j?.success && j.data
        ? { state: "ok", fileId: j.data.id, name: j.data.filename || u.name, mime: j.data.contentType || u.mime }
        : { state: "fail", error: j?.error || `Upload failed (${res.status})` };
    } catch {
      next = { state: "fail", error: "Network error" };
    }
    setUploads((list) => list.map((x) => (x.id === u.id ? { ...x, ...next } : x)));
  }

  function addFiles(picked: File[]) {
    setPickOpen(false);
    const notes: string[] = [];
    const added: Upload[] = [];
    for (const f of picked) {
      if (f.size > ANN_MAX_FILE_BYTES) notes.push(`${f.name} wasn't added — files can be up to 50 MB.`);
      else if (uploads.some((u) => u.file.name === f.name && u.file.size === f.size && u.file.lastModified === f.lastModified)) notes.push(`${f.name} is already attached.`);
      else added.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f, state: "up", name: f.name, mime: f.type });
    }
    setRejected(notes.join(" "));
    if (!added.length) return;
    setUploads((list) => [...list, ...added]);
    added.forEach((u) => void upload(u));
  }

  function retry(u: Upload) {
    const again = { ...u, state: "up" as const, error: undefined };
    setUploads((list) => list.map((x) => (x.id === u.id ? again : x)));
    void upload(again);
  }

  function chooseAudience(k: Audience) {
    setAudience(k);
    // Desktop resetTargeting: back to "All workers" clears both pickers.
    if (k === "all") {
      setSelDepts([]);
      setSelPeople([]);
      setPq("");
    }
  }

  async function post() {
    setTried(true);
    setPostError("");
    if (errs.length) return;
    setBusy(true);
    const body = composeBody({
      title, message, category, audience, depts: selDepts, people: selPeople, hideOn, hideDate, hideTime,
      attachments: uploads.filter((u) => u.state === "ok" && u.fileId).map((u) => ({ fileId: u.fileId!, name: u.name, mime: u.mime })),
    });
    try {
      const res = await fetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { id?: string } | null } | null;
      if (!res.ok || j?.success === false) {
        setBusy(false);
        return setPostError(j?.error || `Couldn't post it (${res.status}).`);
      }
      invalidateCachePrefix(ANN_LIST_URL);
      const id = j?.data?.id;
      navigate(id ? `/m/announcements?posted=${encodeURIComponent(id)}` : "/m/announcements", { replace: true });
    } catch {
      setBusy(false);
      setPostError("Could not reach the server. Check your connection and try again.");
    }
  }

  const cancel = () => {
    const leave = () => navigate("/m/announcements", { replace: true });
    if (!dirty) return leave();
    setConfirm({ title: "Discard this announcement?", body: "What you've typed and attached will be lost.", okLabel: "Discard", danger: true, icon: X, onOk: () => { setConfirm(null); leave(); } });
  };

  const tog = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <CommsScreen>
      <FormBar title="New announcement" onCancel={cancel} cancelDisabled={busy} />
      <Column max={640}>
        <div style={{ padding: "14px 16px 120px", display: "flex", flexDirection: "column", gap: 18 }}>
          {postError ? <ErrorBox icon={CircleAlert}>{postError}</ErrorBox> : tried && errs.length ? <ErrorBox icon={CircleAlert}>{errorSentence(errs)}</ErrorBox> : null}

          <div>
            <FieldHead label="Title" htmlFor="an-title" required right={<Counter text={`${title.length} / 200`} warn={title.length >= 190} />} />
            <input id="an-title" className="c-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value.slice(0, 200))} placeholder="e.g. Factory closed on Deepavali" aria-invalid={tErr} style={{ ...fieldStyle(tErr), height: 46, padding: "0 13px" }} />
            {tErr ? <FieldError>A title is required.</FieldError> : null}
          </div>

          <div>
            <FieldHead label="Message" htmlFor="an-msg" optional />
            <textarea id="an-msg" className="c-input" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="What do workers need to know?" style={{ ...fieldStyle(), padding: "11px 13px", lineHeight: 1.45, resize: "vertical" }} />
          </div>

          <div>
            <FieldHead label="Attachments" optional right={<span style={{ fontSize: 11, color: C.faint }}>Images, videos, PDFs</span>} />
            <div style={{ display: "grid", gap: 6 }}>
              {uploads.map((u) => {
                const k = kindOf(u.mime, u.name);
                const tone = k === "pdf" ? { bg: C.redBg, fg: "var(--c-red)", icon: FileText } : k === "video" ? { bg: C.tealBg, fg: "var(--c-teal)", icon: Film } : { bg: C.cream, fg: "var(--c-gold)", icon: ImageIcon };
                const Icon = tone.icon;
                const status = u.state === "up" ? "Uploading…" : u.state === "fail" ? `Upload failed${u.error ? ` — ${u.error}` : ""}` : `${kindLabel(k)} · ${formatBytes(u.file.size)}`;
                return (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 6px 8px 10px", borderRadius: 12, background: C.card, boxShadow: u.state === "fail" ? "0 0 0 1.5px var(--c-red-ring)" : "var(--c-sh-ring)" }}>
                    <span style={{ width: 36, height: 36, flex: "none", borderRadius: 9, background: tone.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={17} strokeWidth={1.9} color={tone.fg} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: u.state === "fail" ? C.red : C.muted, marginTop: 2 }}>
                        {u.state === "up" ? <Spinner /> : null}
                        {status}
                      </span>
                    </span>
                    {u.state === "fail" ? (
                      <button type="button" onClick={() => retry(u)} style={{ ...BTN, height: 32, padding: "0 10px", borderRadius: 999, background: C.redBg, color: C.red, fontSize: 12, fontWeight: 700 }}>Retry</button>
                    ) : null}
                    <button type="button" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.name}`} style={{ ...BTN, width: 40, height: 40, flex: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint }}>
                      <X size={17} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
              {rejected ? <ErrorBox icon={CircleAlert}>{rejected}</ErrorBox> : null}
              <DashedButton icon={Paperclip} onClick={() => setPickOpen(true)}>Add files</DashedButton>
            </div>
          </div>

          <div>
            <FieldHead label="Category" />
            <div role="radiogroup" aria-label="Category" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {CATS.map((k) => {
                const on = category === k;
                const ui = CAT_UI[k];
                const Icon = ui.icon;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setCategory(k)}
                    style={{ ...BTN, height: 46, borderRadius: 12, background: on ? ui.bg : C.card, boxShadow: on ? `0 0 0 1.5px ${ui.fg}` : "var(--c-sh-ring)", color: C.ink, fontSize: 13, fontWeight: on ? 700 : 600, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minWidth: 0 }}>
                    <span style={{ width: 24, height: 24, flex: "none", borderRadius: 7, background: on ? ui.fg : ui.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={13} strokeWidth={2.2} color={on ? "var(--c-card)" : ui.fg} />
                    </span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{CATEGORY_LABEL[k]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <FieldHead label="Send to" />
            <Segmented role="radiogroup" label="Recipients" value={audience} onChange={chooseAudience} items={[{ key: "all", label: "All workers" }, { key: "depts", label: "Departments" }, { key: "people", label: "People" }]} />
            {audience === "all" ? (
              <div style={{ marginTop: 8, fontSize: 12, color: C.muted, ...NUM }}>{workers ? `Every active worker · ${active.length} ${active.length === 1 ? "person" : "people"}` : "Every active worker"}</div>
            ) : null}

            {audience === "depts" ? (
              <>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: C.muted }}>Pick one or more</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.gold, ...NUM }}>{selDepts.length ? `${selDepts.length} selected${workers ? ` · ${deptPeople} ${deptPeople === 1 ? "person" : "people"}` : ""}` : "None selected"}</span>
                </div>
                {depts.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {depts.map((d) => {
                      const on = selDepts.includes(d.code);
                      return (
                        <button key={d.code} type="button" role="checkbox" aria-checked={on} onClick={() => setSelDepts((l) => tog(l, d.code))}
                          style={{ ...BTN, ...chipStyle(on), height: 36, padding: "0 12px", borderRadius: 999, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                          {on ? <Check size={13} strokeWidth={2.6} /> : null}
                          {d.name}
                          {workers ? <span style={{ opacity: 0.75, ...NUM }}>{perDept.get(d.code) ?? 0}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: C.muted }}>Departments couldn't be loaded.</div>
                )}
                {dErr ? <FieldError>Pick at least one department.</FieldError> : null}
              </>
            ) : null}

            {audience === "people" ? (
              <>
                {selPeople.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {selPeople.map((id) => {
                      const w = (workers ?? []).find((x) => x.id === id);
                      const n = w?.name || id;
                      return (
                        <button key={id} type="button" onClick={() => setSelPeople((l) => l.filter((x) => x !== id))} aria-label={`Remove ${n}`}
                          style={{ ...BTN, height: 30, padding: "0 8px 0 11px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                          {n}<X size={12} strokeWidth={2.4} />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <label style={{ marginTop: 10, height: 42, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: C.card, borderRadius: 12, boxShadow: "var(--c-sh-ring)" }}>
                  <Search size={16} strokeWidth={1.9} color="var(--c-faint)" />
                  <input className="c-input" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Name or employee no." aria-label="Search workers" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: C.ink, padding: 0 }} />
                </label>
                <div className="c-scroll" style={{ marginTop: 8, borderRadius: 14, background: C.card, boxShadow: "var(--c-sh-panel)", overflowY: "auto", maxHeight: 264 }}>
                  {workersLoading && !workers ? (
                    <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted }}><Spinner size={13} /> Loading workers…</div>
                  ) : workersError ? (
                    <div style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: C.red }}>The worker list couldn't be loaded.</div>
                  ) : peopleList.length === 0 ? (
                    <div style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: C.muted }}>No active worker matches.</div>
                  ) : (
                    peopleList.map((w, i) => {
                      const on = selPeople.includes(w.id);
                      return (
                        <button key={w.id} type="button" role="checkbox" aria-checked={on} onClick={() => setSelPeople((l) => tog(l, w.id))}
                          style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", borderTop: i ? `1px solid ${C.hair}` : "none", background: on ? C.rowOn : "transparent", textAlign: "left" }}>
                          <span style={{ width: 22, height: 22, flex: "none", borderRadius: 7, background: on ? "#6B5C32" : C.card, boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--c-sand)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
                            {on ? <Check size={14} strokeWidth={3} /> : null}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.ink }}>{w.name}</span>
                            <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1, ...NUM }}>{[w.empNo, deptNameOf(w.dept)].filter(Boolean).join(" · ")}</span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, fontSize: 11.5 }}>
                  <span style={{ color: C.faint }}>Only active workers are listed</span>
                  <span style={{ fontWeight: 700, color: C.gold, ...NUM }}>{selPeople.length ? `${selPeople.length} selected` : "None selected"}</span>
                </div>
                {pErr ? <FieldError>Pick at least one person.</FieldError> : null}
              </>
            ) : null}
          </div>

          <div style={{ borderRadius: 14, background: C.card, boxShadow: "var(--c-sh-panel)", padding: "4px 12px" }}>
            <button type="button" role="switch" aria-checked={hideOn} onClick={() => setHideOn((v) => !v)} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, background: "none", textAlign: "left" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.ink }}>Hide automatically</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>Stops showing at a set date and time</span>
              </span>
              <Switch on={hideOn} />
            </button>
            {hideOn ? (
              <div style={{ padding: "2px 0 12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 8 }}>
                  <input type="date" value={hideDate} onChange={(e) => setHideDate(e.target.value)} aria-label="Hide on date" aria-invalid={hErr} style={{ height: 42, boxSizing: "border-box", padding: "0 10px", borderRadius: 10, border: "none", background: C.paper, boxShadow: hErr ? "0 0 0 1.5px var(--c-red)" : "var(--c-sh-ring)", fontFamily: "inherit", fontSize: 15, color: C.ink, minWidth: 0, colorScheme: "light dark" }} />
                  <input type="time" value={hideTime} onChange={(e) => setHideTime(e.target.value)} aria-label="Hide at time" aria-invalid={hErr} style={{ height: 42, boxSizing: "border-box", padding: "0 10px", borderRadius: 10, border: "none", background: C.paper, boxShadow: hErr ? "0 0 0 1.5px var(--c-red)" : "var(--c-sh-ring)", fontFamily: "inherit", fontSize: 15, color: C.ink, minWidth: 0, colorScheme: "light dark" }} />
                </div>
                {hErr ? <FieldError>Pick the date and time to hide it.</FieldError> : null}
              </div>
            ) : null}
          </div>
        </div>
      </Column>

      <BottomBar>
        <div style={{ padding: "12px 16px 12px" }}>
          <PrimaryButton icon={Send} busy={busy} onClick={post}>{busy ? "Posting…" : "Post announcement"}</PrimaryButton>
        </div>
      </BottomBar>

      <CommsSheet open={pickOpen} onClose={() => setPickOpen(false)} title="Add files" sub="Images, videos and PDFs">
        <div style={{ display: "grid", gap: 8, padding: "4px 16px 30px" }}>
          <PickRow icon={Camera} label="Camera" sub="Take a photo or video" fg="var(--c-gold)" bg={C.cream} onClick={() => camRef.current?.click()} />
          <PickRow icon={ImageIcon} label="Photo library" sub="Pick one or more" fg="var(--c-teal)" bg={C.tealBg} onClick={() => libRef.current?.click()} />
          <PickRow icon={FileText} label="PDF from files" sub="Browse documents" fg="var(--c-red)" bg={C.redBg} onClick={() => pdfRef.current?.click()} />
        </div>
      </CommsSheet>
      <input ref={camRef} type="file" accept={ANN_ACCEPT_MEDIA} capture="environment" hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={libRef} type="file" accept={ANN_ACCEPT_MEDIA} multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={pdfRef} type="file" accept={ANN_ACCEPT_PDF} multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <ConfirmDialog spec={confirm} onCancel={() => setConfirm(null)} />
    </CommsScreen>
  );
}
