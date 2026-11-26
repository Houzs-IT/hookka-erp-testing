// ---------------------------------------------------------------------------
// Mail Center (Batch 2 v3) — pure helpers. No React, no fetch. Tested by
// tests/m-comms-mail.test.mjs.
//
// Every rule here is the desktop page's or the API's, imported where the
// desktop already has it as a UI-free helper:
//   • recipients / reply-all — src/api/lib/mail-threading.ts
//   • attachments (images + PDF, 10 files, 5 MB total) — src/api/lib/mail-attachments.ts
//   • category heuristic — src/pages/mail-center/mail-prefs.ts
//   • delivery wording — src/pages/mail-center/mail-delivery.ts
//   • folders → GET /threads params, empty texts — src/pages/mail-center/index.tsx
// Relative imports (not "@/") so node can run this file under tsx.
// ---------------------------------------------------------------------------
import { EMAIL_RE, MAIL_DOMAIN, parseAddressList } from "../../../../../api/lib/mail-threading";
import { classifyCategory, type MailCategory } from "../../../../mail-center/mail-prefs";
import { deliveryLabel, deliveryTone, type DeliveryStatus } from "../../../../mail-center/mail-delivery";

export { EMAIL_RE, parseAddressList, classifyCategory, deliveryLabel, deliveryTone };
export type { MailCategory, DeliveryStatus };

// ---- API shapes (rowToThread / rowToMessage / attachmentToApi in routes/mail-center.ts) ----
export type MailThread = {
  id: string;
  mailboxAddress: string;
  subject: string;
  counterpartyEmail: string;
  counterpartyName: string;
  status: string;
  assignedToUserId?: string;
  assignedToName?: string;
  lastMessageAt: string;
  lastDirection: string;
  lastSnippet: string;
  messageCount: number;
  unread: boolean;
  starred: boolean;
  labels: string[];
  trashedAt: string | null;
  hasOutbound: boolean;
};

export type MailAttachment = { id: string; filename: string; contentType: string; sizeBytes: number; url: string | null };
export type MailAck = { id: string; address: string; userId: string | null; userName: string; dueAt: string; ackedAt: string | null; chasedAt: string | null };
export type MailMessage = {
  id: string;
  direction: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses?: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
  sentAt: string;
  receivedAt: string;
  createdAt: string;
  attachments?: MailAttachment[];
  ackRequired?: boolean;
  ackDueAt?: string | null;
  acks?: MailAck[];
  deliveryStatus?: DeliveryStatus;
};
export type ReadReceipt = { userId: string; userName: string; readAt: string };
export type ThreadDetail = {
  thread: MailThread & { readBy?: ReadReceipt[]; audience?: number };
  messages: MailMessage[];
  replying?: { name: string }[];
};
export type MailAddress = { id: string; address: string; label: string; assignedUserId?: string | null; assignedUserName?: string | null; assignedDept?: string | null; active: boolean };
export type MailLabel = { id: string; name: string; color: string; createdAt?: string };
export type Visibility = { level: string; isAdmin: boolean; readable: { address: string; label: string; dept: string; own: boolean }[] };
export type DirectoryPerson = { key: string; userId: string | null; name: string; email: string; position: string; department: string };
export type Directory = { me: DirectoryPerson | null; department: DirectoryPerson[]; team: DirectoryPerson[]; managers: DirectoryPerson[]; everyone: DirectoryPerson[] };
export type OutboxItem = { id: string; toAddress: string; subject: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string; snippet: string; attachmentNames: string[] };
export type OutboxCounts = { sent: number; failed: number; pending: number };
export type OutboxDetail = { toAddress: string; subject: string; status: string; attempts: number; lastError: string | null; lastAttemptAt: string | null; sentAt: string | null; createdAt: string; bodyText: string; bodyHtml: string; attachmentNames: string[] };

// ---- folders ------------------------------------------------------------------------
// Desktop Folder (index.tsx), "autosent" as desktop names it.
export type Folder = "my-inbox" | "my-sent" | "inbox" | "starred" | "sent" | "drafts" | "autosent" | "archive" | "trash" | "all";
export const FOLDERS: Folder[] = ["my-inbox", "my-sent", "inbox", "starred", "sent", "drafts", "autosent", "archive", "trash", "all"];
export const FOLDER_LABEL: Record<Folder, string> = {
  "my-inbox": "My inbox",
  "my-sent": "Sent by me",
  inbox: "Inbox",
  starred: "Starred",
  sent: "Sent",
  drafts: "Drafts",
  autosent: "Auto-sent",
  archive: "Archive",
  trash: "Trash",
  all: "All mail",
};
export const isFolder = (v: unknown): v is Folder => typeof v === "string" && (FOLDERS as string[]).includes(v);
/** Folders that list conversations (not drafts, not the auto-sent outbox). */
export const isConvFolder = (f: Folder) => f !== "drafts" && f !== "autosent";

/** Desktop threads page size (index.tsx THREADS_PAGE; the API caps at 500). */
export const THREADS_PAGE = 100;

export type MailboxFilter = { kind: "all" } | { kind: "dept"; value: string } | { kind: "mailbox"; value: string };

/**
 * GET /api/mail-center/threads query for a folder, exactly as desktop builds it:
 * Inbox / My inbox = open, Archive = closed, Trash = trashed, else all; Sent =
 * sent=1, Sent by me = sentBy=me; My inbox narrows to my own address.
 */
export function threadsUrl(folder: Folder, opts: { myAddress: string; mailbox: MailboxFilter; label: string | null }): string {
  const params = new URLSearchParams();
  const status = folder === "inbox" || folder === "my-inbox" ? "open" : folder === "archive" ? "closed" : folder === "trash" ? "trashed" : "all";
  if (status !== "all") params.set("status", status);
  if (folder === "my-inbox" && opts.myAddress) params.set("mailbox", opts.myAddress);
  else if (opts.mailbox.kind === "mailbox") params.set("mailbox", opts.mailbox.value);
  if (folder === "sent") params.set("sent", "1");
  if (folder === "my-sent") params.set("sentBy", "me");
  if (opts.label) params.set("label", opts.label);
  params.set("limit", String(THREADS_PAGE));
  return `/api/mail-center/threads?${params.toString()}`;
}

/**
 * Client-side narrowing over the loaded page (desktop categoryBase): Starred,
 * department, label, then search over subject / sender name / email / preview.
 */
export function narrowThreads(rows: MailThread[], o: { folder: Folder; deptAddresses: Set<string> | null; label: string | null; q: string }): MailThread[] {
  let list = rows;
  if (o.folder === "starred") list = list.filter((t) => t.starred);
  if (o.deptAddresses) list = list.filter((t) => o.deptAddresses!.has(t.mailboxAddress));
  if (o.label) list = list.filter((t) => t.labels.some((l) => l.toLowerCase() === o.label!.toLowerCase()));
  const needle = o.q.trim().toLowerCase();
  if (needle) {
    list = list.filter(
      (t) =>
        t.subject.toLowerCase().includes(needle) ||
        t.counterpartyEmail.toLowerCase().includes(needle) ||
        t.counterpartyName.toLowerCase().includes(needle) ||
        t.lastSnippet.toLowerCase().includes(needle),
    );
  }
  return list;
}

export function byCategory(rows: MailThread[], cat: MailCategory): MailThread[] {
  return cat === "all" ? rows : rows.filter((t) => classifyCategory(t.counterpartyEmail) === cat);
}

/** Desktop emptyLabel (index.tsx) as the title; a short line under it. */
export function emptyCopy(folder: Folder, filtering: boolean): { title: string; text: string } {
  if (filtering) return { title: "Nothing matches", text: "Search only looks through the conversations loaded so far." };
  const T: Record<Folder, [string, string]> = {
    "my-inbox": ["Your inbox is empty", "Email sent to your own address lands here."],
    "my-sent": ["You have not sent any mail yet", "Email you send shows here."],
    starred: ["No starred mail", "Star a conversation to keep it here."],
    sent: ["No sent mail", "Email sent from your mailboxes shows here."],
    archive: ["Nothing archived", "Archived conversations show here."],
    drafts: ["No drafts", "Start a new email and choose Save draft to keep it here. Drafts are stored on this device only."],
    trash: ["Trash is empty", "Conversations you move to Trash can be restored from here."],
    all: ["No mail", "Everything except Trash shows here."],
    inbox: ["No mail yet", "New email for your mailboxes lands here."],
    autosent: ["No auto-sent emails yet", "Emails the ERP sends by itself show here."],
  };
  const [title, text] = T[folder];
  return { title, text };
}

/** Desktop senderLabel: name, else the part before @, else "(no sender)". */
export function senderLabel(t: Pick<MailThread, "counterpartyName" | "counterpartyEmail">): string {
  const name = t.counterpartyName?.trim();
  if (name) return name;
  const email = t.counterpartyEmail?.trim();
  if (email) return email.split("@")[0] || email;
  return "(no sender)";
}

/** Desktop cleanSnippet: no tags or entities in the preview. */
export function cleanSnippet(s: string): string {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/gi, " ").replace(/\s+/g, " ").trim() || "(no preview)";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** Row time: "10:40" today, "Yesterday", else "26 Nov". */
export function listWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return hm(d);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
/** "26 Nov 2026 · 10:40" */
export function fullWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} · ${hm(d)}`;
}

// ---- mailboxes ------------------------------------------------------------------------
export const DEPT_PRIORITY = ["Support", "Finance", "HR"];
export const UNASSIGNED_DEPT = "Other";
/** Desktop CANONICAL_DEPT_MAILBOXES (SUPER_ADMIN "Set up"). */
export const CANONICAL_DEPT_MAILBOXES = [
  { dept: "Support", address: "support@hookka.com" },
  { dept: "Finance", address: "finance@hookka.com" },
  { dept: "HR", address: "hr@hookka.com" },
];
export function sortDepts(a: string, b: string): number {
  const rank = (d: string) => (DEPT_PRIORITY.includes(d) ? DEPT_PRIORITY.indexOf(d) : d === UNASSIGNED_DEPT ? DEPT_PRIORITY.length + 1 : DEPT_PRIORITY.length);
  return rank(a) - rank(b) || a.localeCompare(b);
}
/** Active mailboxes grouped by department (desktop deptGroups). */
export function deptGroups(addresses: MailAddress[]): { dept: string; mailboxes: MailAddress[] }[] {
  const by = new Map<string, MailAddress[]>();
  for (const a of addresses.filter((x) => x.active)) {
    const d = (a.assignedDept ?? "").trim() || UNASSIGNED_DEPT;
    by.set(d, [...(by.get(d) ?? []), a]);
  }
  return [...by.entries()]
    .map(([dept, mailboxes]) => ({ dept, mailboxes: mailboxes.slice().sort((x, y) => (x.assignedUserName || x.address).localeCompare(y.assignedUserName || y.address)) }))
    .sort((a, b) => sortDepts(a.dept, b.dept));
}
/** A personal box has a person assigned; a shared box only a department. */
export const mailboxKind = (a: MailAddress): "Personal" | "Shared" => (a.assignedUserId ? "Personal" : "Shared");
export const mailboxName = (a: MailAddress): string => a.label?.trim() || a.assignedUserName?.trim() || a.address.split("@")[0];

/** SUPER_ADMIN only: canonical shared boxes with no row anywhere (the all=1 list). */
export function missingCanonical(dept: string, all: MailAddress[] | null): string[] {
  if (!all) return [];
  const have = new Set(all.map((a) => a.address.toLowerCase()));
  return CANONICAL_DEPT_MAILBOXES.filter((c) => c.dept === dept && !have.has(c.address)).map((c) => c.address);
}

// ---- labels -----------------------------------------------------------------------------
/** Desktop LABEL_PALETTE (mirrors the API's LABEL_COLORS allow-list). */
export const LABEL_PALETTE: { value: string; name: string }[] = [
  { value: "#6B5C32", name: "Brown" },
  { value: "#B45309", name: "Amber" },
  { value: "#15803D", name: "Green" },
  { value: "#0E7490", name: "Teal" },
  { value: "#1D4ED8", name: "Blue" },
  { value: "#6D28D9", name: "Violet" },
  { value: "#BE185D", name: "Pink" },
  { value: "#B91C1C", name: "Red" },
  { value: "#475569", name: "Slate" },
];
export function labelColor(name: string, catalog: MailLabel[]): string {
  const hit = catalog.find((l) => l.name.toLowerCase() === name.toLowerCase());
  return hit?.color?.trim() || LABEL_PALETTE[0].value;
}
/** Catalogue ∪ names found on loaded threads (desktop sidebar list), A–Z. */
export function labelList(catalog: MailLabel[], threads: MailThread[]): string[] {
  const names = new Map<string, string>();
  for (const l of catalog) names.set(l.name.toLowerCase(), l.name);
  for (const t of threads) for (const l of t.labels) if (!names.has(l.toLowerCase())) names.set(l.toLowerCase(), l);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
export const hasLabel = (labels: string[], name: string) => labels.some((l) => l.toLowerCase() === name.toLowerCase());
/** Add one label name to a set, case-insensitively (desktop patchManyAddLabel merge). */
export const withLabel = (labels: string[], name: string) => (hasLabel(labels, name) ? labels : [...labels, name.trim()]);
export const withoutLabel = (labels: string[], name: string) => labels.filter((l) => l.toLowerCase() !== name.toLowerCase());

// ---- recipients ---------------------------------------------------------------------------
/** Desktop RecipientsInput commit: parse, de-dupe against the chips already there. */
export function addRecipients(current: string[], raw: string): string[] {
  const have = new Set(current.map((a) => a.toLowerCase()));
  return [...current, ...parseAddressList(raw).filter((a) => !have.has(a))];
}
/** Keys that turn typed text into a chip (Enter / comma / semicolon / Tab). */
export const COMMIT_KEYS = ["Enter", ",", ";", "Tab"];
/** Pasted text that should become chips at once (desktop onPaste). */
export const pasteCommits = (s: string) => /[,;\n<>]/.test(s);
export const isValidEmail = (a: string) => EMAIL_RE.test(a);
/** Staff = an @hookka.com mailbox: the only recipients who can acknowledge. */
export const isStaffAddress = (a: string) => a.toLowerCase().endsWith(`@${MAIL_DOMAIN}`);

/** "Re: subject", never "Re: Re:". */
export function replySubject(subject: string): string {
  const s = subject || "(no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}
/** Desktop forwardSubject: "Fwd: " once. */
export function forwardSubject(subject: string): string {
  const s = subject || "(no subject)";
  return /^fwd:/i.test(s) ? s : `Fwd: ${s}`;
}

export function looksLikeHtml(s: string | undefined): boolean {
  return /<(?:!doctype|html|body|head|div|table|tr|td|p|br|span|a|img|style|font|center|ul|ol|li|h[1-6])[\s>/]/i.test(s || "");
}
export function htmlToText(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** What a message body is: HTML for the sandboxed frame, else plain text (desktop detail.tsx). */
export function messageBody(m: Pick<MailMessage, "htmlBody" | "textBody">): { html: string; text: string } {
  const html = m.htmlBody?.trim() || (looksLikeHtml(m.textBody) ? (m.textBody || "").trim() : "");
  return html ? { html, text: "" } : { html: "", text: m.textBody?.trim() || htmlToText(m.htmlBody || "") };
}
/** Desktop emailSrcDoc, plus colours that follow the app theme. */
export function emailSrcDoc(rawHtml: string, dark = false): string {
  const colors = dark ? "color:#F0EBE2;background:#2A2722" : "color:#1f1d1b;background:#ffffff";
  const inject = `<base target="_blank"><meta charset="utf-8"><style>html,body{margin:0;padding:2px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;${colors};word-break:break-word;overflow-x:hidden}img{max-width:100%;height:auto}table{max-width:100%}${dark ? "a{color:#D9BD7B}" : ""}</style>`;
  if (/<head[^>]*>/i.test(rawHtml)) return rawHtml.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
  if (/<html[^>]*>/i.test(rawHtml)) return rawHtml.replace(/<html([^>]*)>/i, `<html$1><head>${inject}</head>`);
  return `<!doctype html><html><head>${inject}</head><body>${rawHtml}</body></html>`;
}

/** Desktop forwardBody: the whole conversation, newest first, as plain text. */
export function forwardBody(messages: MailMessage[]): string {
  const lines: string[] = ["---------- Forwarded message ----------"];
  const ordered = messages.slice().sort((a, b) => (b.sentAt || b.createdAt).localeCompare(a.sentAt || a.createdAt));
  for (const m of ordered) {
    const who = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress;
    const when = fullWhen(m.sentAt || m.createdAt);
    const body = m.textBody?.trim() || htmlToText(m.htmlBody || "");
    lines.push("", `From: ${who}`);
    if (when) lines.push(`Date: ${when}`);
    if (m.subject) lines.push(`Subject: ${m.subject}`);
    lines.push("", body || "(empty)", "", "--");
  }
  return lines.join("\n");
}

// ---- acknowledgements -------------------------------------------------------------------------
/** Desktop ack-request-row DUE_OPTIONS (hours). 2 days is the default. */
export const ACK_DUES: { hours: number; label: string }[] = [
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 24 * 7, label: "1 week" },
];
export type AckState = "acked" | "overdue" | "pending";
export function ackState(a: MailAck, nowIso: string = new Date().toISOString()): AckState {
  if (a.ackedAt) return "acked";
  return a.dueAt && a.dueAt < nowIso ? "overdue" : "pending";
}
/** An ack row is mine when it names my account or a mailbox I work (desktop ackIsMine). */
export function ackIsMine(a: MailAck, myId: string, myAddresses: Set<string>): boolean {
  return (!!myId && a.userId === myId) || myAddresses.has(a.address.toLowerCase());
}

// ---- outbox (auto-sent) ---------------------------------------------------------------------------
/** Desktop outboxStatusLabel. */
export function outboxStatusLabel(status: string): string {
  switch ((status || "").toUpperCase()) {
    case "SENT": return "Sent";
    case "FAILED": return "Failed";
    case "SENDING": return "Sending";
    case "RETRYING": return "Retrying";
    default: return "Pending";
  }
}
/** The time line fits the status: never "Sent" for one that has not gone. */
export function outboxWhen(o: { status: string; sentAt: string | null; createdAt: string; lastAttemptAt?: string | null }): { label: string; at: string } {
  const s = (o.status || "").toUpperCase();
  if (s === "SENT" && o.sentAt) return { label: "Sent", at: o.sentAt };
  if (s === "FAILED") return { label: "Last tried", at: o.lastAttemptAt || o.createdAt };
  return { label: "Queued", at: o.createdAt };
}
/** Desktop filter chips: All / Sent / Failed / Pending → ?status=. */
export const OUTBOX_FILTERS: { key: "" | "SENT" | "FAILED" | "PENDING"; label: string }[] = [
  { key: "", label: "All" },
  { key: "SENT", label: "Sent" },
  { key: "FAILED", label: "Failed" },
  { key: "PENDING", label: "Pending" },
];

// ---- attachments (compose) ---------------------------------------------------------------------------
/** "0.3 of 5 MB" style figure. */
export const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
export function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const m = bytes / (1024 * 1024);
  return `${m.toFixed(m < 10 ? 1 : 0)} MB`;
}
export const isImageType = (ct: string) => /^image\//i.test(ct || "");

// ---- the compose gate (desktop canSend + the API's ack rule) -------------------------------------------
export function sendBlocker(p: { from: string; to: string[]; cc: string[]; bcc: string[]; pending: string; subject: string; body: string; ack: boolean; reply: boolean }): string {
  if (!p.from) return "You need a mailbox you're allowed to send from.";
  if (!p.to.length) return "Add at least one To recipient.";
  const all = [...p.to, ...p.cc, ...p.bcc];
  if (!all.every(isValidEmail) || (p.pending.trim() && !isValidEmail(p.pending.trim()))) return "Fix the invalid email address.";
  if (!p.reply && !p.subject.trim()) return "Add a subject.";
  if (!p.body.trim()) return "Write a message.";
  if (p.ack && !all.some(isStaffAddress)) return "Acknowledgement needs at least one staff recipient.";
  return "";
}
