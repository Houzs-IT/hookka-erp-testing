// attendance-location.ts — where a punch happened, judged the way desktop does (HK-0125 Phase 2).
//
// Desktop has no stored "off-site" field: employees.tsx (ATT_FENCE / attMetersFromFactory / attPunchLoc, AttendanceTab)
// compares each punch's GPS with a fixed factory point, soft only. This is a copy of that rule (the page keeps it inside
// a 12k-line component, so it cannot be imported); tests/m-employees-attendance.test.mjs pins the constants to the desktop
// source and checks the maths with worked distances.
//
// ONE row rule drives the row badge, the chip counts and the filtered list (owner 2026-11-16): a row is Off-site when
// EITHER punch is outside the fence. (Desktop's row badge uses the in-punch only, while its header count uses either
// punch; mobile uses the count's rule everywhere so a chip and its list can never disagree.)

export const ATT_FENCE = { lat: 3.187681, lng: 101.570928, radiusM: 200 } as const;

export function metersFromFactory(lat: number, lng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(ATT_FENCE.lat - lat);
  const dLng = toRad(ATT_FENCE.lng - lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(ATT_FENCE.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PunchLoc = "in" | "out" | "none";

/** One punch: inside the fence, outside it, or no usable coordinates. */
export function punchLoc(lat: unknown, lng: unknown): PunchLoc {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "none";
  }
  return metersFromFactory(lat, lng) <= ATT_FENCE.radiusM ? "in" : "out";
}

export type RowLoc = "factory" | "offsite" | "nogps";
export type LocFilter = "all" | RowLoc;

export type LocPunch = {
  clockInLat?: number | null;
  clockInLng?: number | null;
  clockOutLat?: number | null;
  clockOutLng?: number | null;
};

/** Off-site if either punch is outside; else At factory if any punch is inside; else No GPS. */
export function rowLocation(r: LocPunch): RowLoc {
  const a = punchLoc(r.clockInLat, r.clockInLng);
  const b = punchLoc(r.clockOutLat, r.clockOutLng);
  if (a === "out" || b === "out") return "offsite";
  if (a === "in" || b === "in") return "factory";
  return "nogps";
}

/** One punch, in words (the detail card shows the clock-in and clock-out separately). */
export const PUNCH_LABEL: Record<PunchLoc, string> = { in: "At factory", out: "Off-site", none: "No GPS" };

/** Distance of the farthest punch with usable GPS, in metres; null when there is none. */
export function rowFarthestMeters(r: LocPunch): number | null {
  const ms: number[] = [];
  if (punchLoc(r.clockInLat, r.clockInLng) !== "none") ms.push(metersFromFactory(r.clockInLat as number, r.clockInLng as number));
  if (punchLoc(r.clockOutLat, r.clockOutLng) !== "none") ms.push(metersFromFactory(r.clockOutLat as number, r.clockOutLng as number));
  return ms.length ? Math.max(...ms) : null;
}

/** The clock time of the punch that put the row Off-site (the in-punch if it is outside the fence, else the out-punch). */
export function offsitePunchTime(r: LocPunch & { clockIn?: string | null; clockOut?: string | null }): string | null {
  return punchLoc(r.clockInLat, r.clockInLng) === "out" ? (r.clockIn ?? null) : (r.clockOut ?? null);
}

/** 38 → "38 m"; 1380 → "1.4 km". */
export function fmtDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * The detail card's "Distance" row, from the punch's real GPS (the same fence maths as the badge; no new data):
 * Off-site → the farthest punch, "1.4 km from factory"; At factory → "38 m"; no usable coordinates → "No GPS reading".
 */
export function rowDistance(r: LocPunch): string {
  const ms: number[] = [];
  if (punchLoc(r.clockInLat, r.clockInLng) !== "none") ms.push(metersFromFactory(r.clockInLat as number, r.clockInLng as number));
  if (punchLoc(r.clockOutLat, r.clockOutLng) !== "none") ms.push(metersFromFactory(r.clockOutLat as number, r.clockOutLng as number));
  if (ms.length === 0) return "No GPS reading";
  const far = Math.max(...ms);
  return rowLocation(r) === "offsite" ? `${fmtDistance(far)} from factory` : fmtDistance(far);
}

export const LOC_LABEL: Record<RowLoc, string> = {
  factory: "At factory",
  offsite: "Off-site",
  nogps: "No GPS",
};

export type LocCounts = Record<LocFilter, number>;

export function locCounts<T extends LocPunch>(rows: readonly T[]): LocCounts {
  const out: LocCounts = { all: rows.length, factory: 0, offsite: 0, nogps: 0 };
  for (const r of rows) out[rowLocation(r)] += 1;
  return out;
}

export function filterByLoc<T extends LocPunch>(rows: readonly T[], filter: LocFilter): T[] {
  return filter === "all" ? [...rows] : rows.filter((r) => rowLocation(r) === filter);
}

export function parseLocFilter(raw: string | null | undefined): LocFilter {
  return raw === "factory" || raw === "offsite" || raw === "nogps" ? raw : "all";
}
