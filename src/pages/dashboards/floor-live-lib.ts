// Floor Live layout (owner 2026-11-10). Pure — node --test imports it.
//
// Production cards in the owner's order, four per row:
//   Fab Cut, Wood Cut, Foam Cut, Fibre / Fab Sew, Framing, Foam Bonding,
//   Upholstery / Packing, Webbing.
// Any other production department the server sends follows, by its sequence.
// Non-production departments come in the server's order (Production
// Shortfall is already dropped server-side).

export type FloorLiveRow = {
  id: string;
  name: string;
  homeDept: string;
  dept: string;
  isProduction: boolean;
  clockIn: string | null;
  clockOut: string | null;
  scannedAt: string | null;
  done: number;
  workingMinutes: number;
  earnedMinutes: number;
  effPct: number | null;
  /** Helper / 杂工 (owner 2026-11-11): "—", Helper tag, never an issue. */
  isHelper?: boolean;
  overHourNonProd: boolean;
};

export type FloorLiveResponse = {
  success: boolean;
  error?: string;
  date?: string;
  asOf?: string;
  live?: boolean;
  /** A past day read from its saved snapshot. */
  frozen?: boolean;
  departments: { code: string; name: string; isProduction: boolean; sequence: number }[];
  workers: FloorLiveRow[];
};

export const PRODUCTION_ORDER = [
  "FAB_CUT", "WOOD_CUT", "FOAM_CUTTING", "FIBRE",
  "FAB_SEW", "FRAMING", "FOAM", "UPHOLSTERY",
  "PACKING", "WEBBING",
] as const;

export type FloorLiveCard = {
  code: string;
  name: string;
  rows: FloorLiveRow[];
  /** Production efficiency — helpers left out (owner 2026-11-11). */
  effPct: number | null;
  /** Everyone incl. helpers, and the helpers' minutes — the small "Overall" line. */
  overallPct: number | null;
  helperMinutes: number;
};

/** Production efficiency (helpers out), Overall (helpers in), helper minutes. */
function poolOf(rows: readonly FloorLiveRow[]) {
  let e = 0, w = 0, he = 0, hw = 0;
  for (const r of rows) {
    e += r.earnedMinutes;
    w += r.workingMinutes;
    if (r.isHelper) { he += r.earnedMinutes; hw += r.workingMinutes; }
  }
  return { effPct: pct(e - he, w - hw), overallPct: pct(e, w), helperMinutes: hw };
}

const pct = (earned: number, worked: number) => (worked > 0 ? Math.round((earned / worked) * 100) : null);

/** Problem rows first: red, then lowest efficiency, then by name. */
function rank(r: FloorLiveRow): number {
  if (r.overHourNonProd) return -1;
  if (r.isHelper) return 10000; // after everyone measured
  return r.effPct == null ? 9999 : r.effPct;
}

export function isIssue(r: FloorLiveRow): boolean {
  // Owner 2026-11-10: only the non-production hour and low efficiency are issues.
  // A helper has no personal efficiency, so a "—" is not a problem for them.
  return r.overHourNonProd || (!r.isHelper && (r.effPct == null || r.effPct < 80));
}

export function floorLiveLayout(
  data: Pick<FloorLiveResponse, "departments" | "workers">,
  opts: { q?: string; issuesOnly?: boolean } = {},
): {
  production: FloorLiveCard[];
  nonProduction: FloorLiveCard[];
  totals: { punched: number; stillIn: number; done: number; effPct: number | null; overallPct: number | null; helperMinutes: number; overHour: number };
} {
  const words = (opts.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (r: FloorLiveRow) =>
    (!words.length || words.every((w) => r.name.toLowerCase().includes(w))) && (!opts.issuesOnly || isIssue(r));

  const card = (code: string, name: string): FloorLiveCard => {
    const all = data.workers.filter((w) => w.dept === code);
    const rows = all.filter(keep).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return {
      code,
      name,
      rows,
      ...poolOf(all),
    };
  };

  const prodDepts = data.departments.filter((d) => d.isProduction);
  const orderIdx = (code: string) => {
    const i = (PRODUCTION_ORDER as readonly string[]).indexOf(code);
    return i === -1 ? PRODUCTION_ORDER.length : i;
  };
  const production = [...prodDepts]
    .sort((a, b) => orderIdx(a.code) - orderIdx(b.code) || a.sequence - b.sequence)
    .map((d) => card(d.code, d.name));
  const nonProduction = data.departments.filter((d) => !d.isProduction).map((d) => card(d.code, d.name));

  // A filter hides empty cards; with no filter every department shows.
  const filtering = words.length > 0 || !!opts.issuesOnly;
  const w = data.workers;
  return {
    production: filtering ? production.filter((c) => c.rows.length) : production,
    nonProduction: filtering ? nonProduction.filter((c) => c.rows.length) : nonProduction,
    totals: {
      punched: w.length,
      stillIn: w.filter((r) => !r.clockOut).length,
      done: w.reduce((s, r) => s + r.done, 0),
      ...poolOf(w),
      overHour: w.filter((r) => r.overHourNonProd).length,
    },
  };
}

// ---- Month / Quarter / Year summary (owner 2026-11-10) --------------------
export type FloorSummaryRow = {
  id: string;
  name: string;
  homeDept: string;
  days: number;
  done: number;
  workingMinutes: number;
  earnedMinutes: number;
  effPct: number | null;
  isHelper?: boolean;
  nonProdMinutes: number;
  overHourDays: number;
};
export type FloorSummaryResponse = {
  success: boolean;
  error?: string;
  from?: string;
  to?: string;
  savedDays: string[];
  departments: { code: string; name: string; isProduction: boolean; sequence: number }[];
  rows: FloorSummaryRow[];
};

/** The date window a dashboard period covers, capped at today. */
export function periodRange(
  p: { mode: string; month: string; from?: string; to?: string },
  today: string,
): { from: string; to: string } {
  let from: string;
  let to: string;
  if (p.mode === "range" && p.from && p.to) {
    from = p.from;
    to = p.to;
  } else if (p.mode === "ytd") {
    const y = (p.month || today).slice(0, 4);
    from = `${y}-01-01`;
    to = `${y}-12-31`;
  } else {
    const m = p.month || today.slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    from = `${m}-01`;
    to = `${m}-${String(last).padStart(2, "0")}`;
  }
  return { from, to: to > today ? today : to };
}

/** Problem first: most days over an hour in non-production, then lowest efficiency. */
export function summaryLayout(
  data: Pick<FloorSummaryResponse, "departments" | "rows">,
  q = "",
): { code: string; name: string; isProduction: boolean; rows: FloorSummaryRow[] }[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (r: FloorSummaryRow) => !words.length || words.every((w) => r.name.toLowerCase().includes(w));
  const orderIdx = (code: string) => {
    const i = (PRODUCTION_ORDER as readonly string[]).indexOf(code);
    return i === -1 ? PRODUCTION_ORDER.length : i;
  };
  const depts = [...data.departments].sort(
    (a, b) => Number(b.isProduction) - Number(a.isProduction) || orderIdx(a.code) - orderIdx(b.code) || a.sequence - b.sequence,
  );
  return depts
    .map((d) => ({
      code: d.code,
      name: d.name,
      isProduction: d.isProduction,
      rows: data.rows
        .filter((r) => r.homeDept === d.code && keep(r))
        .sort((a, b) => b.overHourDays - a.overHourDays || (a.effPct ?? 9999) - (b.effPct ?? 9999) || a.name.localeCompare(b.name)),
    }))
    .filter((d) => d.rows.length > 0);
}
