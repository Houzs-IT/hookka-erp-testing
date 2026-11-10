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
  overHourNonProd: boolean;
};

export type FloorLiveResponse = {
  success: boolean;
  error?: string;
  date?: string;
  asOf?: string;
  departments: { code: string; name: string; isProduction: boolean; sequence: number }[];
  workers: FloorLiveRow[];
};

export const PRODUCTION_ORDER = [
  "FAB_CUT", "WOOD_CUT", "FOAM_CUTTING", "FIBRE",
  "FAB_SEW", "FRAMING", "FOAM", "UPHOLSTERY",
  "PACKING", "WEBBING",
] as const;

export type FloorLiveCard = { code: string; name: string; rows: FloorLiveRow[]; effPct: number | null };

const pct = (earned: number, worked: number) => (worked > 0 ? Math.round((earned / worked) * 100) : null);

/** Problem rows first: red, then lowest efficiency, then by name. */
function rank(r: FloorLiveRow): number {
  if (r.overHourNonProd) return -1;
  return r.effPct == null ? 9999 : r.effPct;
}

export function isIssue(r: FloorLiveRow): boolean {
  return r.overHourNonProd || r.effPct == null || r.effPct > 110 || r.effPct < 80;
}

export function floorLiveLayout(
  data: Pick<FloorLiveResponse, "departments" | "workers">,
  opts: { q?: string; issuesOnly?: boolean } = {},
): {
  production: FloorLiveCard[];
  nonProduction: FloorLiveCard[];
  totals: { punched: number; stillIn: number; done: number; effPct: number | null; overHour: number };
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
      effPct: pct(all.reduce((s, r) => s + r.earnedMinutes, 0), all.reduce((s, r) => s + r.workingMinutes, 0)),
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
      effPct: pct(w.reduce((s, r) => s + r.earnedMinutes, 0), w.reduce((s, r) => s + r.workingMinutes, 0)),
      overHour: w.filter((r) => r.overHourNonProd).length,
    },
  };
}
