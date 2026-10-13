// ---------------------------------------------------------------------------
// /it-support — report an issue to IT, follow it, reply, confirm the fix.
//
// Every login has this page and sees only its own tickets: the server reads
// the reporter off the session (src/api/routes/it-support.ts), so there is no
// "whose tickets?" control here to get wrong.
//
// One page, three views, chosen by the query string so a link can open any of
// them (?new=1 for the form, ?ticket=HK-0001 for one ticket):
//   list   — my tickets, newest activity first, unread ones marked
//   new    — the report form
//   ticket — the conversation, a reply box, and Confirm once IT marks it Done
//
// A failed load is shown as a failure. An empty list is only ever drawn when
// the server actually answered with one.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, FileText, Film, Paperclip, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useEscapeClose } from "@/lib/escape-stack";
import { useInterval } from "@/lib/scheduler";
import { cn, formatDateTime } from "@/lib/utils";

type Status =
  | "open" | "in_progress" | "on_hold" | "testing" | "waiting_reporter" | "resolved" | "closed" | "rejected";

type TicketRow = {
  code: string;
  type: string;
  priority: string;
  status: Status;
  title: string;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
  unread: boolean;
};

type Attachment = { id: number; event_id: number; filename: string; mime: string; size: number };

type TicketEvent = {
  id: number;
  kind: "created" | "comment" | "status" | "assign" | "priority" | "type";
  author_kind: "reporter" | "developer" | "system";
  author_name: string;
  body: string | null;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
  attachments: Attachment[];
};

type TicketDetail = {
  ticket: {
    code: string; type: string; priority: string; status: Status; title: string; description: string;
    occurred_at: string | null; page_url: string | null; assignee_name: string | null;
    created_at: string; updated_at: string;
  };
  events: TicketEvent[];
};

// The words the reporter reads. "resolved" is IT saying it is fixed and asking
// the reporter to check; "waiting_reporter" is IT waiting on an answer.
const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  testing: "Testing",
  waiting_reporter: "Waiting for you",
  resolved: "Done, please confirm",
  closed: "Closed",
  rejected: "Rejected",
};

// Chip colours, then the dot inside the chip.
const STATUS_TONE: Record<Status, [string, string]> = {
  open: ["bg-blue-50 text-blue-700 border-blue-200", "bg-blue-600"],
  in_progress: ["bg-amber-50 text-amber-700 border-amber-200", "bg-amber-500"],
  on_hold: ["bg-slate-100 text-slate-600 border-slate-200", "bg-slate-400"],
  testing: ["bg-violet-50 text-violet-700 border-violet-200", "bg-violet-500"],
  waiting_reporter: ["bg-orange-50 text-orange-700 border-orange-200", "bg-orange-500"],
  resolved: ["bg-emerald-50 text-emerald-700 border-emerald-200", "bg-emerald-500"],
  closed: ["bg-slate-100 text-slate-600 border-slate-200", "bg-slate-500"],
  rejected: ["bg-rose-50 text-rose-700 border-rose-200", "bg-rose-500"],
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-800 border-rose-300 font-semibold",
  high: "bg-rose-50 text-rose-700 border-rose-200 font-semibold",
  medium: "bg-amber-50 text-amber-700 border-amber-200 font-medium",
  low: "bg-slate-100 text-slate-600 border-slate-200 font-medium",
};

const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
// The form offers no "urgent"; it stays here so an older ticket still reads.
const FORM_PRIORITIES = ["high", "medium", "low"];
const TYPE_LABEL: Record<string, string> = { bug: "Bug", development: "Development" };
// The form asks in the reporter's words; the values are the same as TYPE_LABEL's.
const FORM_TYPES = [["bug", "Something is not working"], ["development", "Ask for a change"]] as const;

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_ACCEPT = "image/*,video/mp4,video/quicktime,application/pdf";
const FORM_BUTTON = "h-auto rounded-lg px-5 py-2.5 text-sm font-medium";
const FIELD =
  "w-full rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm text-[#1F1D1B] placeholder:text-[#9CA3AF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]";

function StatusChip({ status }: { status: Status }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", (STATUS_TONE[status] ?? STATUS_TONE.open)[0])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", (STATUS_TONE[status] ?? STATUS_TONE.open)[1])} aria-hidden="true" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs", PRIORITY_TONE[priority] ?? PRIORITY_TONE.low)}>
      {PRIORITY_LABEL[priority] ?? priority}
    </span>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

// The shared grid paints its own beige toolbar, header and zebra rows. These
// descendant rules restyle them for this table only; every other list is untouched.
const TABLE_SKIN = [
  "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
  "[&>div>div:first-child]:rounded-none [&>div>div:first-child]:border-0 [&>div>div:first-child]:bg-white [&>div>div:first-child]:px-3",
  "[&_thead_tr]:bg-slate-50 [&_thead_th]:px-4 [&_thead_th]:py-3 [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-wider [&_thead_th]:text-slate-500",
  "[&_tr]:border-slate-200 [&_tbody_tr]:bg-white [&_tbody_tr]:text-sm [&_tbody_tr]:text-slate-700 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-slate-50/80 [&_tbody_td]:px-4 [&_tbody_td]:py-3",
].join(" ");

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/it-support${path}`, init);
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
    if (res.ok && body?.success && body.data !== undefined) return { ok: true, data: body.data };
    return { ok: false, error: body?.error || `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

function checkFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`;
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  return big ? `${big.name} is larger than 10 MB.` : null;
}

// The input's accept only limits the file browser; drop and paste come through here too.
function acceptedType(f: File): boolean {
  return f.type.startsWith("image/") || ["application/pdf", "video/mp4", "video/quicktime"].includes(f.type);
}

function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  useEscapeClose(() => setViewing(null), viewing !== null);

  // Made in the effect, not a memo, so StrictMode's second mount never holds revoked URLs.
  useEffect(() => {
    const made = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- previews follow the file list
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const add = useCallback(
    (incoming: File[]) => {
      const skipped: string[] = [];
      const ok = incoming.filter((f) => {
        if (!acceptedType(f)) skipped.push(`${f.name} is not an image, PDF, MP4 or MOV`);
        else if (f.size > MAX_FILE_BYTES) skipped.push(`${f.name} is larger than 10 MB`);
        else return true;
        return false;
      });
      const room = MAX_FILES - files.length;
      if (ok.length > room) skipped.push(`only ${MAX_FILES} files can be attached`);
      setNote(skipped.length ? `Not added: ${skipped.join("; ")}.` : "");
      if (ok.length && room > 0) onChange([...files, ...ok.slice(0, room)]);
    },
    [files, onChange],
  );

  // Ctrl+V / Cmd+V anywhere on the page. A text paste is left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;
      e.preventDefault();
      // Every clipboard screenshot arrives as "image.png"; give each its own name.
      const stamp = Date.now();
      add(pasted.map((f, i) => new File([f], `screenshot-${stamp}-${i + 1}.${f.type.split("/")[1] || "png"}`, { type: f.type })));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [add]);

  const remove = (i: number) => {
    setViewing(null);
    setNote("");
    onChange(files.filter((_, j) => j !== i));
  };

  const shown = viewing !== null ? urls[viewing] : null;

  return (
    <div className="space-y-3">
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-3 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-[#6B5C32]",
          dragging ? "border-[#6B5C32] bg-[#F5F2ED]" : "border-[#E2DDD8] hover:border-[#6B5C32] hover:bg-[#FAF9F7]",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files));
        }}
      >
        <input
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Upload className="h-5 w-5 text-[#6B5C32]" />
        <span className="font-medium text-[#1F1D1B]">Add a screenshot or file</span>
        <span className="text-xs text-[#8A7F73]">Click, drop or paste. Pictures, MP4 or MOV video, or PDF. Up to {MAX_FILES} files, 10 MB each.</span>
      </label>

      {note && <p className="text-sm text-amber-700" role="status">{note}</p>}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {files.map((f, i) => {
            const ext = f.name.includes(".") ? f.name.split(".").pop()!.toUpperCase() : "FILE";
            const url = urls[i];
            return (
              <li key={`${f.name}-${i}`} className="relative h-20 w-20">
                {f.type.startsWith("image/") ? (
                  <button
                    type="button"
                    title={f.name}
                    aria-label={`Preview ${f.name}`}
                    onClick={() => setViewing(i)}
                    className="h-full w-full overflow-hidden rounded-md border border-[#E2DDD8] transition hover:border-[#6B5C32] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]"
                  >
                    {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                  </button>
                ) : (
                  <div title={f.name} className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-[#E2DDD8] bg-[#F5F2ED] text-[#6B5C32]">
                    {f.type.startsWith("video/") ? <Film className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                    <span className="max-w-full truncate px-1 text-[10px] font-semibold">{ext}</span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => remove(i)}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#1F1D1B] text-white shadow transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {shown && viewing !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/70" onClick={() => setViewing(null)} />
          <div role="dialog" aria-modal="true" aria-label={files[viewing]?.name} className="relative">
            <img src={shown} alt={files[viewing]?.name ?? ""} className="max-h-[85vh] max-w-[90vw] rounded-md bg-white object-contain shadow-2xl" />
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setViewing(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#1F1D1B] shadow transition-colors hover:bg-[#F0ECE9]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- New ticket -------------------------------------------------------------
function NewTicket({ fromUrl, onDone, onCancel }: { fromUrl: string; onDone: (code: string) => void; onCancel: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("bug");
  const [priority, setPriority] = useState("medium");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!title.trim()) return setError("Give the issue a short title.");
    const fileError = checkFiles(files);
    if (fileError) return setError(fileError);
    setError("");
    setSaving(true);
    const form = new FormData();
    form.set("title", title.trim());
    form.set("description", description.trim());
    form.set("type", type);
    form.set("priority", priority);
    form.set("occurred_at", new Date().toISOString());
    if (fromUrl) form.set("page_url", fromUrl);
    for (const f of files) form.append("files", f, f.name);
    const res = await api<{ code: string }>("/tickets", { method: "POST", body: form });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(`Reported as ${res.data.code}. IT will reply here.`);
    onDone(res.data.code);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <FormField label="What is the problem?" required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="The sales order page goes blank after saving" />
        </FormField>
        <FormField label="Details">
          <textarea className={cn(FIELD, "min-h-32 resize-y")} value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)}
            placeholder="What you did, what you expected, and what happened instead." />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Kind of request">
            <select className={cn(FIELD, "h-10")} value={type} onChange={(e) => setType(e.target.value)}>
              {FORM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="How urgent">
            <select className={cn(FIELD, "h-10")} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {FORM_PRIORITIES.map((v) => <option key={v} value={v}>{PRIORITY_LABEL[v]}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Screenshots">
          <FilePicker files={files} onChange={setFiles} />
        </FormField>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="outline" className={FORM_BUTTON} onClick={onCancel} disabled={saving}>Cancel</Button>
          <LoadingButton variant="primary" className={FORM_BUTTON} loading={saving} loadingText="Sending" onClick={submit}>Send to IT</LoadingButton>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- One ticket -------------------------------------------------------------
function eventLine(e: TicketEvent): string {
  const from = e.from_value ? (STATUS_LABEL[e.from_value as Status] ?? e.from_value) : "";
  const to = e.to_value ? (STATUS_LABEL[e.to_value as Status] ?? e.to_value) : "";
  if (e.kind === "created") return "reported this issue";
  if (e.kind === "status") return `changed the status${from ? ` from ${from}` : ""} to ${to}`;
  if (e.kind === "assign") return e.to_value ? `assigned this to ${e.to_value}` : "unassigned this";
  return "replied";
}

function Ticket({ code, onChanged }: { code: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"" | "reply" | "confirm">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<TicketDetail>(`/tickets/${encodeURIComponent(code)}`);
    if (res.ok) {
      setDetail(res.data);
      setLoadError("");
      // Opening a ticket marks it seen on the hub, so the list and the sidebar
      // badge are now out of date.
      onChanged();
    } else {
      setLoadError(res.error);
    }
  }, [code, onChanged]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; same pattern as the sidebar's initial load
    load();
  }, [load]);
  useInterval(load, 30_000);

  if (loadError && !detail) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-sm">
          <p className="text-red-600" role="alert">Could not load this ticket: {loadError}</p>
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (!detail) return <Skeleton className="h-64 w-full" />;

  const { ticket, events } = detail;
  const closed = ticket.status === "closed" || ticket.status === "rejected";

  const sendReply = async () => {
    if (!reply.trim() && files.length === 0) return setError("Write a reply or attach a file.");
    const fileError = checkFiles(files);
    if (fileError) return setError(fileError);
    setError("");
    setBusy("reply");
    const form = new FormData();
    if (reply.trim()) form.set("body", reply.trim());
    for (const f of files) form.append("files", f, f.name);
    const res = await api(`/tickets/${encodeURIComponent(code)}/replies`, { method: "POST", body: form });
    setBusy("");
    if (!res.ok) return setError(res.error);
    setReply("");
    setFiles([]);
    await load();
  };

  const confirmFixed = async () => {
    setError("");
    setBusy("confirm");
    const res = await api(`/tickets/${encodeURIComponent(code)}/confirm`, { method: "POST" });
    setBusy("");
    if (!res.ok) return setError(res.error);
    toast.success(`${code} closed. Thank you for confirming.`);
    await load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-[#6B5C32]">{ticket.code}</span>
            <StatusChip status={ticket.status} />
            <span className="text-xs text-[#8A7F73]">
              {TYPE_LABEL[ticket.type] ?? ticket.type} · {PRIORITY_LABEL[ticket.priority] ?? ticket.priority}
              {ticket.assignee_name ? ` · Handled by ${ticket.assignee_name}` : " · Not picked up yet"}
            </span>
          </div>
          <h2 className="text-lg font-semibold text-[#1F1D1B]">{ticket.title}</h2>
          {ticket.description && <p className="whitespace-pre-wrap text-sm text-[#4B4540]">{ticket.description}</p>}
          {ticket.status === "resolved" && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <span className="flex-1">IT has marked this as done. If it is fixed, confirm to close it. If not, reply below and it reopens.</span>
              <LoadingButton variant="primary" size="sm" loading={busy === "confirm"} loadingText="Closing" onClick={confirmFixed}>
                Yes, it is fixed
              </LoadingButton>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <ul className="space-y-4">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-[#1F1D1B]">{e.author_kind === "reporter" ? "You" : e.author_name}</span>
                  <span className="text-[#6B7280]">{eventLine(e)}</span>
                  <span className="text-xs text-[#9CA3AF]">{formatDateTime(e.created_at)}</span>
                </div>
                {e.body && (
                  <p className={cn("mt-1 whitespace-pre-wrap rounded-md p-3 text-[#1F1D1B]", e.author_kind === "reporter" ? "bg-[#F5F2ED]" : "bg-blue-50")}>
                    {e.body}
                  </p>
                )}
                {e.attachments.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {e.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/api/it-support/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-[#E2DDD8] px-2 py-1 text-xs text-[#6B5C32] hover:bg-[#F0ECE9]"
                        >
                          <Paperclip className="h-3 w-3" />
                          {a.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          {closed ? (
            <p className="text-sm text-[#6B7280]">This ticket is closed. If the problem is back, report a new issue.</p>
          ) : (
            <>
              <textarea
                className={cn(FIELD, "min-h-24")}
                value={reply}
                maxLength={10000}
                placeholder="Reply to IT"
                onChange={(e) => setReply(e.target.value)}
              />
              <FilePicker files={files} onChange={setFiles} />
              <LoadingButton variant="primary" loading={busy === "reply"} loadingText="Sending" onClick={sendReply}>Send reply</LoadingButton>
            </>
          )}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// "resolved" (IT says done, waiting on the reporter) counts as Resolved with closed and rejected.
const DONE: Status[] = ["resolved", "closed", "rejected"];
type ListTab = "all" | "active" | "resolved";

function NoTicketsArt() {
  return (
    <svg viewBox="0 0 180 150" className="h-36 w-44" aria-hidden="true">
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

// Only when the server answered with no tickets at all: no grid, no toolbar, no headers.
function EmptyState({ onReport }: { onReport: () => void }) {
  return (
    <section aria-labelledby="it-support-empty" className="rounded-xl border border-[#E2DDD8] bg-white px-6 py-12 text-center sm:py-16">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
        <NoTicketsArt />
        <h2 id="it-support-empty" className="text-xl font-bold text-[#1F1D1B]">No tickets yet</h2>
        <p className="text-sm text-[#6B7280]">
          Need help with hardware, software, or access permissions? Submit a request and our IT team will pick it up.
        </p>
        <Button variant="primary" onClick={onReport}>
          <Plus className="h-4 w-4" />
          Report an issue
        </Button>
      </div>
    </section>
  );
}

function TicketTable({ rows, onOpen }: { rows: TicketRow[] | null; onOpen: (code: string) => void }) {
  const [tab, setTab] = useState<ListTab>("all");

  // Counts come from every ticket, never from what the search box left.
  const byTab = useMemo(() => {
    const all = rows ?? [];
    const resolved = all.filter((r) => DONE.includes(r.status));
    return { all, active: all.filter((r) => !DONE.includes(r.status)), resolved };
  }, [rows]);

  const columns = useMemo<Column<TicketRow>[]>(
    () => [
      {
        key: "code", label: "Ticket", width: "110px", type: "docno", sortable: true, noFilter: true,
        render: (_v, r) => <span className="whitespace-nowrap font-semibold text-slate-900">{r.code}</span>,
      },
      {
        key: "title", label: "Issue", sortable: false, noFilter: true,
        render: (_v, r, _i, highlight) => (
          <span className={cn("text-slate-800", r.unread && "font-semibold text-slate-900")}>
            {highlight(r.title)}
            {r.unread && <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">New reply</span>}
          </span>
        ),
      },
      {
        key: "status", label: "Status", width: "180px", sortable: true,
        filterAccessor: (r) => STATUS_LABEL[r.status] ?? r.status,
        exportValue: (r) => STATUS_LABEL[r.status] ?? r.status,
        render: (_v, r) => <StatusChip status={r.status} />,
      },
      {
        key: "priority", label: "Urgency", width: "110px", sortable: true,
        sortAccessor: (r) => ["urgent", "high", "medium", "low"].indexOf(r.priority),
        filterAccessor: (r) => PRIORITY_LABEL[r.priority] ?? r.priority,
        exportValue: (r) => PRIORITY_LABEL[r.priority] ?? r.priority,
        render: (_v, r) => <PriorityChip priority={r.priority} />,
      },
      {
        key: "assignee_name", label: "Handled by", width: "190px", sortable: true,
        exportValue: (r) => r.assignee_name || "Not picked up yet",
        render: (_v, r) =>
          r.assignee_name ? (
            <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-slate-800">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700" aria-hidden="true">
                {initials(r.assignee_name)}
              </span>
              {r.assignee_name}
            </span>
          ) : (
            <span className="text-sm italic text-slate-400">Not picked up yet</span>
          ),
      },
      {
        key: "updated_at", label: "Last update", width: "170px", sortable: true, noFilter: true,
        render: (v) => <span className="whitespace-nowrap text-slate-500">{formatDateTime(String(v))}</span>,
      },
    ],
    [],
  );

  const tabs = [
    { key: "all" as const, label: "All", count: byTab.all.length },
    { key: "active" as const, label: "Active", count: byTab.active.length },
    { key: "resolved" as const, label: "Resolved", count: byTab.resolved.length },
  ];
  const emptyMessage = { all: "No tickets match.", active: "No active tickets.", resolved: "No resolved tickets." }[tab];

  return (
    <>
      <div className={cn(TABLE_SKIN, "hidden md:block")}>
        <DataGrid
          gridId="it-support-my-tickets"
          keyField="code"
          columns={columns}
          data={byTab[tab]}
          loading={rows === null}
          onRowClick={(r) => onOpen(r.code)}
          toolbarStart={<Tabs className="-my-1.5 border-b-0" value={tab} onChange={setTab} tabs={tabs} />}
          emptyMessage={emptyMessage}
        />
      </div>
      <TicketCards rows={rows === null ? null : byTab[tab]} tabBar={<Tabs className="w-max flex-nowrap border-b-0" value={tab} onChange={setTab} tabs={tabs} />} emptyMessage={emptyMessage} onOpen={onOpen} />
    </>
  );
}

// Phones get one card per ticket instead of the grid (no Columns menu, no pager).
function TicketCards({ rows, tabBar, emptyMessage, onOpen }: {
  rows: TicketRow[] | null; tabBar: ReactNode; emptyMessage: string; onOpen: (code: string) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) =>
    !q || [r.code, r.title, r.assignee_name ?? "", STATUS_LABEL[r.status] ?? r.status, PRIORITY_LABEL[r.priority] ?? r.priority]
      .some((s) => s.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-3 md:hidden">
      <div className="overflow-x-auto border-b border-[#E6E0D9] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{tabBar}</div>
      <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets" aria-label="Search tickets" />
      {rows === null ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        shown.map((r) => (
          <button
            key={r.code}
            type="button"
            onClick={() => onOpen(r.code)}
            className="block w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-900">{r.code}</span>
              <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(r.updated_at)}</span>
            </span>
            <span className={cn("line-clamp-2 font-medium text-slate-900", r.unread && "font-semibold")}>
              {r.unread && <span className="mr-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">New reply</span>}
              {r.title}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip status={r.status} />
              <PriorityChip priority={r.priority} />
              {r.assignee_name
                ? <span className="text-xs font-medium text-slate-700">{r.assignee_name}</span>
                : <span className="text-xs italic text-slate-400">Not picked up yet</span>}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

// ---- Page ---------------------------------------------------------------------
export default function ItSupport() {
  const [params, setParams] = useSearchParams();
  const ticketCode = params.get("ticket") ?? "";
  const isNew = params.get("new") === "1";
  const fromUrl = params.get("from") ?? "";

  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [listError, setListError] = useState("");

  const loadList = useCallback(async () => {
    const res = await api<{ tickets: TicketRow[] }>("/tickets");
    if (res.ok) {
      setRows(res.data.tickets);
      setListError("");
    } else {
      setListError(res.error);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; same pattern as the sidebar
    loadList();
  }, [loadList]);
  useInterval(loadList, 60_000);

  const open = useCallback((next: Record<string, string>) => setParams(next), [setParams]);

  if (isNew) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <PageHeader
          title="Report a problem"
          subtitle="Goes straight to IT. Their reply appears on this page."
          breadcrumbs={["IT Support", "New"]}
          actions={
            <Button variant="outline" onClick={() => open({})}>
              <ArrowLeft className="h-4 w-4" />
              All my tickets
            </Button>
          }
        />
        <NewTicket
          fromUrl={fromUrl}
          onCancel={() => open({})}
          onDone={(code) => {
            loadList();
            open({ ticket: code });
          }}
        />
      </div>
    );
  }

  if (ticketCode) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="IT Support"
          breadcrumbs={["IT Support", ticketCode]}
          actions={
            <Button variant="outline" onClick={() => open({})}>
              <ArrowLeft className="h-4 w-4" />
              All my tickets
            </Button>
          }
        />
        <Ticket key={ticketCode} code={ticketCode} onChanged={loadList} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="IT Support"
        subtitle="Report a problem or ask for a change, and follow what IT is doing about it."
        actions={
          <Button variant="primary" onClick={() => open({ new: "1" })}>
            <Plus className="h-4 w-4" />
            Report an issue
          </Button>
        }
      />
      {listError && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="flex-1 text-red-600" role="alert">Could not load your tickets: {listError}</span>
            <Button variant="outline" size="sm" onClick={loadList}>Try again</Button>
          </CardContent>
        </Card>
      )}
      {/* While the list has never loaded there is nothing true to draw, so no empty state either. */}
      {rows !== null && rows.length === 0 ? (
        <EmptyState onReport={() => open({ new: "1" })} />
      ) : (
        (rows !== null || !listError) && <TicketTable rows={rows} onOpen={(code) => open({ ticket: code })} />
      )}
    </div>
  );
}
