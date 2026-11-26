// ---------------------------------------------------------------------------
// IT Support (Batch 2 v3) — pure helpers. No React, no fetch. Tested by
// tests/m-comms-it-support.test.mjs.
//
// Wording, statuses, colours and rules are the desktop page's
// (src/pages/it-support/index.tsx) and the API's (src/api/routes/it-support.ts):
// the hub owns the status — the phone never sets one, it reloads after a reply.
// ---------------------------------------------------------------------------

export type Status = "open" | "in_progress" | "on_hold" | "testing" | "waiting_reporter" | "resolved" | "closed" | "rejected";
export const STATUSES: Status[] = ["open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved", "closed", "rejected"];

/** Desktop STATUS_LABEL. */
export const STATUS_LABEL: Record<Status, string> = {
  open: "Sent",
  in_progress: "In progress",
  on_hold: "On hold",
  testing: "Being tested",
  waiting_reporter: "Waiting for you",
  resolved: "Done, please confirm",
  closed: "Closed",
  rejected: "Not going ahead",
};

/** Desktop STATUS_TONE hues (blue / amber / slate / violet / orange / emerald / slate / rose) as comms-theme.css variables. */
const TONE_KEY: Record<Status, string> = {
  open: "open",
  in_progress: "progress",
  on_hold: "hold",
  testing: "testing",
  waiting_reporter: "waiting",
  resolved: "resolved",
  closed: "closed",
  rejected: "rejected",
};
export function statusTone(s: Status): { fg: string; bg: string; dot: string } {
  const k = TONE_KEY[s] ?? "open";
  return { fg: `var(--it-${k})`, bg: `var(--it-${k}-bg)`, dot: `var(--it-${k}-dot)` };
}

export function readStatus(v: unknown): Status {
  const s = String(v ?? "").toLowerCase() as Status;
  return STATUSES.includes(s) ? s : "open";
}

/** "resolved" (IT says done, waiting on the reporter) counts as Resolved with closed and rejected. */
export const RESOLVED: Status[] = ["resolved", "closed", "rejected"];
export const isResolved = (s: Status) => RESOLVED.includes(s);
/** No more replies once closed or rejected (desktop `closed`). */
export const isClosed = (s: Status) => s === "closed" || s === "rejected";

export type Priority = "urgent" | "high" | "medium" | "low";
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
/** The form offers no "urgent"; it stays so an older ticket still reads. */
export const FORM_PRIORITIES: Priority[] = ["high", "medium", "low"];
export function readPriority(v: unknown): Priority {
  const p = String(v ?? "").toLowerCase() as Priority;
  return PRIORITIES.includes(p) ? p : "low";
}
export function priorityTone(p: Priority): { fg: string; ring: string } {
  return { fg: `var(--it-${p})`, ring: `var(--it-${p}-ring)` };
}

export const TYPE_LABEL: Record<string, string> = { bug: "Something is not working", development: "Ask for a change" };

// ---- list ------------------------------------------------------------------------------
export type TicketRow = {
  code: string;
  type: string;
  priority: Priority;
  status: Status;
  title: string;
  createdAt: string;
  updatedAt: string;
  assignee: string | null;
  unread: boolean;
};

type Raw = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export function readTickets(data: unknown): TicketRow[] {
  const rows = Array.isArray((data as { tickets?: unknown })?.tickets) ? ((data as { tickets: Raw[] }).tickets) : [];
  return rows
    .map((r) => ({
      code: s(r.code),
      type: s(r.type),
      priority: readPriority(r.priority),
      status: readStatus(r.status),
      title: s(r.title),
      createdAt: s(r.created_at ?? r.createdAt),
      updatedAt: s(r.updated_at ?? r.updatedAt ?? r.created_at ?? r.createdAt),
      assignee: s(r.assignee_name ?? r.assigneeName) || null,
      unread: r.unread === true,
    }))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export type Tab = "all" | "active" | "resolved";

export function tabCounts(rows: TicketRow[]): Record<Tab, number> {
  const resolved = rows.filter((r) => isResolved(r.status)).length;
  return { all: rows.length, active: rows.length - resolved, resolved };
}

export type ListFilter = { tab: Tab; q: string; statuses: Status[]; priorities: Priority[] };

export function inTab(r: TicketRow, tab: Tab): boolean {
  return tab === "all" || (tab === "resolved") === isResolved(r.status);
}

/** Desktop phone search: code, title, handler ("not picked up yet"), status label, priority label. */
export function filterTickets(rows: TicketRow[], f: ListFilter): TicketRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      inTab(r, f.tab) &&
      (!f.statuses.length || f.statuses.includes(r.status)) &&
      (!f.priorities.length || f.priorities.includes(r.priority)) &&
      (!q || [r.code, r.title, r.assignee ?? "not picked up yet", STATUS_LABEL[r.status], PRIORITY_LABEL[r.priority]].some((x) => x.toLowerCase().includes(q))),
  );
}

/** Desktop empty messages per tab; "No requests match." while searching / filtering. */
export function emptyText(tab: Tab, filtering: boolean): string {
  if (filtering) return "No requests match.";
  return { all: "No requests match.", active: "Nothing is with IT right now.", resolved: "No resolved requests yet." }[tab];
}

export function listCountLabel(shown: number, tabTotal: number, filtering: boolean): string {
  return filtering ? `${shown} OF ${tabTotal} REQUESTS` : `${shown} ${shown === 1 ? "REQUEST" : "REQUESTS"} · NEWEST UPDATE FIRST`;
}

// ---- one ticket --------------------------------------------------------------------------
export type Attachment = { id: number; filename: string; mime: string; size: number };
export type TicketEvent = {
  id: number;
  kind: "created" | "comment" | "status" | "assign" | "priority" | "type" | string;
  authorKind: "reporter" | "developer" | "system" | string;
  authorName: string;
  body: string | null;
  from: string | null;
  to: string | null;
  createdAt: string;
  attachments: Attachment[];
};
export type TicketDetail = {
  code: string;
  type: string;
  priority: Priority;
  status: Status;
  title: string;
  description: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  events: TicketEvent[];
};

export function readDetail(data: unknown): TicketDetail | null {
  const d = data as { ticket?: Raw; events?: Raw[] } | null;
  if (!d?.ticket) return null;
  const t = d.ticket;
  return {
    code: s(t.code),
    type: s(t.type),
    priority: readPriority(t.priority),
    status: readStatus(t.status),
    title: s(t.title),
    description: s(t.description),
    assignee: s(t.assignee_name ?? t.assigneeName) || null,
    createdAt: s(t.created_at ?? t.createdAt),
    updatedAt: s(t.updated_at ?? t.updatedAt),
    events: (Array.isArray(d.events) ? d.events : []).map((e) => ({
      id: Number(e.id),
      kind: s(e.kind),
      authorKind: s(e.author_kind ?? e.authorKind),
      authorName: s(e.author_name ?? e.authorName),
      body: e.body == null || e.body === "" ? null : s(e.body),
      from: e.from_value == null ? null : s(e.from_value),
      to: e.to_value == null ? null : s(e.to_value),
      createdAt: s(e.created_at ?? e.createdAt),
      attachments: (Array.isArray(e.attachments) ? (e.attachments as Raw[]) : []).map((a) => ({ id: Number(a.id), filename: s(a.filename), mime: s(a.mime), size: Number(a.size) || 0 })),
    })),
  };
}

/** Desktop eventLine — the words after the author's name. */
export function eventLine(e: Pick<TicketEvent, "kind" | "to">): string {
  const to = e.to ? (STATUS_LABEL[e.to as Status] ?? e.to) : "";
  if (e.kind === "created") return "sent this request";
  if (e.kind === "status") return `changed it to ${to}`;
  if (e.kind === "assign") return e.to ? `gave it to ${e.to}` : "took it off the person handling it";
  return "replied";
}

export type TimelineItem =
  | { type: "msg"; id: number; mine: boolean; it: boolean; who: string; at: string; text: string | null; attachments: Attachment[] }
  | { type: "evt"; id: number; who: string; text: string; at: string; kind: string; to: string | null };

/**
 * Events → the conversation: anything carrying words or files is a message
 * bubble (yours on the right, IT's on the left); everything else is a one-line
 * event with the desktop wording ("Lim Wei Jie changed it to In progress").
 */
export function timeline(events: TicketEvent[]): TimelineItem[] {
  return events.map((e) => {
    const mine = e.authorKind === "reporter";
    const who = mine ? "You" : e.authorName || "IT";
    if (e.body || e.attachments.length) {
      return { type: "msg", id: e.id, mine, it: e.authorKind === "developer", who, at: e.createdAt, text: e.body, attachments: e.attachments };
    }
    return { type: "evt", id: e.id, who, text: eventLine(e), at: e.createdAt, kind: e.kind, to: e.to };
  });
}

/** Closed-card wording (the prototype's, true to the desktop rule: closed / rejected take no replies). */
export function closedCopy(st: Status): { title: string; sub: string } {
  return st === "closed"
    ? { title: "This request is closed", sub: "Replies are turned off. If the problem is back, report a new problem." }
    : { title: "IT isn't going ahead with this", sub: "Replies are turned off. See IT's last message for the reason." };
}
