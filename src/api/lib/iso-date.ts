// Coerce a date string to ISO YYYY-MM-DD, or null. Malaysian paper is
// day-first (03/06/2026 = 3 June). Never guesses: impossible dates -> null.
export function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s)))
    [d, m, y] = [+r[1], +r[2], r[3].length === 2 ? 2000 + +r[3] : +r[3]];
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

// Writes must not blank a date they cannot read. For each field present and
// non-empty on `body`: parse it and rewrite it to ISO in place; return an error
// message for the first one that does not parse (caller answers 400), else null.
// Empty / absent / null are left alone (a legitimate clear / not supplied).
export function normaliseBodyDates(body: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = body[f];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
    const iso = toIsoDate(v);
    if (!iso) {
      return `${f} "${String(v)}" is not a valid date. Use DD/MM/YYYY (day first) or YYYY-MM-DD.`;
    }
    body[f] = iso;
  }
  return null;
}
