// ---------------------------------------------------------------------------
// /m/it-support?new=1 — "Report a problem" (IT Support v3, approved prototype).
//
// The desktop form's request, field for field (src/pages/it-support/index.tsx
// `NewTicket`): title (required, 200), description (10,000), type bug |
// development, priority high | medium | low, module ("Which part of the
// system" — the desktop sidebar's groups via itModuleIndex, preset from the
// page in ?from=), occurred_at, page_url, files. POST /api/it-support/tickets.
// Files follow the desktop rules (5 files, 10 MB each, images / PDF / MP4 /
// MOV / ZIP) and are not added twice.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, Camera, ChevronDown, CircleAlert, FileX, Folder, Image as ImageIcon, ImagePlus, Lightbulb, Send, X } from "lucide-react";
import { navigationGroups } from "@/components/layout/sidebar";
import { itModuleIndex } from "@/lib/it-support-module";
import {
  BTN, BottomBar, C, Column, CommsScreen, CommsSheet, Counter, DashedButton, ErrorBox, FieldError, FieldHead, FormBar, PickRow, PrimaryButton,
  Segmented, fieldStyle,
} from "../comms-kit";
import { ConfirmDialog, MediaViewer, type ConfirmSpec, type ViewerItem } from "../comms-overlay";
import { IT_FILE_ACCEPT, IT_MAX_FILES, formatBytes, itAddFiles, kindLabel, kindOf } from "../comms-files";
import { FORM_PRIORITIES, PRIORITY_LABEL, TYPE_LABEL, priorityTone, type Priority } from "./it-lib";
import { itApi } from "./it-api";
import { FILE_ICON } from "./it-ui";

// Built once: the sidebar does not change while the app runs (desktop does the same).
const MODULES = itModuleIndex(navigationGroups);

export function ItReportForm({ from, onCancel, onSent }: { from: string; onCancel: () => void; onSent: (code: string) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"bug" | "development">("bug");
  const [priority, setPriority] = useState<Priority>("medium");
  const [module, setModule] = useState(() => (from ? MODULES.moduleFor(from) : ""));
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [viewer, setViewer] = useState<ViewerItem | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Image previews, made in an effect so StrictMode never holds revoked URLs (desktop FilePicker).
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    const made = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- previews follow the file list
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const tErr = tried && !title.trim();
  const dirty = !!(title || description || files.length);
  const moduleOptions = useMemo(() => MODULES.options, []);

  const addFiles = (picked: File[]) => {
    setPickOpen(false);
    const r = itAddFiles(files, picked);
    setFiles(r.files);
    setRejected(r.rejected);
  };

  const submit = async () => {
    setTried(true);
    if (!title.trim()) return setError("");
    setError("");
    setSaving(true);
    const form = new FormData();
    form.set("title", title.trim());
    form.set("description", description.trim());
    form.set("type", type);
    form.set("priority", priority);
    form.set("occurred_at", new Date().toISOString());
    if (from) form.set("page_url", from);
    if (module) form.set("module", module);
    for (const f of files) form.append("files", f, f.name);
    const res = await itApi<{ code: string }>("/tickets", { method: "POST", body: form });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onSent(res.data.code);
  };

  const cancel = () => {
    if (saving) return;
    if (!dirty) return onCancel();
    setConfirm({ title: "Discard this request?", body: "What you've typed and attached will be lost.", okLabel: "Discard", cancelLabel: "Keep editing", danger: true, onOk: () => { setConfirm(null); onCancel(); } });
  };

  return (
    <CommsScreen>
      <FormBar title="Report a problem" onCancel={cancel} cancelDisabled={saving} />
      <Column max={640}>
        <div style={{ padding: "14px 16px 120px", display: "flex", flexDirection: "column", gap: 18 }}>
          {error ? <ErrorBox icon={CircleAlert}>{error}</ErrorBox> : null}

          <div>
            <FieldHead label="What is the problem?" htmlFor="it-title" required right={<Counter text={`${title.length} / 200`} warn={title.length >= 190} />} />
            <input id="it-title" className="c-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value.slice(0, 200))} placeholder="e.g. Can't print delivery order" aria-invalid={tErr} style={{ ...fieldStyle(tErr), height: 46, padding: "0 13px" }} />
            {tErr ? <FieldError>Tell IT what the problem is.</FieldError> : null}
          </div>

          <div>
            <FieldHead label="Details" htmlFor="it-desc" right={<Counter text={`${description.length.toLocaleString("en-MY")} / 10,000`} />} />
            <textarea id="it-desc" className="c-input" value={description} maxLength={10000} rows={5} onChange={(e) => setDescription(e.target.value.slice(0, 10000))}
              placeholder="What were you doing? What did you expect? What happened instead?" style={{ ...fieldStyle(), padding: "11px 13px", lineHeight: 1.45, resize: "vertical" }} />
          </div>

          <div>
            <FieldHead label="Kind of request" />
            <div role="radiogroup" aria-label="Kind of request" style={{ display: "grid", gap: 8 }}>
              {(["bug", "development"] as const).map((k) => {
                const on = type === k;
                const Icon = k === "bug" ? Bug : Lightbulb;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setType(k)}
                    style={{ ...BTN, display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "8px 12px", borderRadius: 12, background: C.card, boxShadow: on ? "0 0 0 1.5px var(--c-gold)" : "var(--c-sh-ring)", textAlign: "left" }}>
                    <span style={{ width: 32, height: 32, flex: "none", borderRadius: 9, background: on ? "#6B5C32" : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={16} strokeWidth={2} color={on ? "#FFFFFF" : "var(--c-gold)"} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: on ? 700 : 600, color: C.ink }}>{TYPE_LABEL[k]}</span>
                    <span style={{ width: 20, height: 20, flex: "none", borderRadius: "50%", boxShadow: on ? "inset 0 0 0 6px var(--c-gold)" : "inset 0 0 0 1.5px var(--c-sand)" }} />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <FieldHead label="Urgency" />
            <Segmented role="radiogroup" label="Urgency" value={priority} onChange={setPriority} items={FORM_PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p], dot: priorityTone(p).fg }))} />
          </div>

          <div>
            <FieldHead label="Which part of the system" htmlFor="it-area" />
            <div style={{ position: "relative" }}>
              <select id="it-area" value={module} onChange={(e) => setModule(e.target.value)}
                style={{ ...fieldStyle(), height: 46, padding: "0 40px 0 13px", appearance: "none", WebkitAppearance: "none", colorScheme: "light dark" }}>
                <option value="">Not sure</option>
                {moduleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none", color: C.goldMid, display: "flex" }}><ChevronDown size={18} strokeWidth={2} /></span>
            </div>
          </div>

          <div>
            <FieldHead label="Screenshots and files" right={<Counter text={`${files.length} / ${IT_MAX_FILES}`} />} />
            <div style={{ display: "grid", gap: 6 }}>
              {files.map((f, i) => {
                const k = kindOf(f.type, f.name);
                const Icon = FILE_ICON[k];
                const url = urls[i];
                const tone = k === "pdf" ? { bg: C.redBg, fg: "var(--c-red)" } : k === "video" ? { bg: C.tealBg, fg: "var(--c-teal)" } : { bg: C.cream, fg: "var(--c-gold)" };
                return (
                  <div key={`${f.name}-${f.size}-${f.lastModified}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 6px 8px 10px", borderRadius: 12, background: C.card, boxShadow: "var(--c-sh-panel)" }}>
                    {url ? (
                      <button type="button" onClick={() => setViewer({ name: f.name, url, kind: "image" })} aria-label={`Preview ${f.name}`} style={{ ...BTN, width: 36, height: 36, flex: "none", borderRadius: 9, overflow: "hidden", background: tone.bg }}>
                        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </button>
                    ) : (
                      <span style={{ width: 36, height: 36, flex: "none", borderRadius: 9, background: tone.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={17} strokeWidth={1.9} color={tone.fg} /></span>
                    )}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 2 }}>{kindLabel(k)} · {formatBytes(f.size)}</span>
                    </span>
                    <button type="button" onClick={() => { setFiles((l) => l.filter((_, j) => j !== i)); setRejected([]); }} aria-label={`Remove ${f.name}`} disabled={saving}
                      style={{ ...BTN, width: 40, height: 40, flex: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint }}>
                      <X size={17} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
              {rejected.length ? (
                <div role="alert" style={{ display: "flex", gap: 8, padding: "9px 11px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12, lineHeight: 1.45 }}>
                  <FileX size={15} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
                  <span>{rejected.join(" ")}</span>
                </div>
              ) : null}
              {files.length < IT_MAX_FILES ? <DashedButton icon={ImagePlus} onClick={() => setPickOpen(true)} disabled={saving}>Add screenshot or file</DashedButton> : null}
              <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.4 }}>Up to 5 files, 10 MB each · images, PDF, MP4, MOV, ZIP</div>
            </div>
          </div>
        </div>
      </Column>

      <BottomBar>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 8, padding: "12px 16px" }}>
          <button type="button" onClick={cancel} disabled={saving} style={{ ...BTN, height: 50, borderRadius: 14, background: C.card, color: C.body, fontSize: 14, fontWeight: 700, boxShadow: "var(--c-sh-ring)", opacity: saving ? 0.6 : 1 }}>Cancel</button>
          <PrimaryButton icon={Send} busy={saving} onClick={() => void submit()}>{saving ? "Sending…" : "Send"}</PrimaryButton>
        </div>
      </BottomBar>

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
      <ConfirmDialog spec={confirm} onCancel={() => setConfirm(null)} />
      <MediaViewer item={viewer} onClose={() => setViewer(null)} />
    </CommsScreen>
  );
}
