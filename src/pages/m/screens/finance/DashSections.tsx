// ---------------------------------------------------------------------------
// The Finance Dashboard's cards on the phone, as the owner's phone design
// draws them ("Hookka Finance Mobile"; owner 2026-10-20 「手机版的和我之前设计
// 的也有不一样」): one card per section with the chosen month's figure and a
// pill against the forecast; the salary and cost cards add that month's shares
// as one bar and a month-by-month list (tap a month to choose it for every
// card); the cash card opens into its sections. Balance Sheet and Financial
// Ratios (owner 2026-10-19 「要」) follow in the same look. Every figure is
// the desktop's, from the same /api/accounting/dashboard payload and the same
// module (src/lib/finance-dashboard-calc.ts) — the phone has no numbers of
// its own.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  csAmount, csCategories, csForecastAmt, csForecastSales, csLineProdRev, csLineSales, pctOf, salaryCardMonth,
  type DashCalcRow,
} from "@/lib/finance-dashboard-calc";
import { CH, CS_COLOURS, FORECAST_DASH } from "@/lib/finance-chart-look";
import { cfSectionTotals, monthName, rmWhole, shareWidths, smoothPath } from "./m-finance-lib";

/** A dashboard row as the phone reads it (a subset of the endpoint's row). */
export type DashFullRow = DashCalcRow & {
  key: string;
  label: string;
  partial: boolean;
  labourBase?: { headcount: number | null; unitsCompleted: number | null };
  balanceSheet?: { assets: number; liabilities: number; equity: number; currentAssets: number; currentLiabilities: number; inventory: number } | null;
  ratios?: {
    grossMarginPct: number | null; netMarginPct: number | null;
    currentRatio: number | null; quickRatio: number | null;
    debtToAssetPct: number | null; roePct: number | null; roaPct: number | null;
  };
  cashFlow?: { net: number; inflow?: number; outflow?: number; lines?: { label: string; section: string; value: number }[] };
};

// The phone design's ink.
const INK = "#111827";
const TEXT = "#1F2937";
const MUTED = "#6B7280";
const FAINT = "#9CA3AF";
const RED = "#B4452F";
const GREEN = "#2F7A3B";
const pct2 = (v: number | null) => (v === null ? "-" : `${v.toFixed(2)}%`);


// ---- the design's pieces ----------------------------------------------------

/** A card: white, 16px corners, the title with its note on the right. */
export function DashCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E7E0D4", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#1F1D1B" }}>{title}</span>
        {note && <span style={{ fontSize: 11, color: FAINT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** The "Show" picker: the design's field with the phone's own list. */
export function ShowSelect<K extends string>({ caption, label, value, options, onChange }: {
  caption: string;
  label: string;
  value: K;
  options: readonly { key: K; label: string }[];
  onChange: (k: K) => void;
}) {
  const cur = options.find((o) => o.key === value)?.label ?? "";
  return (
    <label style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 44, border: "1px solid #E5E7EB", borderRadius: 10, background: "#F9FAFB", padding: "0 12px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>{caption}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{cur}</span>
      </span>
      <ChevronDown size={16} color={MUTED} />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as K)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
      >
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

export type VsPill = { text: string; good: boolean; forecast: string } | null;

/** The month's figure, a line under it, and the pill against the forecast. */
export function Kpi({ label, value, sub, vs, negative, test }: { label: string; value: string; sub: string; vs: VsPill; negative?: boolean; test?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
        <div data-m-fin={test} style={{ fontSize: 26, fontWeight: 700, color: negative ? RED : INK, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
      </div>
      {vs && (
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div data-m-fin={test ? `${test}-vs` : undefined} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", borderRadius: 9999, padding: "3px 9px", fontSize: 12, fontWeight: 600, background: vs.good ? "#E8F3EC" : "#FBEAE7", color: vs.good ? GREEN : RED, fontVariantNumeric: "tabular-nums" }}>{vs.text}</div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>Forecast {vs.forecast}</div>
        </div>
      )}
    </div>
  );
}

/** The phone design's mini chart: one bar a month (the chosen one full, the
 *  rest faded), the forecast as a smooth red dashed line with hollow dots; a
 *  tap on a month chooses it. Drawn at 298 × 140 and scaled to the card. */
export function MiniBars({ labels, values, forecast, sel, onSel }: {
  labels: string[];
  values: (number | null)[];
  forecast: (number | null)[];
  sel: number;
  onSel: (i: number) => void;
}) {
  const w = 298, h = 140, left = 6, right = 6, top = 14, bottom = 22;
  const pw = w - left - right, ph = h - top - bottom, band = pw / Math.max(1, labels.length);
  const seen = [...values, ...forecast].filter((v): v is number => v !== null && Number.isFinite(v));
  const hi = Math.max(1, ...seen);
  const lo = Math.min(0, ...seen);
  const y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
  const base = y(0);
  const pts = forecast
    .map((v, i) => (v === null ? null : ([left + band * (i + 0.5), y(v)] as const)))
    .filter((p): p is readonly [number, number] => p !== null);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block" }} role="img" aria-label="Last months against the forecast">
      <line x1={left} x2={left + pw} y1={base} y2={base} stroke="#E5E7EB" />
      {labels.map((l, i) => {
        const v = values[i] ?? 0;
        const bw = Math.min(34, band * 0.55);
        const x = left + band * (i + 0.5) - bw / 2;
        const me = i === sel;
        const yTop = Math.min(y(v), base);
        const hgt = Math.abs(base - y(v));
        return (
          <g key={`${l}-${i}`}>
            <rect x={x} y={yTop} width={bw} height={hgt} rx={4} fill={CH.single}
              style={{ y: yTop, height: hgt, opacity: me ? 1 : 0.45, transition: "y .45s ease, height .45s ease, opacity .2s" }} />
            <text x={left + band * (i + 0.5)} y={h - 6} textAnchor="middle" fontSize={11} fontWeight={me ? 700 : 500} fill={me ? INK : MUTED}>{l}</text>
            <rect x={left + band * i} y={0} width={band} height={h} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onSel(i)} />
          </g>
        );
      })}
      {pts.length > 1 && (
        <path d={smoothPath(pts)} fill="none" stroke={CH.fc} strokeWidth={2} strokeDasharray={FORECAST_DASH} strokeLinecap="round" style={{ pointerEvents: "none" }} />
      )}
      {pts.map(([cx, cy], k) => (
        <circle key={k} cx={cx} cy={cy} r={3} fill="#FFFFFF" stroke={CH.fc} strokeWidth={2} style={{ pointerEvents: "none" }} />
      ))}
    </svg>
  );
}

/** The month's shares as one bar (departments / materials, the desktop's band colours). */
export function ShareBar({ values }: { values: (number | null)[] }) {
  const widths = shareWidths(values);
  if (!widths.some((x) => x > 0)) return null;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 9999, overflow: "hidden", gap: 2, background: "#F3F4F6" }}>
      {widths.map((wd, i) => (wd > 0 ? <span key={i} style={{ height: "100%", width: `${wd}%`, background: CS_COLOURS[i % CS_COLOURS.length], transition: "width .4s ease" }} /> : null))}
    </div>
  );
}

export type MonthRow = { key: string; name: string; v: string; p: string; pc: string; fp: string; selected: boolean; onClick: () => void };

const LIST_GRID = "minmax(0,1fr) 84px 56px 56px";

/** One row a month: its total, % of sales (red over plan, green within) and the plan's %. */
export function MonthList({ head, rows }: { head: string; rows: MonthRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 6, padding: "0 0 6px", borderBottom: "1px solid #E7E0D4", fontSize: 10, fontWeight: 600, color: FAINT, textTransform: "uppercase", letterSpacing: ".04em" }}>
        <span>{head}</span><span style={{ textAlign: "right" }}>RM</span><span style={{ textAlign: "right" }}>% sales</span><span style={{ textAlign: "right" }}>Fcst %</span>
      </div>
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={r.onClick}
          style={{
            display: "grid", gridTemplateColumns: LIST_GRID, gap: 6, alignItems: "center", minHeight: 40,
            border: "none", borderBottom: "1px solid #F2EEE6", fontSize: 13, fontWeight: r.selected ? 600 : 400,
            background: r.selected ? "#E9F2F1" : "transparent", margin: "0 -8px", padding: "0 8px", width: "calc(100% + 16px)",
            borderRadius: r.selected ? 8 : 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          <span style={{ textAlign: "right", color: INK, fontVariantNumeric: "tabular-nums" }}>{r.v}</span>
          <span style={{ textAlign: "right", fontSize: 11, color: r.pc, fontVariantNumeric: "tabular-nums" }}>{r.p}</span>
          <span style={{ textAlign: "right", fontSize: 11, color: RED, fontVariantNumeric: "tabular-nums" }}>{r.fp}</span>
        </button>
      ))}
    </div>
  );
}

/** Figure tiles, two to a row. */
export function Tiles({ tiles }: { tiles: { label: string; value: string; col?: string; test?: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {tiles.map((t) => (
        <div key={t.label} style={{ border: "1px solid #EEE9E1", borderRadius: 12, padding: "10px 12px", background: "#FCFBF8" }}>
          <div style={{ fontSize: 11, color: MUTED }}>{t.label}</div>
          <div data-m-fin={t.test} style={{ fontSize: 18, fontWeight: 700, color: t.col ?? INK, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

const Warn = ({ children }: { children: ReactNode }) => <p style={{ margin: 0, fontSize: 11, color: "#9A3A2D", lineHeight: 1.45 }}>{children}</p>;

/** % of sales coloured against the plan's %: red over it, green within, grey with no plan. */
const vsColour = (p: number | null, fp: number | null) => (p === null || fp === null ? MUTED : p > fp ? RED : GREEN);

// ---- the cards ------------------------------------------------------------------

/**
 * Production / Non-Production Salary. A month's total = its departments' sum
 * (salaryCardMonth — production falls back to the P&L labour bucket where a
 * month has no department figure; non-production never borrows), its shares
 * as one bar, a list of the months; production adds headcount and units, RM
 * per head / per unit dividing the P&L labour bucket as the desktop table does.
 */
export function SalaryCard({ title, note, months, sel, onSel, depts, fallbackLabour, denominators, test }: {
  title: string;
  note: string;
  months: DashFullRow[];
  sel: number;
  onSel: (i: number) => void;
  depts: string[];
  fallbackLabour: boolean;
  denominators: boolean;
  test: string;
}) {
  const card = (r: DashFullRow) => {
    const m = salaryCardMonth(r, depts, fallbackLabour ? { amount: r.actual?.labour ?? null, forecast: r.forecast?.labour ?? null } : null);
    const sales = r.actual?.sales ?? null;
    return { m, p: pctOf(m.amount, sales), pp: pctOf(m.amount, r.productionRevenue?.total ?? null), fp: pctOf(m.forecast, r.forecast?.sales ?? null) };
  };
  const last = months[sel];
  const cur = card(last);
  const labour = last.actual?.labour ?? null;
  const per = (base: number | null) => (labour !== null && base !== null && base > 0 ? Math.round(labour / base) : null);
  const head = last.labourBase?.headcount ?? null;
  const units = last.labourBase?.unitsCompleted ?? null;
  const gap = cur.m.amount !== null && cur.m.forecast !== null ? cur.m.amount - cur.m.forecast : null;
  return (
    <DashCard title={title} note={note}>
      <Kpi
        test={test}
        label={monthName(last)}
        value={rmWhole(cur.m.amount)}
        sub={`${pct2(cur.p)} sales · ${pct2(cur.pp)} prod.`}
        vs={gap === null ? null : { text: `${gap > 0 ? "+" : ""}${rmWhole(gap)} vs fcst`, good: gap <= 0, forecast: rmWhole(cur.m.forecast) }}
      />
      <ShareBar values={cur.m.byDept.map((d) => d.amount)} />
      <MonthList
        head="Month total"
        rows={months.map((r, i) => {
          const c = card(r);
          return { key: r.key, name: monthName(r), v: rmWhole(c.m.amount), p: pct2(c.p), pc: vsColour(c.p, c.fp), fp: pct2(c.fp), selected: i === sel, onClick: () => onSel(i) };
        })}
      />
      {denominators && (
        <>
          <Tiles
            tiles={[
              { label: "Headcount", value: head === null ? "-" : String(head), col: CH.teal },
              { label: "RM / head", value: rmWhole(per(head)), col: CH.teal, test: `${test}-perhead` },
              { label: "Units completed", value: units === null ? "-" : units.toLocaleString("en-MY"), col: CH.green },
              { label: "RM / unit", value: rmWhole(per(units)), col: CH.green },
            ]}
          />
          <Warn>⚠ Units completed run high (double-counted batches), so RM / unit runs low. RM / head is unaffected.</Warn>
        </>
      )}
    </DashCard>
  );
}

/**
 * Cost Structure — spend, all lines (the phone design): the month's material
 * total is the sum of every material (the desktop table's TOTAL), its plan the
 * sum of the keyed plans, each % against its own revenue; the materials'
 * shares as one bar; a list of the months.
 */
export function CostStructureCard({ months, sel, onSel }: { months: DashFullRow[]; sel: number; onSel: (i: number) => void }) {
  const cats = csCategories(months);
  const card = (r: DashFullRow) => {
    const amounts = cats.map((cat) => csAmount(r, cat, "spend", "all"));
    const total = amounts.reduce((s, v) => s + v, 0);
    let plan: number | null = null;
    for (const cat of cats) {
      const f = csForecastAmt(r, cat, "all");
      if (f !== null) plan = (plan ?? 0) + f;
    }
    return { amounts, total, plan, p: pctOf(total, csLineSales(r, "all")), pp: pctOf(total, csLineProdRev(r, "all")), fp: pctOf(plan, csForecastSales(r, "all")) };
  };
  const last = months[sel];
  const cur = card(last);
  const gap = cur.plan !== null ? cur.total - cur.plan : null;
  return (
    <DashCard title="Cost Structure" note="Spend · all lines">
      <Kpi
        test="dash-cs"
        label={monthName(last)}
        value={rmWhole(cur.total)}
        sub={`${pct2(cur.p)} sales · ${pct2(cur.pp)} prod.`}
        vs={gap === null ? null : { text: `${gap > 0 ? "+" : ""}${rmWhole(gap)} vs fcst`, good: gap <= 0, forecast: rmWhole(cur.plan) }}
      />
      <ShareBar values={cur.amounts} />
      <MonthList
        head="Month total"
        rows={months.map((r, i) => {
          const c = card(r);
          return { key: r.key, name: monthName(r), v: rmWhole(c.total), p: pct2(c.p), pc: vsColour(c.p, c.fp), fp: pct2(c.fp), selected: i === sel, onClick: () => onSel(i) };
        })}
      />
    </DashCard>
  );
}

/** Cash Flow — the month's net change, money in and out, and its sections
 *  (the desktop's Detail, grouped) behind one tap. */
export function CashFlowCard({ month }: { month: DashFullRow }) {
  const [open, setOpen] = useState(false);
  const cf = month.cashFlow;
  const sections = cfSectionTotals(cf?.lines);
  return (
    <DashCard title="Cash Flow" note={monthName(month)}>
      <Kpi
        test="dash-cf-net"
        label="Net change"
        value={rmWhole(cf?.net ?? null)}
        negative={(cf?.net ?? 0) < 0}
        sub={`In ${rmWhole(cf?.inflow ?? null)} · Out ${rmWhole(cf?.outflow ?? null)}`}
        vs={null}
      />
      {sections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, border: "none", borderRadius: 8, background: "#F9FAFB", padding: "0 8px", fontSize: 13, fontWeight: 600, color: TEXT, cursor: "pointer", fontFamily: "inherit" }}
          >
            {open ? <ChevronDown size={14} color={MUTED} /> : <ChevronRight size={14} color={MUTED} />}
            {open ? "Hide sections" : `Show ${sections.length} sections`}
          </button>
          {open && sections.map((s) => (
            <div key={s.name} data-fin-reveal="" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 40, borderBottom: "1px solid #F2EEE6", fontSize: 13, paddingLeft: 20, animation: "fin-reveal .18s ease-out" }}>
              <span style={{ color: TEXT }}>{s.name}</span>
              <span style={{ color: s.value < 0 ? RED : GREEN, fontVariantNumeric: "tabular-nums" }}>{rmWhole(s.value)}</span>
            </div>
          ))}
        </div>
      )}
    </DashCard>
  );
}

/** Balance Sheet — the month end's totals as tiles. */
export function BalanceSheetCard({ month }: { month: DashFullRow }) {
  const bs = month.balanceSheet ?? null;
  const debt = month.ratios?.debtToAssetPct ?? null;
  return (
    <DashCard title="Balance Sheet" note={`${monthName(month)} · month end`}>
      {!bs ? (
        <div style={{ fontSize: 13, color: MUTED }}>Balances start at the opening date — nothing before it.</div>
      ) : (
        <Tiles
          tiles={[
            { label: "Total assets", value: rmWhole(bs.assets), col: CH.teal, test: "dash-bs-assets" },
            { label: "Total liabilities", value: rmWhole(bs.liabilities), test: "dash-bs-liabilities" },
            { label: "Equity", value: rmWhole(bs.equity), col: bs.equity < 0 ? RED : INK },
            { label: "Debt to assets", value: pct2(debt), col: RED },
          ]}
        />
      )}
    </DashCard>
  );
}

const RATIOS: { key: keyof NonNullable<DashFullRow["ratios"]>; label: string; pct: boolean }[] = [
  { key: "grossMarginPct", label: "Gross margin", pct: true },
  { key: "netMarginPct", label: "Net margin", pct: true },
  { key: "currentRatio", label: "Current ratio", pct: false },
  { key: "quickRatio", label: "Quick ratio", pct: false },
  { key: "roePct", label: "ROE", pct: true },
  { key: "roaPct", label: "ROA", pct: true },
];

/** Financial Ratios — the desktop card's six for the month, as tiles. */
export function RatiosCard({ month }: { month: DashFullRow }) {
  return (
    <DashCard title="Financial Ratios" note={monthName(month)}>
      <Tiles
        tiles={RATIOS.map((r) => {
          const v = month.ratios?.[r.key] ?? null;
          return { label: r.label, value: v === null ? "-" : `${v.toFixed(2)}${r.pct ? "%" : ""}`, col: v !== null && v < 0 ? RED : INK, test: "dash-ratio" };
        })}
      />
    </DashCard>
  );
}

