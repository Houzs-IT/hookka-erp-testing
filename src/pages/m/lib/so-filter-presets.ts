// ---------------------------------------------------------------------------
// so-filter-presets.ts — pure logic behind the phone Sales Orders filter sheet
// (owner 2026-10-15, Claude Design `Sales Orders.dc.html` "Filter orders").
// Kept free of React / "@/" imports so the test can load it.
//
// The sheet edits a Draft (what the controls show) and BUILDS the same
// Record<string, ActiveFilter> the shared applyFilters already runs — so the
// list, the badge count, the removable chips and "Show N orders" all use one
// filtering path. Nothing here filters rows itself.
//
//   • Expected DD presets: dates from the PHONE's local today (not UTC — a
//     toISOString date is yesterday before 08:00 in Malaysia). This week =
//     Monday–Sunday; Next 30 days = today + 29 (30 days incl. today);
//     Before today = up to yesterday. Stored as plain from/to dates, so a
//     reopened sheet shows the preset only while its dates still match today.
//   • Amount presets in SEN, non-overlapping: < 1,000,000 · 1,000,000 –
//     5,000,000 inclusive · > 5,000,000. Custom Min/Max are typed in RM and
//     converted to sen here (the shared FilterSheet compares the raw number to
//     sen — BUG-2026-10-15-289; not reused for that reason).
//   • Main status chip vs sheet Status (owner: never conflicting): a single
//     status that has a chip becomes the chip; anything else puts the chip on
//     "All" and keeps a Status filter (shown as a removable chip).
// ---------------------------------------------------------------------------

export type Filter =
  | { type: "text"; contains: string }
  | { type: "number"; op: "eq" | "gt" | "lt" | "gte" | "lte" | "between"; a: number | null; b: number | null }
  | { type: "date"; from: string | null; to: string | null }
  | { type: "enum"; selected: string[] };

export type Col = { key: string; label: string; type: "text" | "number" | "date" | "enum"; options?: string[] };

/** Columns the sheet shows as headline sections; every other column goes under More filters. */
export const STATUS_KEY = "status";
export const EXP_KEY = "expectedDD";
export const AMT_KEY = "amount";

export type ExpPreset = "any" | "week" | "month" | "next30" | "past" | "custom";
export type AmtPreset = "any" | "lt10" | "10to50" | "gt50" | "custom";

export const EXP_PRESETS: { key: ExpPreset; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "next30", label: "Next 30 days" },
  { key: "past", label: "Before today" },
  { key: "custom", label: "Custom" },
];

export const AMT_PRESETS: { key: AmtPreset; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "lt10", label: "Under RM 10k" },
  { key: "10to50", label: "RM 10k – 50k" },
  { key: "gt50", label: "Over RM 50k" },
  { key: "custom", label: "Custom" },
];

const RM_10K = 1_000_000; // sen
const RM_50K = 5_000_000; // sen

// ---- Dates -----------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today as YYYY-MM-DD in the device's local time zone. */
export function localToday(now: Date = new Date()): string {
  return iso(now);
}

function parse(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** from / to for a date preset ("" = open end). null for any / custom. */
export function expPresetRange(p: ExpPreset, today: string): { from: string; to: string } | null {
  const d = parse(today);
  switch (p) {
    case "week": {
      const back = (d.getDay() + 6) % 7; // Monday = 0
      const mon = addDays(today, -back);
      return { from: mon, to: addDays(mon, 6) };
    }
    case "month": {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { from: iso(first), to: iso(last) };
    }
    case "next30":
      return { from: today, to: addDays(today, 29) };
    case "past":
      return { from: "", to: addDays(today, -1) };
    default:
      return null;
  }
}

/** Which preset a stored date filter equals today, else "custom". */
export function detectExpPreset(f: Filter | undefined, today: string): ExpPreset {
  if (!f || f.type !== "date" || (!f.from && !f.to)) return "any";
  for (const p of ["week", "month", "next30", "past"] as const) {
    const r = expPresetRange(p, today)!;
    if ((f.from ?? "") === r.from && (f.to ?? "") === r.to) return p;
  }
  return "custom";
}

// ---- Amounts (sen) ---------------------------------------------------------

export function amtPresetFilter(p: AmtPreset): Filter | null {
  if (p === "lt10") return { type: "number", op: "lt", a: RM_10K, b: null };
  if (p === "10to50") return { type: "number", op: "between", a: RM_10K, b: RM_50K };
  if (p === "gt50") return { type: "number", op: "gt", a: RM_50K, b: null };
  return null;
}

export function detectAmtPreset(f: Filter | undefined): AmtPreset {
  if (!f || f.type !== "number" || f.a == null) return "any";
  for (const p of ["lt10", "10to50", "gt50"] as const) {
    const g = amtPresetFilter(p)! as Extract<Filter, { type: "number" }>;
    if (f.op === g.op && f.a === g.a && (f.b ?? null) === g.b) return p;
  }
  return "custom";
}

/** "1,234.5" / "1234.50" (RM) → integer sen; null when blank or not a number. */
export function rmToSen(s: string): number | null {
  const t = s.replace(/[,\s]/g, "").replace(/^RM/i, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function senToRm(sen: number): string {
  return String(sen / 100);
}

// ---- Min / max ↔ number filter -------------------------------------------

function toNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Inclusive min/max → the existing number filter (≥, ≤ or range). */
export function rangeFilter(min: number | null, max: number | null): Filter | null {
  if (min != null && max != null) return { type: "number", op: "between", a: min, b: max };
  if (min != null) return { type: "number", op: "gte", a: min, b: null };
  if (max != null) return { type: "number", op: "lte", a: max, b: null };
  return null;
}

/** A stored number filter → the Min / Max boxes (inclusive bounds). */
function rangeOf(f: Filter | undefined): { min: number | null; max: number | null } {
  if (!f || f.type !== "number" || f.a == null) return { min: null, max: null };
  switch (f.op) {
    case "between":
      return f.b == null ? { min: f.a, max: null } : { min: Math.min(f.a, f.b), max: Math.max(f.a, f.b) };
    case "gte":
    case "gt":
      return { min: f.a, max: null };
    case "lte":
    case "lt":
      return { min: null, max: f.a };
    default:
      return { min: f.a, max: f.a };
  }
}

// ---- Draft ------------------------------------------------------------------

export type Draft = {
  status: string[];
  exp: { preset: ExpPreset; from: string; to: string };
  amt: { preset: AmtPreset; min: string; max: string };
  text: Record<string, string>;
  dates: Record<string, { from: string; to: string }>;
  nums: Record<string, { min: string; max: string }>;
};

/** Seed the sheet from the applied filters + the main chip (chip shows as a selected status). */
export function seedDraft(
  filters: Record<string, Filter>,
  chip: string,
  columns: Col[],
  today: string,
): Draft {
  const st = filters[STATUS_KEY];
  const status = st?.type === "enum" && st.selected.length ? [...st.selected] : chip !== "all" ? [chip] : [];
  const ef = filters[EXP_KEY];
  const expPreset = detectExpPreset(ef, today);
  const af = filters[AMT_KEY];
  const amtPreset = detectAmtPreset(af);
  const ar = amtPreset === "custom" ? rangeOf(af) : { min: null, max: null };
  const d: Draft = {
    status,
    exp: {
      preset: expPreset,
      from: expPreset === "custom" && ef?.type === "date" ? ef.from ?? "" : "",
      to: expPreset === "custom" && ef?.type === "date" ? ef.to ?? "" : "",
    },
    amt: {
      preset: amtPreset,
      min: ar.min == null ? "" : senToRm(ar.min),
      max: ar.max == null ? "" : senToRm(ar.max),
    },
    text: {},
    dates: {},
    nums: {},
  };
  for (const c of columns) {
    if (c.key === STATUS_KEY || c.key === EXP_KEY || c.key === AMT_KEY) continue;
    const f = filters[c.key];
    if (c.type === "text") d.text[c.key] = f?.type === "text" ? f.contains : "";
    else if (c.type === "date")
      d.dates[c.key] = { from: f?.type === "date" ? f.from ?? "" : "", to: f?.type === "date" ? f.to ?? "" : "" };
    else if (c.type === "number") {
      const r = rangeOf(f);
      d.nums[c.key] = { min: r.min == null ? "" : String(r.min), max: r.max == null ? "" : String(r.max) };
    }
  }
  return d;
}

/** Draft → the filters applyFilters runs. Status is kept here; see splitStatus. */
export function buildFilters(d: Draft, columns: Col[], today: string): Record<string, Filter> {
  const out: Record<string, Filter> = {};
  const has = (k: string) => columns.some((c) => c.key === k);
  if (has(STATUS_KEY) && d.status.length) out[STATUS_KEY] = { type: "enum", selected: [...d.status] };
  if (has(EXP_KEY)) {
    const r = d.exp.preset === "custom" ? { from: d.exp.from, to: d.exp.to } : expPresetRange(d.exp.preset, today);
    if (r && (r.from || r.to)) out[EXP_KEY] = { type: "date", from: r.from || null, to: r.to || null };
  }
  if (has(AMT_KEY)) {
    const f =
      d.amt.preset === "custom" ? rangeFilter(rmToSen(d.amt.min), rmToSen(d.amt.max)) : amtPresetFilter(d.amt.preset);
    if (f) out[AMT_KEY] = f;
  }
  for (const c of columns) {
    if (c.type === "text") {
      const v = (d.text[c.key] ?? "").trim();
      if (v) out[c.key] = { type: "text", contains: v };
    } else if (c.type === "date" && d.dates[c.key]) {
      const { from, to } = d.dates[c.key];
      if (from || to) out[c.key] = { type: "date", from: from || null, to: to || null };
    } else if (c.type === "number" && d.nums[c.key]) {
      const f = rangeFilter(toNum(d.nums[c.key].min), toNum(d.nums[c.key].max));
      if (f) out[c.key] = f;
    }
  }
  return out;
}

/**
 * Main chip vs sheet Status: one status that has its own chip → that chip, no
 * Status filter; none → "All"; several (or one without a chip) → "All" + the
 * Status filter. So the chip row and the sheet can never say different things.
 */
export function splitStatus(
  filters: Record<string, Filter>,
  chipKeys: string[],
): { chip: string; filters: Record<string, Filter> } {
  const st = filters[STATUS_KEY];
  if (!st || st.type !== "enum" || st.selected.length === 0) {
    const rest = { ...filters };
    delete rest[STATUS_KEY];
    return { chip: "all", filters: rest };
  }
  if (st.selected.length === 1 && chipKeys.includes(st.selected[0])) {
    const rest = { ...filters };
    delete rest[STATUS_KEY];
    return { chip: st.selected[0], filters: rest };
  }
  return { chip: "all", filters };
}

/** Filters active in the More filters section (badge on its row). */
export function moreCount(d: Draft): number {
  let n = 0;
  for (const v of Object.values(d.text)) if (v.trim()) n++;
  for (const v of Object.values(d.dates)) if (v.from || v.to) n++;
  for (const v of Object.values(d.nums)) if (toNum(v.min) != null || toNum(v.max) != null) n++;
  return n;
}
