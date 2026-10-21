// Unified document numbering: <prefix>-<YYMM>-<NNN>. Prefix is per bank
// account + direction (out=payments, in=receipts); YYMM comes from the
// voucher date (back-datable); NNN is a per-(prefix,YYMM) running counter.
// Pure helpers here; the atomic counter lives in the DB (issueDocNumber).

export type DocDirection = "out" | "in";
export type DocPrefixMap = Record<string, { out?: string; in?: string }>;

export const DEFAULT_OUT_PREFIX = "PV";
export const DEFAULT_IN_PREFIX = "OR";

// "2026-06-15" → "2606" (2-digit year + 2-digit month).
export function ymFromDate(dateIso: string): string {
  return dateIso.slice(2, 4) + dateIso.slice(5, 7);
}

// "HPV-2606-001"; pads to 3 digits, grows naturally past 999.
export function formatDocNo(prefix: string, ym: string, n: number): string {
  return `${prefix}-${ym}-${String(n).padStart(3, "0")}`;
}

// The prefix for a bank account + direction; configured value wins, else
// the direction default.
export function resolveDocPrefix(
  cfg: DocPrefixMap,
  bankAccountCode: string,
  direction: DocDirection,
): string {
  const entry = cfg[bankAccountCode];
  const v = entry ? entry[direction] : undefined;
  if (v && v.trim()) return v.trim();
  return direction === "out" ? DEFAULT_OUT_PREFIX : DEFAULT_IN_PREFIX;
}

// ---------------------------------------------------------------------------
// Document Numbering settings (owner 2026-10-20 「可以」: the design's table,
// every document's next number shown; bank prefixes stay per bank; a changed
// prefix applies from the next document).
//
// The documents that number themselves with a fixed prefix — `<prefix>-<YYMM>-
// <NNN>`, restarting each month — and whether Finance may change the prefix.
// The sales invoice is shown, not changed (it is Sales' and the customer's
// reference). Kept in kv `doc_type_prefixes` as { key: prefix }.
// ---------------------------------------------------------------------------
export type DocTypeKey = "JE" | "CN" | "DN" | "PI" | "PCN" | "OCB" | "ODB" | "INV";
export type DocTypePrefixMap = Partial<Record<DocTypeKey, string>>;

export const DOC_TYPES: readonly { key: DocTypeKey; label: string; defaultPrefix: string; digits: number; editable: boolean }[] = [
  { key: "JE", label: "Journal Voucher", defaultPrefix: "JE", digits: 4, editable: true },
  { key: "CN", label: "Credit Note", defaultPrefix: "CN", digits: 3, editable: true },
  { key: "DN", label: "Debit Note", defaultPrefix: "DN", digits: 3, editable: true },
  { key: "PI", label: "AP Invoice (Purchase Invoice)", defaultPrefix: "PI", digits: 3, editable: true },
  { key: "PCN", label: "Supplier Credit Note", defaultPrefix: "PCN", digits: 3, editable: true },
  { key: "OCB", label: "Other Creditor Bill", defaultPrefix: "OCB", digits: 3, editable: true },
  { key: "ODB", label: "Other Debtor Bill", defaultPrefix: "ODB", digits: 3, editable: true },
  { key: "INV", label: "Sales Invoice", defaultPrefix: "INV", digits: 3, editable: false },
];

/** The prefix a document type numbers with: the configured one, else its default. */
export function resolveTypePrefix(cfg: DocTypePrefixMap, key: DocTypeKey): string {
  const t = DOC_TYPES.find((d) => d.key === key);
  const v = t?.editable ? String(cfg[key] ?? "").trim() : "";
  return v || t?.defaultPrefix || key;
}

/** A keyed prefix as it is stored: trimmed, upper-case, a trailing "-" dropped
 *  (the number adds its own). */
export function normalisePrefix(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/-+$/, "");
}

/** Why a prefix cannot be used, or null. Letters and digits, 1–8. */
export function prefixProblem(p: string): string | null {
  if (!p) return "A prefix cannot be empty.";
  if (!/^[A-Z0-9]{1,8}$/.test(p)) return `"${p}" — use 1 to 8 letters or digits.`;
  return null;
}

/** The first clash between a document type's prefix and any other prefix in
 *  use (another type's, or a bank's payment / receipt prefix, incl. the
 *  PV / OR defaults) — two kinds of document must never share a number run.
 *  Banks may share a prefix with each other (a shared payment book). */
export function findPrefixClash(bankCfg: DocPrefixMap, typeCfg: DocTypePrefixMap): string | null {
  const bankPrefixes = new Set<string>([DEFAULT_OUT_PREFIX, DEFAULT_IN_PREFIX]);
  for (const v of Object.values(bankCfg)) {
    if (v?.out?.trim()) bankPrefixes.add(v.out.trim().toUpperCase());
    if (v?.in?.trim()) bankPrefixes.add(v.in.trim().toUpperCase());
  }
  const seen = new Map<string, string>();
  for (const t of DOC_TYPES) {
    const p = resolveTypePrefix(typeCfg, t.key).toUpperCase();
    if (bankPrefixes.has(p)) return `${t.label} cannot use ${p} — a bank's payments or receipts number with it.`;
    const other = seen.get(p);
    if (other) return `${t.label} cannot use ${p} — ${other} already numbers with it.`;
    seen.set(p, t.label);
  }
  return null;
}

/** "2610" for October 2026 in UTC — the month the self-numbering documents
 *  have always taken (the server's clock), kept so no run changes month. */
export function utcYymm(now: Date = new Date()): string {
  return `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The next number after the highest one on file: `<prefix>-<yymm>-` plus the
 *  last suffix + 1, padded. `last` is the highest number with that start, or
 *  null when the month has none. */
export function nextAfter(prefix: string, yymm: string, last: string | null, digits = 3): string {
  const start = `${prefix}-${yymm}-`;
  if (!last) return `${start}${String(1).padStart(digits, "0")}`;
  const seq = parseInt(last.replace(start, ""), 10);
  if (!Number.isFinite(seq)) return `${start}${String(1).padStart(digits, "0")}`;
  return `${start}${String(seq + 1).padStart(digits, "0")}`;
}
