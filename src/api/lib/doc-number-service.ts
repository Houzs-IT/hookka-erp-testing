import type { Env } from "../worker";
import { DOC_TYPES, formatDocNo, nextAfter, resolveTypePrefix, utcYymm, ymFromDate, resolveDocPrefix } from "../../lib/doc-number";
import type { DocDirection, DocPrefixMap, DocTypeKey, DocTypePrefixMap } from "../../lib/doc-number";

/** The prefixes Finance set per document type (kv `doc_type_prefixes`). */
export async function getDocTypePrefixes(db: Env["Variables"]["DB"]): Promise<DocTypePrefixMap> {
  try {
    const row = await db.prepare("SELECT value FROM kv_config WHERE key = 'doc_type_prefixes'").first<{ value: string | null }>();
    if (row?.value) return JSON.parse(row.value) as DocTypePrefixMap;
  } catch { /* absent → defaults */ }
  return {};
}

/** The prefix a document type numbers with today. */
export async function docTypePrefix(db: Env["Variables"]["DB"], key: DocTypeKey): Promise<string> {
  return resolveTypePrefix(await getDocTypePrefixes(db), key);
}

// Where each self-numbering document keeps its number. The journal counts
// its month's entries (it has always done so); the others take the highest
// number + 1. OCB / ODB run on doc_no_counters like the vouchers.
const SELF_NUMBERED: Partial<Record<DocTypeKey, { table: string; column: string; count?: boolean }>> = {
  JE: { table: "journal_entries", column: "entryNo", count: true },
  CN: { table: "credit_notes", column: "noteNumber" },
  DN: { table: "debit_notes", column: "noteNumber" },
  PI: { table: "purchase_invoices", column: "piNo" },
  PCN: { table: "purchase_credit_notes", column: "noteNumber" },
  INV: { table: "invoices", column: "invoiceNo" },
};

/** The next number of a self-numbering document — the one place every
 *  generator (invoice, notes, PI, supplier CN, journal) gets it from, and the
 *  Settings preview with it. */
export async function nextSelfNumber(
  db: Env["Variables"]["DB"],
  key: DocTypeKey,
  opts: { yymm?: string } = {},
): Promise<string> {
  const t = SELF_NUMBERED[key];
  if (!t) throw new Error(`${key} is not self-numbered`);
  const prefix = await docTypePrefix(db, key);
  const yymm = opts.yymm ?? utcYymm();
  const digits = DOC_TYPES.find((d) => d.key === key)?.digits ?? 3;
  const like = `${prefix}-${yymm}-%`;
  if (t.count) {
    const res = await db.prepare(`SELECT COUNT(*) AS c FROM ${t.table} WHERE ${t.column} LIKE ?`).bind(like).first<{ c: number }>();
    return `${prefix}-${yymm}-${String(Number(res?.c ?? 0) + 1).padStart(digits, "0")}`;
  }
  const res = await db
    .prepare(`SELECT ${t.column} AS seqno FROM ${t.table} WHERE ${t.column} LIKE ? ORDER BY ${t.column} DESC LIMIT 1`)
    .bind(like)
    .first<{ seqno: string }>();
  return nextAfter(prefix, yymm, res?.seqno ? String(res.seqno) : null, digits);
}

/** The Settings preview: this month's voucher counters (Malaysia month — a
 *  voucher dated today) and every document type's next number. Reads only. */
export async function docNumberPreview(db: Env["Variables"]["DB"]) {
  const ym = ymFromDate(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const counters: Record<string, number> = {};
  try {
    const res = await db.prepare("SELECT prefix, next_no FROM doc_no_counters WHERE ym = ?").bind(ym).all<{ prefix: string; next_no?: number; nextNo?: number }>();
    for (const r of res.results ?? []) counters[String(r.prefix)] = Number(r.next_no ?? r.nextNo ?? 1);
  } catch { /* no counters yet */ }
  const cfg = await getDocTypePrefixes(db);
  const types = await Promise.all(
    DOC_TYPES.map(async (t) => {
      const prefix = resolveTypePrefix(cfg, t.key);
      const next = SELF_NUMBERED[t.key]
        ? await nextSelfNumber(db, t.key)
        : formatDocNo(prefix, ym, counters[prefix] ?? 1);
      return { key: t.key, label: t.label, prefix, editable: t.editable, next };
    }),
  );
  return { ym, counters, types };
}

export async function getDocNumberPrefixes(db: Env["Variables"]["DB"]): Promise<DocPrefixMap> {
  try {
    const row = await db.prepare("SELECT value FROM kv_config WHERE key = 'doc_number_prefixes'").first<{ value: string | null }>();
    if (row?.value) return JSON.parse(row.value) as DocPrefixMap;
  } catch { /* absent → empty */ }
  return {};
}

export async function issueDocNumber(
  db: Env["Variables"]["DB"],
  opts: { bankAccountCode: string; direction: DocDirection; dateIso: string },
): Promise<string> {
  const cfg = await getDocNumberPrefixes(db);
  const prefix = resolveDocPrefix(cfg, opts.bankAccountCode, opts.direction);
  const ym = ymFromDate(opts.dateIso);
  const row = await db
    .prepare(
      `INSERT INTO doc_no_counters (prefix, ym, next_no) VALUES (?, ?, 2)
       ON CONFLICT (prefix, ym) DO UPDATE SET next_no = doc_no_counters.next_no + 1
       RETURNING next_no`,
    )
    .bind(prefix, ym)
    .first<{ next_no?: number; nextNo?: number }>();
  const newNext = Number(row?.next_no ?? row?.nextNo ?? 2);
  return formatDocNo(prefix, ym, newNext - 1);
}

/**
 * Like issueDocNumber but the caller supplies the prefix directly (no
 * bank-account resolution). Used by features with a fixed prefix per
 * document kind, e.g. Other Party Bills: OCB (creditor) / ODB (debtor).
 * Same atomic counter on doc_no_counters(prefix, ym).
 */
export async function issueDocNumberWithPrefix(
  db: Env["Variables"]["DB"],
  prefix: string,
  dateIso: string,
): Promise<string> {
  const ym = ymFromDate(dateIso);
  const row = await db
    .prepare(
      `INSERT INTO doc_no_counters (prefix, ym, next_no) VALUES (?, ?, 2)
       ON CONFLICT (prefix, ym) DO UPDATE SET next_no = doc_no_counters.next_no + 1
       RETURNING next_no`,
    )
    .bind(prefix, ym)
    .first<{ next_no?: number; nextNo?: number }>();
  const newNext = Number(row?.next_no ?? row?.nextNo ?? 2);
  return formatDocNo(prefix, ym, newNext - 1);
}
