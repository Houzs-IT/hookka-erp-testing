// ---------------------------------------------------------------------------
// The Finance / Receivable kit's plain values (Batch 3): the prototype's
// palette, money / percent / date formatting and the tile / amount / bar
// shape helpers. Kept apart from fin-kit.tsx so that file exports components
// only (react-refresh). Formatting only: no figure is computed here.
// ---------------------------------------------------------------------------
// ---- palette (the prototype's) ------------------------------------------------
export const F = {
  ink: "#1F1D1B",
  neg: "#9A3A2D",
  pos: "#4F7C3A",
  gold: "#6B5C32",
  goldMid: "#8B7A4E",
  goldLight: "#A08C5B",
  sand: "#CDBE98",
  paper: "#FAF8F4",
  cream: "#F4EFE6",
  track: "#F0ECE9",
  body: "#4D4630",
  muted: "#6B6358",
  faint: "#9A9082",
  chev: "#B5AC9C",
  hair: "#EEE9E4",
  line: "#E6E0D9",
  amber: "#9C6F1E",
  teal: "#3E6570",
  grad: "linear-gradient(135deg,#8B7A4E,#6B5C32)",
} as const;

/** The prototype's aging bucket colours, Current → 3+ months. */
export const AGE_COLOURS = ["#8A8F98", "#6B7280", "#9C6F1E", "#B8601A", "#9A3A2D"] as const;

// ---- money / percent, as the prototype prints them ---------------------------
/** "RM 1,234.56" / "−RM 1,234.56"; null → "—". */
export function rm(sen: number | null | undefined): string {
  if (sen == null || !Number.isFinite(sen)) return "—";
  const t = "RM " + (Math.abs(sen) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sen < 0 ? "−" + t : t;
}
/** Short money for bar labels: "1.23M" / "845.2k" / "120" (no "RM"). */
export function rmShort(sen: number | null | undefined): string {
  if (sen == null || !Number.isFinite(sen)) return "—";
  const n = Math.abs(sen) / 100;
  const t = n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : n.toFixed(0);
  return sen < 0 ? "−" + t : t;
}
/** "12.3%" of a base; "—" with no base. */
export const pctOf = (a: number | null | undefined, b: number | null | undefined): string =>
  a == null || !b ? "—" : ((a / b) * 100).toFixed(1) + "%";
/** The value colour: grey for nothing, red when negative, ink otherwise. */
export const valColour = (sen: number | null | undefined): string => (sen == null ? F.faint : sen < 0 ? F.neg : F.ink);

export type Tile = { k: string; v: string; c?: string; s?: string; sc?: string; dot?: string; tint?: string; rail?: string; ring?: string; span?: 2; onTap?: () => void; on?: boolean };
/** A tile with the prototype's defaults filled in. */
export const tile = (k: string, v: string, o: Omit<Tile, "k" | "v"> = {}): Tile => ({ k, v, ...o });

/** Bar heights for a series, as the prototype scales them: the largest |value|
 *  (actual or forecast) is `full`% tall, a bar is at least 4%; the forecast
 *  tick sits at forecast/actual of the bar (null with no forecast). */
export function barGeometry(values: (number | null)[], forecast: (number | null)[] | null, full = 82): { h: number; fh: number | null }[] {
  const all = [...values, ...(forecast ?? [])].filter((v): v is number => v != null && Number.isFinite(v)).map(Math.abs);
  const mx = Math.max(1, ...all);
  return values.map((v, i) => {
    const a = Math.abs(v ?? 0);
    const f = forecast ? forecast[i] : null;
    return { h: Math.max(4, (a / mx) * full), fh: f == null ? null : (Math.abs(f) / Math.max(1, a)) * 100 };
  });
}

export type DocAmt = { k: string; v: string; gold?: boolean; c?: string; kc?: string; fs?: number };

export const docAmt = (k: string, v: string, o: Omit<DocAmt, "k" | "v"> = {}): DocAmt => ({ k, v, ...o });

// ---- dates -------------------------------------------------------------------------------------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-24" → "24 Nov"; with year → "24 Nov 2026"; anything else as it came. */
export function dayMon(iso: string | null | undefined, year = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "") || "—";
  return `${m[3]} ${MON[+m[2] - 1]}${year ? ` ${m[1]}` : ""}`;
}
/** "2026-11" → "Nov 2026". */
export function monYear(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  return m ? `${MON[+m[2] - 1]} ${m[1]}` : ym;
}
