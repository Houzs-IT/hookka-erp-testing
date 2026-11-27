// ---------------------------------------------------------------------------
// mcp-write-actions.ts — AI Connector round 4b: write actions (owner approved
// 2026-11-26 「那些也ok」). Same pattern as the meeting / email actions
// (lib/mcp-actions.ts): propose → the person sees a summary → confirm_action →
// ONE call to the ERP's OWN existing write route, in-process, as the person.
//
//   propose_mail_reply   POST /api/mail-center/threads/:id/reply  (mail-center:create)
//                        — with afterMessageId, so the route's reply guard
//                        refuses if a colleague replied after the proposal;
//                        `force` is never sent.
//   propose_note         PUT /api/purchase-orders/:id {notes}      (purchase-orders:update)
//                        — appends one "[Note …]" line, the same way the PO
//                        page appends its cancel / close annotations;
//                        PUT /api/service-cases/:id {actionLog}    (service-cases:update)
//                        — appends one "Action taken" entry, the same body the
//                        case page's Action log saves.
//   propose_po_approval  PUT /api/purchase-orders/:id {status: "CONFIRMED"}
//                        (purchase-orders:update + purchase-orders:approve) —
//                        the PO page's "Mark Confirmed" on a SUBMITTED PO.
//
// Not offered (no comment / remark / activity endpoint in the ERP): notes on a
// sales order (only the full edit PUT, which locks once production starts and
// rewrites the header) and on a production order (its PUT / PATCH has no notes
// field). Never: payments, stock, prices, deletes, payroll.
//
// Everything here is pure or takes its I/O through `ActionDeps`, so the whole
// propose → confirm path is unit-tested with fakes (tests/mcp-4bc.test.mjs).
// routes/mcp.ts supplies the real deps (readValue as the person, the armed
// in-process write, hasPermission, emitAudit).
// ---------------------------------------------------------------------------
import {
  ACTIONS_PER_DAY,
  actionTarget,
  confirmedSince,
  consumePendingAction,
  createPendingAction,
  describeOutcome,
  finishPendingAction,
  kindAllowed,
  myDayStartIso,
  peekPendingKind,
  readMailboxes,
  type ActionKind,
} from "./mcp-actions";
import { actionBodyAllowed, allowlistedAction } from "./mcp-inner";
import { parseAddressList, replyRecipients, type ThreadMessageLite } from "./mail-threading";

type Db = D1Database;
type Obj = Record<string, unknown>;

export const MAX_NOTE = 2000;
export const MAX_REPLY = 20_000;
const SAFE_REF = /^[A-Za-z0-9._-]{1,80}$/;

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const data = (body: unknown): Obj => {
  const b = obj(body);
  return b.success !== undefined && b.data !== undefined ? obj(b.data) : b;
};
const rm = (sen: unknown): string | null => {
  const n = Number(sen);
  return sen === undefined || sen === null || !Number.isFinite(n) ? null : `RM ${(n / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export type WriteKind = "mail_reply" | "po_note" | "case_note" | "po_approval";
export type Proposal = { ok: true; payload: Obj; summary: string; target: string; warnings: string[] } | { ok: false; error: string; status?: number };

// ── pure: picking the record ────────────────────────────────────────────────

/** A /api/search reply → the id of the `kind` hit whose number (label) or id matches, or the only hit. */
export function pickSearchHit(searchBody: unknown, kind: "purchase_order" | "service_case", query: string): string | null {
  const q = query.trim().toLowerCase();
  const items = arr(obj(obj(searchBody).data).groups)
    .filter((g) => s(g.kind) === kind)
    .flatMap((g) => arr(g.items));
  const exact = items.find((it) => s(it.label).toLowerCase() === q || s(it.id).toLowerCase() === q);
  if (exact) return s(exact.id) || null;
  return items.length === 1 ? s(items[0].id) || null : null;
}

// ── pure: mail reply ────────────────────────────────────────────────────────

export type ThreadView = {
  id: string;
  subject: string;
  mailbox: string;
  status: string;
  newestMessageId: string | null;
  messages: (ThreadMessageLite & { id: string })[];
  lastFrom: string;
  lastAt: string;
  lastText: string;
};

/** GET /api/mail-center/threads/:id → what the proposal needs (never stored whole). */
export function readThread(body: unknown): ThreadView | null {
  const b = obj(body);
  const t = obj(b.thread);
  if (!s(t.id)) return null;
  const messages = arr(b.messages).map((m) => ({
    id: s(m.id),
    direction: s(m.direction),
    fromAddress: s(m.fromAddress),
    toAddresses: Array.isArray(m.toAddresses) ? (m.toAddresses as unknown[]).map(String) : [],
    ccAddresses: Array.isArray(m.ccAddresses) ? (m.ccAddresses as unknown[]).map(String) : [],
    messageId: s(m.messageId) || null,
    referenceIds: s(m.referenceIds) || null,
    createdAt: s(m.createdAt),
    _text: s(m.textBody),
    _fromName: s(m.fromName),
  }));
  const newest = messages.slice().sort((a, b2) => (a.createdAt < b2.createdAt ? 1 : a.createdAt > b2.createdAt ? -1 : 0))[0];
  return {
    id: s(t.id),
    subject: s(t.subject) || "(no subject)",
    mailbox: s(t.mailboxAddress).toLowerCase(),
    status: s(t.status),
    newestMessageId: newest ? newest.id : null,
    messages: messages.map(({ _text: _t, _fromName: _f, ...m }) => m),
    lastFrom: newest ? newest._fromName || newest.fromAddress : "",
    lastAt: newest ? newest.createdAt : "",
    lastText: newest ? cut(newest._text.replace(/\s+/g, " ").trim(), 300) : "",
  };
}

/**
 * propose_mail_reply. The route computes the recipients itself (the newest
 * correspondent); the summary shows that same computation (replyRecipients) so
 * the person sees who it goes to. A From the person names must be one of their
 * own live mailboxes (the route would silently fall back otherwise).
 */
export function buildMailReplyProposal(args: Obj, thread: ThreadView, mailboxesBody: unknown): Proposal {
  const text = s(args.body ?? args.text).trim();
  if (!text) return { ok: false, error: "Write the reply's message (body)." };
  if (text.length > MAX_REPLY) return { ok: false, error: `The reply is too long (at most ${MAX_REPLY} characters).` };
  const live = readMailboxes(mailboxesBody).filter((m) => m.active);
  const asked = s(args.from_mailbox ?? args.fromMailbox).trim().toLowerCase();
  let fromAddress = "";
  if (asked) {
    if (!live.some((m) => m.address === asked)) {
      return { ok: false, error: `You may not send from ${asked}. You can send from: ${live.map((m) => m.address).join(", ") || "none"}.` };
    }
    fromAddress = asked;
  }
  const from = fromAddress || thread.mailbox;
  const r = replyRecipients(thread.messages, "reply", [from, thread.mailbox].filter(Boolean));
  const to = parseAddressList(r.to);
  if (to.length === 0) return { ok: false, error: "This thread has no correspondent to reply to." };
  const body: Obj = { text, ...(thread.newestMessageId ? { afterMessageId: thread.newestMessageId } : {}), ...(fromAddress ? { fromAddress } : {}) };
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const summary =
    `Reply in Mail Center to the thread "${cut(thread.subject, 120)}" (mailbox ${thread.mailbox || "—"}).\n` +
    `From: ${from || "the thread's mailbox"}\nTo: ${to.join(", ")}\nSubject: ${subject}\n` +
    (thread.lastText ? `Replying to ${thread.lastFrom || "the last message"}: "${thread.lastText}"\n` : "") +
    `Message:\n${cut(text, 1500)}\n` +
    "If a colleague replies to this thread before you confirm, it will NOT be sent (Mail Center's reply guard).";
  return {
    ok: true,
    payload: { ref: thread.id, body },
    summary,
    target: writeTarget("mail_reply", { ref: thread.id, to, subject: thread.subject }),
    warnings: thread.status && thread.status !== "open" ? [`The thread is ${thread.status}.`] : [],
  };
}

// ── pure: notes ─────────────────────────────────────────────────────────────

export type PoView = { id: string; poNo: string; status: string; supplier: string; notes: string; updatedAt: string; totalSen: unknown; expectedDate: string; lines: number };

export function readPo(body: unknown): PoView | null {
  const d = data(body);
  if (!s(d.id)) return null;
  return {
    id: s(d.id),
    poNo: s(d.poNo) || s(d.id),
    status: s(d.status),
    supplier: s(d.supplierName),
    notes: s(d.notes),
    updatedAt: s(d.updatedAt ?? d.updated_at),
    totalSen: "totalSen" in d ? d.totalSen : undefined,
    expectedDate: s(d.expectedDate).slice(0, 10),
    lines: Array.isArray(d.items) ? (d.items as unknown[]).length : 0,
  };
}

export type CaseView = { id: string; caseNo: string; status: string; customer: string; actionLog: Obj[] };

export function readCase(body: unknown): CaseView | null {
  const d = data(body);
  if (!s(d.id)) return null;
  return { id: s(d.id), caseNo: s(d.caseNo) || s(d.id), status: s(d.status), customer: s(d.customerName), actionLog: arr(d.actionLog) };
}

/** The note text the person asked for: one line, capped. */
export function noteText(args: Obj): { ok: true; text: string } | { ok: false; error: string } {
  const text = s(args.note ?? args.text).replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "Write the note." };
  if (text.length > MAX_NOTE) return { ok: false, error: `The note is too long (at most ${MAX_NOTE} characters).` };
  return { ok: true, text };
}

/** "[Note 2026-11-27 Lim Wei (via AI Connector): …]" — the PO page's own annotation style. */
export function poNoteLine(text: string, who: string, today: string): string {
  return `[Note ${today} ${who || "staff"} (via AI Connector): ${text}]`;
}

/** The PO's notes with one line appended (PO page: `${po.notes}\n${annotation}`). */
export function appendPoNote(existing: string, line: string): string {
  return existing ? `${existing}\n${line}` : line;
}

/** One "Action taken" entry, the shape the service-case page saves. */
export function caseLogEntry(text: string, who: string, today: string, nowIso: string, rand: string): Obj {
  return { id: `act-${rand}`, date: today, description: `${text} (via AI Connector)`, createdAt: nowIso, createdByName: who };
}

export function buildPoNoteProposal(args: Obj, po: PoView): Proposal {
  const t = noteText(args);
  if (!t.ok) return t;
  return {
    ok: true,
    payload: { ref: po.id, text: t.text },
    summary: `Add a note to purchase order ${po.poNo} (${po.supplier || "no supplier"}, ${po.status}):\n"${t.text}"\nIt is added to the end of the PO's notes with today's date and your name.`,
    target: writeTarget("po_note", { ref: po.id, number: po.poNo }),
    warnings: [],
  };
}

export function buildCaseNoteProposal(args: Obj, kase: CaseView): Proposal {
  const t = noteText(args);
  if (!t.ok) return t;
  return {
    ok: true,
    payload: { ref: kase.id, text: t.text },
    summary: `Add to service case ${kase.caseNo} (${kase.customer || "no customer"}, ${kase.status}) under "Action taken":\n"${t.text}"\nIt is dated today, with your name.`,
    target: writeTarget("case_note", { ref: kase.id, number: kase.caseNo }),
    warnings: [],
  };
}

// ── pure: PO approval ───────────────────────────────────────────────────────

export function buildPoApprovalProposal(po: PoView): Proposal {
  if (po.status !== "SUBMITTED") {
    return { ok: false, status: 409, error: `Purchase order ${po.poNo} is ${po.status || "in an unknown state"}. Only a sent (SUBMITTED) PO can be approved — the PO page's "Mark Confirmed".` };
  }
  const value = rm(po.totalSen);
  return {
    ok: true,
    payload: { ref: po.id, expectedUpdatedAt: po.updatedAt },
    summary:
      `Approve purchase order ${po.poNo}: mark it Confirmed (SUBMITTED → CONFIRMED), the same as "Mark Confirmed" on the PO page.\n` +
      `Supplier: ${po.supplier || "—"} · ${po.lines} line(s)${value ? ` · ${value}` : ""}${po.expectedDate ? ` · expected ${po.expectedDate}` : ""}.\n` +
      "If anyone changes this PO before you confirm, it will not be approved.",
    target: writeTarget("po_approval", { ref: po.id, number: po.poNo }),
    warnings: [],
  };
}

// ── pure: log line + outcome ────────────────────────────────────────────────

/** The call-log line: kind + which record. Never a message body or note text. */
export function writeTarget(kind: WriteKind, p: Obj): string {
  if (kind === "mail_reply") {
    const to = Array.isArray(p.to) ? (p.to as unknown[]).map(String).join(", ") : "";
    return `mail_reply: thread ${s(p.ref)}${to ? ` to ${cut(to, 80)}` : ""}${p.subject ? ` — ${cut(s(p.subject), 60)}` : ""}`;
  }
  const label = kind === "case_note" ? "service case" : "purchase order";
  return `${kind}: ${label} ${s(p.number) || s(p.ref)}`;
}

/** What the ERP's own route answered, in plain words. A 403 is the ERP's own refusal. */
export function describeWriteOutcome(kind: ActionKind, status: number, body: unknown): { ok: boolean; text: string } {
  if (kind === "meeting" || kind === "email") return describeOutcome(kind, status, body);
  const b = obj(body);
  const err = typeof b.error === "string" ? b.error : "";
  const refused = status === 403 ? `the ERP refused it${b.missingPermission ? ` — you don't have the ${s(b.missingPermission)} permission` : err && err !== "Forbidden" ? ` — ${err}` : ""}` : "";
  if (kind === "mail_reply") {
    if (status >= 200 && status < 300) return { ok: true, text: `Reply sent${b.queued ? " (the mail provider was busy, so it is queued and retried automatically)" : ""}. It is in the thread in Mail Center.` };
    if (status === 409 && b.code === "already_replied") return { ok: false, text: `Not sent — ${s(b.by) || "a colleague"} already replied${b.at ? ` at ${s(b.at)}` : ""}. Read their reply first; propose again if you still want to send.` };
    return { ok: false, text: `Not sent — ${refused || `Mail Center answered: ${err || `HTTP ${status}`}`}.` };
  }
  const what = kind === "po_approval" ? "Not approved" : "Not saved";
  if (status >= 200 && status < 300) {
    const d = obj(b.data);
    const no = (k: string) => (s(d[k]) ? ` ${s(d[k])}` : "");
    if (kind === "po_approval") return { ok: true, text: `Purchase order${no("poNo")} approved — it is now Confirmed.` };
    if (kind === "po_note") return { ok: true, text: `Note added to purchase order${no("poNo")}.` };
    return { ok: true, text: `Note added to service case${no("caseNo")} under "Action taken".` };
  }
  if (status === 409) return { ok: false, text: `${what} — the record was changed by someone else after you saw it. Propose it again.` };
  return { ok: false, text: `${what} — ${refused || `the ERP answered: ${err || `HTTP ${status}`}`}.` };
}

// ── the propose → confirm path (I/O through deps) ───────────────────────────

export type Reply = { status: number; body: unknown };
export type ActionDeps = {
  db: Db;
  tokenId: string;
  userId: string;
  userName: string;
  /** A GET as the person (routes/mcp.ts readValue: module gate → inner GET → redaction). */
  read: (path: string, query?: Obj) => Promise<Reply>;
  /** The ONE armed in-process write, as the person (routes/mcp.ts innerAction). */
  write: (actionId: string, req: { method: string; path: string; body: unknown }) => Promise<Reply>;
  /** The ERP's own permission check (rbac.ts hasPermission). */
  can: (resource: string, action: string) => Promise<boolean>;
  /** The ERP audit trail for a route that does not write one itself. */
  audit?: (kind: WriteKind, ref: string, after: Obj) => Promise<void>;
  now?: () => number;
};
export type Outcome = { ok: boolean; text: string; status: number; target: string };

const myToday = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const rand6 = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

/** The ERP permission each write kind needs, exactly as its route checks it. */
export const WRITE_PERMISSIONS: Record<WriteKind, [string, string][]> = {
  mail_reply: [["mail-center", "create"]],
  po_note: [["purchase-orders", "update"]],
  case_note: [["service-cases", "update"]],
  po_approval: [["purchase-orders", "update"], ["purchase-orders", "approve"]],
};

async function missingPermission(deps: ActionDeps, kind: WriteKind): Promise<string | null> {
  for (const [r, a] of WRITE_PERMISSIONS[kind]) if (!(await deps.can(r, a))) return `${r}:${a}`;
  return null;
}

/** Find a PO / service case by id, `kind:id` or number, as the person. */
async function findRecord(deps: ActionDeps, kind: "purchase_order" | "service_case", raw: string): Promise<{ ok: true; body: unknown } | { ok: false; error: string; status: number }> {
  const api = kind === "purchase_order" ? "/api/purchase-orders" : "/api/service-cases";
  const label = kind === "purchase_order" ? "purchase order" : "service case";
  const q = raw.trim();
  if (!q || q.length > 80) return { ok: false, error: `Give the ${label} number.`, status: 400 };
  const prefixed = new RegExp(`^${kind}:([A-Za-z0-9._-]{1,80})$`).exec(q);
  let id = prefixed ? prefixed[1] : "";
  if (!id && SAFE_REF.test(q)) {
    const direct = await deps.read(`${api}/${q}`);
    if (direct.status === 200) return { ok: true, body: direct.body };
    if (direct.status === 403) return { ok: false, error: `You don't have access to ${label}s.`, status: 403 };
  }
  if (!id) {
    const sr = await deps.read("/api/search", { q, limit: 8 });
    if (sr.status === 403) return { ok: false, error: `You don't have access to ${label}s.`, status: 403 };
    id = sr.status === 200 ? pickSearchHit(sr.body, kind, q) ?? "" : "";
    if (!id) return { ok: false, error: `No ${label} matches "${q}" — give its exact number.`, status: 404 };
  }
  if (!SAFE_REF.test(id)) return { ok: false, error: `That ${label} id cannot be read.`, status: 400 };
  const r = await deps.read(`${api}/${id}`);
  if (r.status === 200) return { ok: true, body: r.body };
  return { ok: false, error: r.status === 403 ? `You don't have access to ${label}s.` : r.status === 404 ? `${label[0].toUpperCase()}${label.slice(1)} not found.` : `The ERP answered HTTP ${r.status}.`, status: r.status };
}

/**
 * propose_mail_reply / propose_note / propose_po_approval: switches → the
 * ERP's own permission → read the record as the person → validate → store ONE
 * pending action. Nothing is written to the ERP here.
 */
export async function proposeWrite(deps: ActionDeps, kind: WriteKind, args: Obj): Promise<Outcome & { confirmationId?: string; summary?: string; warnings?: string[] }> {
  let target = `propose:${kind}`;
  const fail = (text: string, status: number): Outcome => ({ ok: false, text, status, target });
  const off = await kindAllowed(deps.db, kind);
  if (off) return fail(off, 403);
  const missing = await missingPermission(deps, kind);
  if (missing) return fail(`Not available to your role: the ERP requires the ${missing} permission for this.`, 403);

  let p: Proposal;
  if (kind === "mail_reply") {
    const tid = s(args.thread_id ?? args.threadId).trim();
    if (!SAFE_REF.test(tid)) return fail("Give the Mail Center thread id (thread_id — from daily_brief's mail list or the thread's link).", 400);
    const [th, mb] = await Promise.all([deps.read(`/api/mail-center/threads/${tid}`), deps.read("/api/mail-center/addresses")]);
    if (th.status === 403) return fail("You don't have access to Mail Center.", 403);
    if (th.status === 404) return fail("No such thread in your mailboxes.", 404);
    const view = th.status === 200 ? readThread(th.body) : null;
    if (!view) return fail(`Mail Center could not be read (HTTP ${th.status}).`, th.status >= 400 ? th.status : 502);
    p = buildMailReplyProposal(args, view, mb.status === 200 ? mb.body : []);
  } else if (kind === "po_note" || kind === "po_approval") {
    const f = await findRecord(deps, "purchase_order", s(args.number_or_id ?? args.po));
    if (!f.ok) return fail(f.error, f.status);
    const po = readPo(f.body);
    if (!po) return fail("That purchase order could not be read.", 502);
    p = kind === "po_note" ? buildPoNoteProposal(args, po) : buildPoApprovalProposal(po);
  } else {
    const f = await findRecord(deps, "service_case", s(args.number_or_id ?? args.case));
    if (!f.ok) return fail(f.error, f.status);
    const kase = readCase(f.body);
    if (!kase) return fail("That service case could not be read.", 502);
    p = buildCaseNoteProposal(args, kase);
  }
  if (!p.ok) return fail(p.error, p.status ?? 400);
  target = p.target;
  const pend = await createPendingAction(deps.db, { tokenId: deps.tokenId, userId: deps.userId, kind, payload: p.payload, summary: p.summary }, deps.now?.());
  return { ok: true, text: "", status: 200, target, confirmationId: pend.id, summary: p.summary, warnings: p.warnings };
}

/**
 * The request a confirmed action makes. Notes are appended to what is stored
 * NOW (a fresh read as the person), so a note never overwrites another one
 * added after the proposal; the PO note then carries that read's updatedAt, so
 * an edit landing in between is refused (409) rather than overwritten. A PO
 * approval carries the updatedAt the person SAW, so a PO changed since the
 * proposal is not approved.
 */
async function requestFor(deps: ActionDeps, kind: ActionKind, payload: unknown): Promise<{ ok: true; method: string; path: string; body: unknown } | { ok: false; status: number; text: string }> {
  const p = obj(payload);
  const ref = s(p.ref);
  const route = allowlistedAction(kind, ref);
  if (!route) return { ok: false, status: 400, text: "That action is not allowed." };
  const now = deps.now?.() ?? Date.now();
  if (kind === "meeting" || kind === "email") return { ok: true, ...route, body: payload };
  if (kind === "mail_reply") return { ok: true, ...route, body: obj(p.body) };
  if (kind === "po_approval") return { ok: true, ...route, body: { status: "CONFIRMED", ...(s(p.expectedUpdatedAt) ? { expectedUpdatedAt: s(p.expectedUpdatedAt) } : {}) } };
  const api = kind === "po_note" ? "/api/purchase-orders" : "/api/service-cases";
  const cur = await deps.read(`${api}/${ref}`);
  if (cur.status !== 200) return { ok: false, status: cur.status, text: `Not saved — the record could not be read now (HTTP ${cur.status}).` };
  const today = myToday(now);
  if (kind === "po_note") {
    const po = readPo(cur.body);
    if (!po) return { ok: false, status: 502, text: "Not saved — the purchase order could not be read now." };
    const notes = appendPoNote(po.notes, poNoteLine(s(p.text), deps.userName, today));
    return { ok: true, ...route, body: { notes, ...(po.updatedAt ? { expectedUpdatedAt: po.updatedAt } : {}) } };
  }
  const kase = readCase(cur.body);
  if (!kase) return { ok: false, status: 502, text: "Not saved — the service case could not be read now." };
  return { ok: true, ...route, body: { actionLog: [...kase.actionLog, caseLogEntry(s(p.text), deps.userName, today, new Date(now).toISOString(), rand6())] } };
}

/**
 * confirm_action, for every kind: the main switch → under the daily cap → the
 * action's own switch (peeked, so a switched-off action is refused without
 * using it up) → single-use claim → the body fence → ONE write as the person.
 */
export async function confirmPending(deps: ActionDeps, raw: string): Promise<Outcome> {
  const cid = raw.trim();
  let target = `confirm:${cid}`;
  const fail = (text: string, status: number): Outcome => ({ ok: false, text, status, target });
  if (!/^mcpa_[a-f0-9]{24}$/.test(cid)) return fail("Give the confirmationId from the propose_… tool.", 400);
  const mainOff = await kindAllowed(deps.db, "meeting");
  if (mainOff) return fail(mainOff, 403);
  if ((await confirmedSince(deps.db, deps.userId, myDayStartIso(deps.now?.()))) >= ACTIONS_PER_DAY) {
    return fail(`You have reached today's limit of ${ACTIONS_PER_DAY} AI actions. Do it in the ERP instead, or try again tomorrow.`, 429);
  }
  const peek = await peekPendingKind(deps.db, cid, deps.tokenId, deps.userId, deps.now?.());
  if (peek) {
    const off = await kindAllowed(deps.db, peek);
    if (off) return fail(off, 403);
  }
  const act = await consumePendingAction(deps.db, cid, deps.tokenId, deps.userId, deps.now?.());
  if (!act) return fail("That confirmation is unknown, already used, cancelled, expired (10 minutes) or not yours. Propose it again.", 404);
  const p = obj(act.payload);
  target = act.kind === "meeting" || act.kind === "email" ? actionTarget(act.kind, act.payload) : `${act.kind}: ${s(p.ref)}`;
  let out: Reply;
  const req = await requestFor(deps, act.kind, act.payload);
  if (!req.ok) {
    await finishPendingAction(deps.db, cid, req.status, req.text);
    return { ok: false, text: req.text, status: req.status, target };
  }
  if (!actionBodyAllowed(act.kind, req.body)) {
    await finishPendingAction(deps.db, cid, 400, "blocked by the write fence");
    return { ok: false, text: "Not done — the request was blocked by the AI connector's write fence.", status: 400, target };
  }
  try {
    out = await deps.write(cid, { method: req.method, path: req.path, body: req.body });
  } catch (e) {
    out = { status: 502, body: { error: e instanceof Error ? e.message : String(e) } };
  }
  const d = describeWriteOutcome(act.kind, out.status, out.body);
  await finishPendingAction(deps.db, cid, out.status, d.text);
  if (d.ok && act.kind === "case_note" && deps.audit) {
    // PUT /api/service-cases/:id writes no audit row of its own (the PO PUT and
    // the Mail Center reply do) — record this one in the ERP's audit trail.
    await deps.audit("case_note", s(p.ref), { actionLogAdded: s(p.text).slice(0, 200), via: "ai-connector" }).catch(() => undefined);
  }
  return { ok: d.ok, text: d.text, status: out.status, target };
}
