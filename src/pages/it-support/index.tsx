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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
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

const STATUS_TONE: Record<Status, string> = {
  open: "bg-[#F0ECE9] text-[#4B4540] border-[#E2DDD8]",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  on_hold: "bg-[#F5F2ED] text-[#6B5C32] border-[#E2DDD8]",
  testing: "bg-violet-50 text-violet-700 border-violet-200",
  waiting_reporter: "bg-amber-50 text-amber-800 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-[#F0ECE9] text-[#6B7280] border-[#E2DDD8]",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
const TYPE_LABEL: Record<string, string> = { bug: "Something is broken", development: "Request a change" };

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_ACCEPT = "image/*,video/mp4,video/quicktime,application/pdf";
const FIELD =
  "w-full rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm text-[#1F1D1B] placeholder:text-[#9CA3AF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32]";

function StatusChip({ status }: { status: Status }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[status] ?? STATUS_TONE.open)}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

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

function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, MAX_FILES));
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()} disabled={files.length >= MAX_FILES}>
        <Paperclip className="h-4 w-4" />
        Attach screenshot or file
      </Button>
      {files.length > 0 && (
        <ul className="space-y-1 text-sm text-[#4B4540]">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <span className="truncate">{f.name}</span>
              <button type="button" className="text-xs text-[#6B5C32] hover:underline" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
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
  const [occurredAt, setOccurredAt] = useState("");
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
    if (occurredAt) form.set("occurred_at", new Date(occurredAt).toISOString());
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
      <CardContent className="space-y-4 p-6">
        <FormField label="What is the issue?" required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sales order page shows blank after saving" />
        </FormField>
        <FormField label="Details" hint="What you did, what you expected, and what happened instead.">
          <textarea className={cn(FIELD, "min-h-32")} value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Type">
            <select className={cn(FIELD, "h-10")} value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="How urgent?">
            <select className={cn(FIELD, "h-10")} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="When did it happen?">
            <input type="datetime-local" className={cn(FIELD, "h-10")} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Screenshots" hint="Up to 5 files, 10 MB each: images, MP4 / MOV video or PDF.">
          <FilePicker files={files} onChange={setFiles} />
        </FormField>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex gap-2">
          <LoadingButton variant="primary" loading={saving} loadingText="Sending" onClick={submit}>Send to IT</LoadingButton>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
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

  const columns = useMemo<Column<TicketRow>[]>(
    () => [
      {
        key: "code", label: "Ticket", width: "110px", type: "docno", sortable: true,
        render: (_v, r) => <span className={cn("font-mono", r.unread && "font-semibold")}>{r.code}</span>,
      },
      {
        key: "title", label: "Issue", sortable: true,
        render: (_v, r, _i, highlight) => (
          <span className={cn(r.unread && "font-semibold")}>
            {highlight(r.title)}
            {r.unread && <span className="ml-2 rounded-full bg-[#6B5C32] px-2 py-0.5 text-xs font-medium text-white">New reply</span>}
          </span>
        ),
      },
      {
        key: "status", label: "Status", width: "190px", sortable: true,
        filterAccessor: (r) => STATUS_LABEL[r.status] ?? r.status,
        exportValue: (r) => STATUS_LABEL[r.status] ?? r.status,
        render: (_v, r) => <StatusChip status={r.status} />,
      },
      {
        key: "priority", label: "Urgency", width: "110px", sortable: true,
        sortAccessor: (r) => ["urgent", "high", "medium", "low"].indexOf(r.priority),
        filterAccessor: (r) => PRIORITY_LABEL[r.priority] ?? r.priority,
        render: (_v, r) => PRIORITY_LABEL[r.priority] ?? r.priority,
      },
      { key: "assignee_name", label: "Handled by", width: "150px", sortable: true, render: (v) => v || "Not picked up yet" },
      { key: "updated_at", label: "Last update", width: "170px", sortable: true, render: (v) => formatDateTime(String(v)) },
    ],
    [],
  );

  if (isNew) {
    return (
      <div className="space-y-4">
        <PageHeader title="Report an issue" subtitle="Goes straight to the IT team. You will see their reply here." breadcrumbs={["IT Support", "New"]} />
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
      {/* While the list has never loaded there is nothing true to draw: no grid, so no "no tickets" line. */}
      {(rows !== null || !listError) && (
        <DataGrid
          gridId="it-support-my-tickets"
          keyField="code"
          columns={columns}
          data={rows ?? []}
          loading={rows === null}
          onRowClick={(r) => open({ ticket: r.code })}
          emptyMessage="You have not reported anything yet. Use Report an issue when something is wrong."
        />
      )}
    </div>
  );
}
