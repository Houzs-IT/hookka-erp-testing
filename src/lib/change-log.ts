// ---------------------------------------------------------------------------
// change-log.ts (pure) — the Audit Log's "All changes" (finance backlog item
// 10, the design's "a full Audit Log of every change"). One dated list of who
// changed what in Finance, built from what the system already keeps:
//   · the ledger — every posting, edit (its legs before and after), void,
//     restore and undo, with who and when (immutable, hash-chained);
//   · the document lifecycle — voided / deleted / restored documents;
//   · the payment-voucher ladder — prepared / checked / approved;
//   · the audit trail (audit_events) — settings and the steps a document took
//     that post nothing.
// One act seen by two of these (a supplier payment's void is a ledger entry,
// a lifecycle state AND an audit row) is shown once — the ledger's first,
// since it carries the amounts.
// ---------------------------------------------------------------------------

export type ChangeKind =
  | "posted"
  | "edited"
  | "voided"
  | "restored"
  | "undone"
  | "deleted"
  | "created"
  | "prepared"
  | "checked"
  | "approved"
  | "changed";

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  posted: "Posted",
  edited: "Edited",
  voided: "Voided",
  restored: "Restored",
  undone: "Undone",
  deleted: "Deleted",
  created: "Created",
  prepared: "Prepared",
  checked: "Checked",
  approved: "Approved",
  changed: "Changed",
};

export type ChangeSource = "ledger" | "ladder" | "lifecycle" | "audit";

export type ChangeLeg = {
  /** An edit's legs: "before" = the posting reversed, "after" = the re-post. */
  side: "before" | "after" | null;
  accountCode: string;
  debitSen: number;
  creditSen: number;
  description: string;
};

export type ChangeEvent = {
  id: string;
  /** When it was done (ISO, UTC). */
  at: string;
  kind: ChangeKind;
  source: ChangeSource;
  /** Ledger base source type, lifecycle source type, or audit resource. */
  docType: string;
  docId: string;
  actorUserId: string | null;
  actorName: string | null;
  /** Posted / re-posted / reversed amount (Σ DR); a voucher's total. */
  amountSen: number | null;
  /** An edit's amount before (Σ DR of the reversed posting). */
  beforeSen: number | null;
  legs: ChangeLeg[];
  /** The audit action as recorded ("draw-due-edit"). */
  action: string | null;
  before: unknown;
  after: unknown;
  /** Set by the route: the document number and who it is with. */
  reference: string | null;
  party: string | null;
  /** Set by the route: what a bank / cash-position step touched ("→ HPV-…"). */
  note: string | null;
};

const blank = (e: Pick<ChangeEvent, "id" | "at" | "kind" | "source" | "docType" | "docId"> & Partial<ChangeEvent>): ChangeEvent => ({
  actorUserId: null,
  actorName: null,
  amountSen: null,
  beforeSen: null,
  legs: [],
  action: null,
  before: null,
  after: null,
  reference: null,
  party: null,
  note: null,
  ...e,
});

// Timestamps arrive as Postgres text ("2026-10-16 09:38:03.509172+00"), app
// ISO ("2026-10-16T09:38:03.509Z") or Date objects; one comparable ISO form.
// A time without a zone is UTC (the server's clock).
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
  s = s.replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d{2})$/, "$1:00");
  if (/T\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// A calendar month in Malaysia time, as UTC instants [from, to).
export function monthWindowMy(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const shift = 8 * 60 * 60 * 1000;
  return { from: new Date(Date.UTC(y, m - 1, 1) - shift).toISOString(), to: new Date(Date.UTC(y, m, 1) - shift).toISOString() };
}

// The SQL pre-filter on text timestamps stored in two formats: date-only
// bounds a day either side of the window (the exact cut is made on toIso).
export function sqlDayBounds(ym: string): { lo: string; hi: string } {
  const w = monthWindowMy(ym);
  const day = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
  return { lo: day(w.from, -1), hi: day(w.to, 1) };
}

export const inWindow = (iso: string, w: { from: string; to: string }) => iso >= w.from && iso < w.to;

// Malaysia time for the list, "18 Oct 2026 14:05".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function myTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 8 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

// What a ledger source type says about the act (the conventions of
// src/api/lib/document-lifecycle.ts and the restate routes):
//   <base>_restate_rev|post[:<stamp>] — an edit (the stamp pairs the reversal
//     with the re-post; a purchase invoice's GL re-sync has none);
//   <base>_unvoid / _void / _reversal — restored / voided / undone;
//   a sourceId ending ":edit-<ms>" — a purchase invoice edit's adjustment.
export function classifyLedger(
  sourceType: string,
  sourceId: string,
): { kind: "posted" | "edited" | "voided" | "restored" | "undone"; base: string; docId: string; side: ChangeLeg["side"]; stamp: string | null } {
  const r = /^(.*)_restate_(rev|post)(?::(.+))?$/.exec(sourceType);
  if (r) return { kind: "edited", base: r[1], docId: sourceId, side: r[2] === "rev" ? "before" : "after", stamp: r[3] ?? null };
  const adj = /^(.*):edit-\d+$/.exec(sourceId);
  if (adj) return { kind: "edited", base: sourceType, docId: adj[1], side: null, stamp: null };
  for (const [suffix, kind] of [["_unvoid", "restored"], ["_void", "voided"], ["_reversal", "undone"]] as const) {
    if (sourceType.endsWith(suffix)) return { kind, base: sourceType.slice(0, -suffix.length), docId: sourceId, side: null, stamp: null };
  }
  return { kind: "posted", base: sourceType, docId: sourceId, side: null, stamp: null };
}

export type LedgerRow = {
  sourceType: string;
  sourceId: string;
  accountCode: string;
  debitSen: number;
  creditSen: number;
  description?: string | null;
  actorUserId?: string | null;
  postedAt: unknown;
};

// One event per posting: legs of one batch share their posted time; an edit's
// reversal and re-post share their stamp.
export function ledgerEvents(rows: LedgerRow[]): ChangeEvent[] {
  const by = new Map<string, ChangeEvent>();
  for (const r of rows) {
    const at = toIso(r.postedAt);
    if (!at) continue;
    const c = classifyLedger(String(r.sourceType ?? ""), String(r.sourceId ?? ""));
    const key = c.kind === "edited" && c.stamp ? `L|${c.base}|${c.docId}|edited|${c.stamp}` : `L|${c.base}|${c.docId}|${c.kind}|${at}`;
    let e = by.get(key);
    if (!e) {
      e = blank({ id: key, at, kind: c.kind, source: "ledger", docType: c.base, docId: c.docId, amountSen: 0 });
      by.set(key, e);
    }
    if (at < e.at) e.at = at;
    if (!e.actorUserId && r.actorUserId) e.actorUserId = r.actorUserId;
    const dr = Math.round(Number(r.debitSen) || 0);
    const cr = Math.round(Number(r.creditSen) || 0);
    e.legs.push({ side: c.side, accountCode: String(r.accountCode ?? ""), debitSen: dr, creditSen: cr, description: String(r.description ?? "") });
    if (c.side === "before") e.beforeSen = (e.beforeSen ?? 0) + dr;
    else e.amountSen = (e.amountSen ?? 0) + dr;
  }
  return [...by.values()];
}

export type LifecycleRow = { sourceType: string; sourceId: string; state: string; actionAt: unknown; actorUserId?: string | null };

// The lifecycle keeps each document's LAST action only.
export function lifecycleEvents(rows: LifecycleRow[]): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  for (const r of rows) {
    const at = toIso(r.actionAt);
    const st = String(r.state ?? "").toUpperCase();
    const kind: ChangeKind | null = st === "DELETED" ? "deleted" : st === "VOID" ? "voided" : st === "ACTIVE" ? "restored" : null;
    if (!at || !kind) continue;
    out.push(blank({ id: `D|${r.sourceType}|${r.sourceId}|${at}`, at, kind, source: "lifecycle", docType: String(r.sourceType), docId: String(r.sourceId), actorUserId: r.actorUserId ?? null }));
  }
  return out;
}

export type LadderRow = {
  id: string;
  pvNo?: string | null;
  payee?: string | null;
  totalSen?: number | null;
  preparedAt?: unknown;
  preparedBy?: string | null;
  checkedAt?: unknown;
  checkedBy?: string | null;
  approvedAt?: unknown;
  approvedBy?: string | null;
};

// A payment voucher's ladder steps still on the voucher (a step taken back
// clears its stamp).
export function ladderEvents(rows: LadderRow[]): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  for (const r of rows) {
    const steps: [ChangeKind, unknown, string | null | undefined][] = [
      ["prepared", r.preparedAt, r.preparedBy],
      ["checked", r.checkedAt, r.checkedBy],
      ["approved", r.approvedAt, r.approvedBy],
    ];
    for (const [kind, when, by] of steps) {
      const at = toIso(when);
      if (!at) continue;
      const pvNo = String(r.pvNo ?? "");
      out.push(blank({
        id: `P|${r.id}|${kind}`, at, kind, source: "ladder", docType: "payment_voucher", docId: String(r.id),
        actorUserId: by ?? null, amountSen: r.totalSen === null || r.totalSen === undefined ? null : Math.round(Number(r.totalSen) || 0),
        reference: pvNo && !pvNo.startsWith("DRAFT") ? pvNo : null, party: r.payee ? String(r.payee).trim() || null : null,
      }));
    }
  }
  return out;
}

export type AuditRow = {
  id: string;
  ts: unknown;
  actorUserId?: string | null;
  actorUserName?: string | null;
  resource: string;
  resourceId: string;
  action: string;
  beforeJson?: string | null;
  afterJson?: string | null;
};

const AUDIT_KIND: Record<string, ChangeKind> = {
  create: "created",
  update: "edited",
  restate: "edited",
  void: "voided",
  unvoid: "restored",
  delete: "deleted",
  post: "posted",
  prepare: "prepared",
  check: "checked",
  approve: "approved",
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const rm = (sen: number) => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parse = (s: string | null | undefined): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export function auditEvents(rows: AuditRow[]): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  for (const r of rows) {
    const at = toIso(r.ts);
    if (!at) continue;
    const action = String(r.action ?? "");
    const before = parse(r.beforeJson);
    const after = parse(r.afterJson);
    // A bank line, a planned payment, an opening invoice: the amount it carried.
    const senOf = (o: unknown) => (isObj(o) ? [o.amountSen, o.totalSen].find((v): v is number => typeof v === "number") ?? null : null);
    const amt = senOf(after) ?? senOf(before);
    out.push(blank({
      id: `A|${r.id}`, at, kind: AUDIT_KIND[action] ?? "changed", source: "audit", docType: String(r.resource), docId: String(r.resourceId),
      actorUserId: r.actorUserId ?? null, actorName: r.actorUserName ?? null, action, before, after, amountSen: amt,
    }));
  }
  return out;
}

// One act, once. Events are kept in this order — ledger, ladder, lifecycle,
// audit — and a later one is dropped when a kept one says the same thing
// about the same document within two minutes: the same kind (a "created" is
// a "posted"), and its document id or number is the kept one's id or number.
// The kept event takes the dropped one's actor when it had none.
const SAME_ACT_MS = 120_000;
const RANK: Record<ChangeSource, number> = { ledger: 0, ladder: 1, lifecycle: 2, audit: 3 };
const SAME_ACT: ChangeKind[][] = [["posted", "created"], ["undone", "deleted"]];
const sameKind = (a: ChangeKind, b: ChangeKind) => a === b || SAME_ACT.some((g) => g.includes(a) && g.includes(b));

export function mergeEvents(events: ChangeEvent[]): ChangeEvent[] {
  const ordered = [...events].sort((a, b) => RANK[a.source] - RANK[b.source]);
  const kept: ChangeEvent[] = [];
  const byDoc = new Map<string, ChangeEvent[]>();
  const index = (k: string | null, e: ChangeEvent) => {
    if (!k) return;
    const list = byDoc.get(k);
    if (list) list.push(e);
    else byDoc.set(k, [e]);
  };
  for (const e of ordered) {
    if (e.source !== "ledger") {
      const t = Date.parse(e.at);
      const seen = new Set<ChangeEvent>();
      const cands = [...(byDoc.get(e.docId) ?? []), ...(e.reference ? byDoc.get(e.reference) ?? [] : [])].filter((x) => !seen.has(x) && seen.add(x));
      const twin = cands.find((k) => sameKind(k.kind, e.kind) && Math.abs(Date.parse(k.at) - t) <= SAME_ACT_MS);
      if (twin) {
        if (!twin.actorUserId && e.actorUserId) twin.actorUserId = e.actorUserId;
        if (!twin.actorName && e.actorName) twin.actorName = e.actorName;
        continue;
      }
    }
    kept.push(e);
    index(e.docId, e);
    if (e.reference && e.reference !== e.docId) index(e.reference, e);
  }
  return kept.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

const DOC_TYPE_LABEL: Record<string, string> = {
  invoice: "Sales invoice",
  invoices: "Sales invoice",
  purchase_invoice: "Purchase invoice",
  "purchase-invoices": "Purchase invoice",
  payment: "Customer receipt",
  payments: "Customer receipt",
  supplier_payment: "Supplier payment",
  "supplier-payments": "Supplier payment",
  payment_voucher: "Payment voucher",
  official_receipt: "Official receipt",
  manual: "Journal entry",
  fund_transfer: "Fund transfer",
  other_party_bill: "Other party bill",
  other_party_payment: "Other party payment",
  "other-party-payments": "Other party payment",
  purchase_credit_note: "Purchase credit note",
  credit_note: "Credit note",
  "credit-notes": "Credit note",
  debit_note: "Debit note",
  "debit-notes": "Debit note",
  tf_interest: "Trade finance interest",
  tf_bank_charge: "Trade finance bank charge",
  "trade-finance": "Trade finance",
  labor_post: "Labour posting",
  closing_stock: "Closing stock",
  depreciation: "Depreciation",
  year_close: "Year-end close",
  opening_balance: "Opening balance",
  contra: "Contra",
  accounting: "Finance setting",
  // Recorded since item 10 part 2 (audit resources).
  "chart-of-accounts": "Chart of accounts",
  journals: "Journal entry",
  "other-parties": "Other party",
  "other-party-bills": "Other party bill",
  "payment-vouchers": "Payment voucher",
  "official-receipts": "Official receipt",
  "fund-transfers": "Fund transfer",
  "finance-settings": "Finance setting",
  "fixed-assets": "Fixed asset",
  "bank-reco": "Bank reconciliation",
  "cash-position": "Daily cash position",
  "opening-balance": "Opening balance",
  "stock-take": "Stock take",
  "material-opening-stock": "Opening stock",
};

// The settings the "accounting" audit rows name by id.
const SETTING_LABEL: Record<string, string> = {
  ar_counter_rebuild: "Debtor running counter rebuilt",
  ap_counter_rebuild: "Creditor running counter rebuilt",
  forecast_pnl: "Forecast P&L",
  pnl_opening_prior_cum: "P&L before the opening date",
  "opening-date": "Opening date",
  fg_valuation_mode: "Finished goods valuation",
  rm_valuation_mode: "Raw material valuation",
  labor_account_map: "Labour account map",
  cashflow_account_map: "Cash flow mapping",
  doc_number_prefixes: "Document numbering",
  pnl_section_map: "P&L sections",
  bs_section_map: "Balance sheet sections",
  bank_reco_strict_lock: "Bank month lock",
  fye_changes: "Financial year end",
  fy_locked_ends: "Financial year",
};

// What an audit action is called in the list (the standard ones read as
// their kind: Created / Edited / Voided …).
export const ACTION_LABEL: Record<string, string> = {
  withdraw: "Withdrawn",
  reject: "Sent back",
  attach: "File attached",
  detach: "File removed",
  settle: "Settled",
  dispose: "Disposed",
  describe: "Description changed",
  match: "Matched",
  "match-group": "Matched",
  "match-split": "Matched",
  automatch: "Auto-matched",
  unmatch: "Unmatched",
  import: "Statement imported",
  ignore: "Ignored",
  "restore-line": "Line restored",
  "line-delete": "Line deleted",
  "book-line": "Booked from bank",
  finalize: "Month finalised",
  reopen: "Month re-opened",
  tick: "Ticked",
  untick: "Unticked",
  "planned-add": "Planned payment added",
  "planned-delete": "Planned payment removed",
  "alias-seed": "Item mappings loaded",
  "knock-off": "Knocked off",
  "un-knock": "Knock-off undone",
  "recompute-pi-paid": "Paid amounts recomputed",
  "price-import": "Prices imported",
  "resync-gl": "Re-synced to the ledger",
  unpost: "Unposted",
  setup: "Set up",
  "interest-account-repoint": "Re-pointed",
  "draw-interest": "Interest recorded",
  "draw-bank-charge": "Bank charge recorded",
  "draw-due-edit": "Due date changed",
  "close-year": "Year closed",
  "reopen-year": "Year reopened",
};

export function actionLabel(e: Pick<ChangeEvent, "kind" | "source" | "action">): string {
  return (e.source === "audit" && e.action && ACTION_LABEL[e.action]) || CHANGE_KIND_LABEL[e.kind];
}

// A record with no document number: what it is called in its own snapshot
// (an other party's or an asset's name, an opening invoice's number).
export function payloadRef(e: Pick<ChangeEvent, "before" | "after">): string | null {
  for (const o of [e.after, e.before]) {
    if (!isObj(o)) continue;
    for (const k of ["name", "partyName", "invoiceNo", "piNo", "entryNo", "code"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

const TF_ACTION_LABEL: Record<string, string> = {
  setup: "Facility set up",
  "interest-account-repoint": "Interest account re-pointed",
  "draw-interest": "Interest at drawdown",
  "draw-bank-charge": "Bank charge",
  "draw-due-edit": "Due date",
};

const humanize = (t: string) => t.replace(/[_-]+/g, " ").trim().replace(/^./, (ch) => ch.toUpperCase());

export function docTypeLabel(e: Pick<ChangeEvent, "docType" | "docId" | "source">): string {
  const base = e.docType.split(":")[0];
  if (e.source === "audit" && base === "accounting") {
    if (/^O[CD]B-/.test(e.docId)) return "Other party bill";
    if (/^cs-/.test(e.docId)) return "Closing stock";
    if (/^ob-/.test(e.docId)) return "Opening balance";
    if (/^labor-/.test(e.docId)) return "Labour posting";
    // The opening balance's include / exclude of a pre-opening invoice, a
    // landed-cost run, a renamed account (the routes that write these ids).
    if (/^pi-/.test(e.docId)) return "Opening balance · purchase invoice";
    if (/^inv-/.test(e.docId)) return "Opening balance · sales invoice";
    if (/^grn-/.test(e.docId)) return "Landed cost";
    if (/^\d{3}-[0-9A-Z]{4}$/.test(e.docId)) return "Chart of accounts";
    return "Finance setting";
  }
  if (base.startsWith("tf_interest")) return DOC_TYPE_LABEL.tf_interest;
  if (base.startsWith("tf_bank_charge")) return DOC_TYPE_LABEL.tf_bank_charge;
  return DOC_TYPE_LABEL[base] ?? humanize(base);
}

const NOISE_FIELD = /^(updated_?at|created_?at|updated_?by|created_?by|org_?id|version|rev|row_?hash|prev_?hash)$/i;
const show = (v: unknown, key = ""): string => {
  if (v === null || v === undefined || v === "") return "—";
  // A sen field reads in RM ("interestSen: 96.28").
  if (typeof v === "number" && /Sen$/.test(key)) return rm(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 160);
  return String(v);
};

// Where the audit row's "after" is the whole stored value (a mapping, a stock
// take month, an account, a register row) a key it no longer has was removed;
// elsewhere "after" is what the save sent, and only those fields are compared.
const FULL_AFTER = new Set(["finance-settings", "stock-take", "chart-of-accounts", "other-parties", "fixed-assets", "payment-vouchers"]);

// The fields an audit row changed (top level; time stamps left out).
export function fieldChanges(before: unknown, after: unknown, docType = ""): { field: string; before: string; after: string }[] {
  if (!isObj(before) && !isObj(after)) return [];
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = isObj(after) && isObj(before) && !FULL_AFTER.has(docType) ? Object.keys(a) : [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out: { field: string; before: string; after: string }[] = [];
  for (const k of keys) {
    if (NOISE_FIELD.test(k)) continue;
    const x = show(b[k], k);
    const y = show(a[k], k);
    if (x !== y) out.push({ field: k, before: x, after: y });
  }
  return out;
}

// The list's one-line "what": an edit's amount before → after (or the
// accounts it moved), a setting's values, the first changed fields.
export function changeSummary(e: ChangeEvent): string {
  if (e.source === "ledger") {
    if (e.kind === "edited") {
      if (e.beforeSen !== null && e.amountSen !== null && e.beforeSen !== e.amountSen) return `Amount ${rm(e.beforeSen)} → ${rm(e.amountSen)}`;
      if (e.beforeSen === null) return "Adjustment posted";
      const moved = accountsMoved(e.legs);
      return moved.length ? `Accounts: ${moved.join(", ")}` : "Same amount and accounts";
    }
    return e.legs.find((l) => l.description)?.description ?? "";
  }
  if (e.source === "audit") {
    const what = e.docType === "trade-finance" ? TF_ACTION_LABEL[e.action ?? ""] : e.docType === "accounting" || e.docType === "finance-settings" ? SETTING_LABEL[e.docId] : undefined;
    const changes = e.kind === "created" || e.kind === "deleted" ? [] : fieldChanges(e.before, e.after, e.docType);
    const fields = changes.slice(0, 3).map((c) => `${c.field}: ${c.before} → ${c.after}`).join("; ");
    const head = what ?? (AUDIT_KIND[e.action ?? ""] || ACTION_LABEL[e.action ?? ""] ? "" : humanize(e.action ?? ""));
    return [head, fields, e.note].filter(Boolean).join(" · ");
  }
  return "";
}

// The accounts whose net (DR − CR) an edit changed, with the change. The
// "before" legs are the old entry REVERSED, so they already carry the minus:
// reversal + re-post summed per account is the change (BUG-2026-10-18-326 —
// they were flipped a second time, doubling every account of the entry).
export function accountsMoved(legs: ChangeLeg[]): string[] {
  const net = new Map<string, number>();
  for (const l of legs) {
    if (!l.side) continue;
    net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + (l.debitSen - l.creditSen));
  }
  return [...net.entries()].filter(([, v]) => v !== 0).map(([code, v]) => `${code} ${v > 0 ? "+" : "−"}${rm(Math.abs(v))}`);
}
