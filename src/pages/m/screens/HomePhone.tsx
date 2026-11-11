// ===========================================================================
// HomePhone — the PHONE presentation of the /m Home (owner 2026-10-15).
//
// Visual source: Claude Design `Home.dc.html` + design_handoff_home_mobile
// README (borderless cards with the prototype's shadows, gradient KPI hero,
// tinted icon tiles, Orders-due snap carousel). Typography follows the repo
// Home (owner decision 8): every size/weight here is one Home.tsx already used.
//
// Pure presentation. Every figure, label source, route and click handler is
// computed in Home.tsx and passed in; nothing here fetches, filters or does
// business maths. Tablets never render these (Home.tsx branches on isPhone).
// Shared components (MobileHeader, SegmentedSwitch, InstallAppCard,
// BottomTabBar, GlobalSearchSheet) are not restyled (owner decision 4).
// ===========================================================================
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BedDouble,
  Calendar,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Package,
  ShoppingBag,
  Sofa,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SO_STATUS_COLOR, type SemanticStyle } from "@/lib/design-tokens";
import { formatCurrency } from "@/lib/utils";
import { MobileCard } from "../components";
import { M, titleCaseStatus } from "../theme";

// ---- Prototype shadows (Home.dc.html, kept per owner) ----
export const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 30px -14px rgba(31,29,27,.24)";
export const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
export const SHADOW_HEADER_BTN = "0 1px 2px rgba(31,29,27,.06),0 6px 16px -8px rgba(31,29,27,.22)";
const SHADOW_QUICK = "0 1px 2px rgba(31,29,27,.05),0 8px 20px -10px rgba(31,29,27,.22)";
const SHADOW_ORDER = "0 1px 2px rgba(31,29,27,.05),0 12px 26px -14px rgba(31,29,27,.24)";
const SHADOW_HERO = "0 16px 32px -18px rgba(107,92,50,.75),inset 0 1px 0 rgba(255,255,255,.14)";
const SHADOW_THUMB = "0 1px 2px rgba(31,29,27,.08),0 4px 10px -4px rgba(31,29,27,.18)";
const SHADOW_LIST = "0 1px 2px rgba(31,29,27,.05),0 10px 28px -12px rgba(31,29,27,.20)";
const HERO_BG = "linear-gradient(140deg,#8B7A4E 0%,#6B5C32 62%)";

// ---- Hookka palette (README "Colours") — fills, bars, tints ----
const TAUPE = "#6B5C32";
const BRONZE = "#8B7A4E";
const MOSS = "#4F7C3A";
const OCHRE = "#9C6F1E";
const RED = "#9A3A2D";
const TEAL = "#3E6570";
const PLUM = "#6B4A6D";
// Status TEXT uses the Mobile UI Foundation roles: 4.5:1 in light AND dark.
const TEXT_SUCCESS = "var(--m-text-status-success)";
const TEXT_WARNING = "var(--m-text-status-warning)";
const TEXT_DANGER = "var(--m-text-status-danger)";
// Repo small-caps label colour (Home.tsx "DAILY REPORT", "TOP SUPPLIERS").
const LABEL = "#A89F8D";

/** `#RRGGBB` → translucent tint; reads on both the light and dark card. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Borderless prototype card on the shared MobileCard (keyboard handling). */
function PCard({
  children,
  style,
  padded = true,
  onClick,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
  padded?: boolean;
  onClick?: () => void;
}) {
  return (
    <MobileCard
      radius={18}
      padded={padded}
      onClick={onClick}
      style={{ border: "none", boxShadow: SHADOW_CARD, ...style }}
    >
      {children}
    </MobileCard>
  );
}

function CardTitle({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin }}>{title}</div>
      {sub ? <div style={{ fontSize: 11, color: M.muted, marginTop: 2 }}>{sub}</div> : null}
    </>
  );
}

function StateRow({ text }: { text: string }) {
  return (
    <div role="status" style={{ padding: "20px 14px", textAlign: "center", color: M.muted, fontSize: 13 }}>
      {text}
    </div>
  );
}

function RankBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: M.paper,
        fontSize: 10.5,
        fontWeight: 700,
        color: M.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {n}
    </span>
  );
}

/** Fetch state of a section: still loading, failed with no data, or ready. */
export type LoadState = "loading" | "error" | "ready";

// ---------------------------------------------------------------------------
// Section heading (Orders due, Production, Stock alerts, Purchasing)
// ---------------------------------------------------------------------------
export function PhoneSectionHeading({
  icon: Icon,
  title,
  right,
  margin = "28px 2px 12px",
}: {
  icon: LucideIcon;
  title: string;
  right?: ReactNode;
  margin?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, margin: 0, fontSize: 16, lineHeight: 1.25 }}>
        <Icon size={16} strokeWidth={1.9} color={M.taupe} aria-hidden />
        <span style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>{title}</span>
      </h2>
      {right ?? null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header pieces (period pill + period list in the Home-local sheet)
// ---------------------------------------------------------------------------
export function PhonePeriodPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Pick analytics period, ${label}`}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flex: "none",
        height: 36,
        padding: "0 12px 0 11px",
        borderRadius: 999,
        backgroundColor: M.card,
        border: "none",
        boxShadow: SHADOW_CONTROL,
        fontSize: 12,
        fontWeight: 700,
        color: M.taupe,
        cursor: "pointer",
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <CalendarDays size={15} strokeWidth={1.9} color={M.taupe} aria-hidden />
      {label}
      <ChevronDown size={14} strokeWidth={2} color={BRONZE} aria-hidden />
    </button>
  );
}

export function PhonePeriodList({
  options,
  value,
  onPick,
}: {
  options: { ym: string; label: string }[];
  value: string;
  onPick: (ym: string) => void;
}) {
  return (
    <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SHADOW_LIST }}>
      {options.map((opt, i) => {
        const active = opt.ym === value;
        return (
          <button
            key={opt.ym}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(opt.ym)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: 46,
              padding: "0 16px",
              border: "none",
              borderTop: i === 0 ? "none" : `1px solid ${M.divider}`,
              background: active ? M.paper : M.card,
              cursor: "pointer",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: active ? 700 : 500, color: active ? M.taupe : M.raisin }}>
              {opt.label}
            </span>
            <Check size={17} strokeWidth={2} color={M.taupe} style={{ opacity: active ? 1 : 0 }} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI hero (Operations: Pending Delivery + Outstanding; Performance: Sales +
// Invoices). Money is never ellipsed: if either value does not fit beside the
// other at the current width, the two cells stack.
// ---------------------------------------------------------------------------
export type HeroCell = {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Muted line under the label, e.g. the past-month "as of" tag. */
  note?: string;
  delta?: { text: string; good: boolean } | null;
};

export function PhoneHero({
  eyebrow,
  periodText,
  cells,
  width,
}: {
  eyebrow: string;
  periodText: string;
  cells: HeroCell[];
  /** Measured content width; a change re-checks whether the values fit. */
  width: number;
}) {
  // Measure pass: render side by side, check each value for overflow before
  // paint, then keep side-by-side or stack. Re-measured whenever a value or
  // the width changes, so it never sticks to a stale decision.
  const key = `${cells.map((c) => c.value).join("|")}@${width}`;
  const [fit, setFit] = useState<{ key: string; stacked: boolean }>({ key: "", stacked: false });
  const measuring = fit.key !== key;
  const stacked = !measuring && fit.stacked;
  const valueRefs = useRef<(HTMLDivElement | null)[]>([]);
  useLayoutEffect(() => {
    if (!measuring) return;
    const over = valueRefs.current.some((el) => el != null && el.scrollWidth > el.clientWidth + 1);
    setFit({ key, stacked: over });
  }, [measuring, key]);

  return (
    <section
      aria-label={`${eyebrow.charAt(0)}${eyebrow.slice(1).toLowerCase()} figures, ${periodText}`}
      style={{
        marginTop: 16,
        borderRadius: 20,
        background: HERO_BG,
        padding: "16px 16px 14px",
        boxShadow: SHADOW_HERO,
        color: "#FFFFFF",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.88)" }}>
          {eyebrow}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.88)", whiteSpace: "nowrap" }}>
          {periodText}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: stacked ? "minmax(0, 1fr)" : "minmax(0, 1fr) 1px minmax(0, 1fr)",
          gap: 14,
          marginTop: 12,
          alignItems: "stretch",
        }}
      >
        {cells.map((c, i) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              style={{
                minWidth: 0,
                gridColumn: stacked ? "1" : i === 0 ? "1" : "3",
                gridRow: stacked ? String(i * 2 + 1) : "1",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: "rgba(255,255,255,.16)",
                }}
              >
                <Icon size={16} strokeWidth={1.9} color="#FFFFFF" />
              </span>
              <div
                ref={(el) => {
                  valueRefs.current[i] = el;
                }}
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: "-0.4px",
                  marginTop: 10,
                  lineHeight: 1.1,
                  fontVariantNumeric: "tabular-nums",
                  // Never an ellipsis on money: side by side it must fit
                  // (measured above); stacked it may wrap as a last resort.
                  whiteSpace: stacked ? "normal" : "nowrap",
                  overflow: stacked ? "visible" : "hidden",
                  overflowWrap: stacked ? "anywhere" : "normal",
                }}
              >
                {c.value}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 3, color: "rgba(255,255,255,.9)" }}>
                {c.label}
              </div>
              {c.note ? (
                <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 1, color: "rgba(255,255,255,.78)" }}>
                  {c.note}
                </div>
              ) : null}
              {c.delta ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    marginTop: 7,
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "#FFFFFF",
                    color: c.delta.good ? MOSS : RED,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {c.delta.good ? (
                    <ArrowUpRight size={11} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <ArrowDownRight size={11} strokeWidth={2.4} aria-hidden />
                  )}
                  {c.delta.text}
                </span>
              ) : null}
            </div>
          );
        })}
        <div
          aria-hidden
          style={
            stacked
              ? { gridColumn: "1", gridRow: "2", height: 1, background: "rgba(255,255,255,.2)" }
              : { gridColumn: "2", gridRow: "1", background: "rgba(255,255,255,.2)" }
          }
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quick actions — 4 tiles (labels + handlers from Home.tsx)
// ---------------------------------------------------------------------------
export type QuickActionSpec = { icon: LucideIcon; label: string; hex: string; onClick: () => void };

export function PhoneQuickActions({ actions }: { actions: QuickActionSpec[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 16 }}>
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            style={{
              minWidth: 0,
              background: "none",
              border: "none",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                maxWidth: 64,
                height: 56,
                borderRadius: 18,
                background: M.card,
                boxShadow: SHADOW_QUICK,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  background: tint(a.hex, 0.12),
                }}
              >
                <Icon size={20} strokeWidth={1.75} color={a.hex} aria-hidden />
              </span>
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: M.ink, whiteSpace: "nowrap" }}>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Report — total + one button per non-zero exception (2-col grid)
// ---------------------------------------------------------------------------
export type DailyChip = { label: string; count: number; dest: string; onClick: () => void };

export function PhoneDailyReport({ total, chips, state }: { total: number; chips: DailyChip[]; state: LoadState }) {
  // Red only for real exceptions; zero / loading / failed stay neutral.
  const alert = state === "ready" && total > 0;
  return (
    <PCard style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: alert ? tint(RED, 0.1) : tint(TAUPE, 0.12),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <ClipboardCheck size={20} strokeWidth={1.75} color={alert ? TEXT_DANGER : M.taupe} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: LABEL }}>DAILY REPORT</div>
          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 2 }}>process &amp; SOP exceptions to action today</div>
        </div>
        <div
          aria-label={state === "ready" ? `${total} exceptions` : state === "loading" ? "Loading" : "Unavailable"}
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.4px",
            color: alert ? TEXT_DANGER : state === "ready" ? M.raisin : M.muted,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {state === "ready" ? total : state === "loading" ? "…" : "—"}
        </div>
      </div>
      {state === "ready" && chips.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 13 }}>
          {chips.map((c, i) => (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              aria-label={`${c.label}: ${c.count}. Opens ${c.dest}`}
              style={{
                // An odd last item spans the row instead of leaving a hole.
                gridColumn: chips.length % 2 === 1 && i === chips.length - 1 ? "1 / -1" : undefined,
                minWidth: 0,
                minHeight: 48,
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 8px 8px 11px",
                borderRadius: 12,
                border: "none",
                background: M.paper,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: TEXT_DANGER,
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 16,
                }}
              >
                {c.count}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: M.raisin, lineHeight: 1.25 }}>
                {c.label}
              </span>
              <ChevronRight size={15} strokeWidth={2} color={M.faint} aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
      {state === "ready" && chips.length === 0 ? (
        <div style={{ fontSize: 11.5, color: M.muted, marginTop: 10 }}>No exceptions to action today.</div>
      ) : null}
      {state === "error" ? (
        <div role="status" style={{ fontSize: 11.5, color: M.muted, marginTop: 10 }}>
          Couldn't load the Daily Report.
        </div>
      ) : null}
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Orders due — horizontal snap carousel with a visible "N of M" position.
// ---------------------------------------------------------------------------
export type DueCard = {
  id: string;
  so: string;
  customer: string;
  status: string;
  dd: string;
  overdue: boolean;
  amount: string;
};

// Semantic hex → Foundation status TEXT role, so the pill label stays 4.5:1
// on the dark card too (the fixed hex is only for the tint and the rail).
const STATUS_TEXT: Record<string, string> = {
  "#4F7C3A": TEXT_SUCCESS,
  "#3E6570": "var(--m-text-status-info)",
  "#9C6F1E": TEXT_WARNING,
  "#9A3A2D": TEXT_DANGER,
};

/** Borderless status pill: StatusPill's sm typography + semantic hex, no outline. */
function TilePill({ style, label }: { style: SemanticStyle; label: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 9999,
        padding: "1px 8px",
        backgroundColor: tint(style.hex, 0.13),
        color: STATUS_TEXT[style.hex.toUpperCase()] ?? style.hex,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
      }}
    >
      {titleCaseStatus(label)}
    </span>
  );
}

export function PhoneOrdersDue({
  title,
  rows,
  state,
  onOpen,
  onSeeAll,
}: {
  title: string;
  rows: DueCard[];
  state: LoadState;
  onOpen: () => void;
  onSeeAll: () => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const frame = useRef<number | null>(null);
  const n = rows.length;
  const onScroll = useCallback(() => {
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = scroller.current;
      const first = el?.firstElementChild as HTMLElement | null;
      if (!el || !first || n === 0) return;
      const max = el.scrollWidth - el.clientWidth;
      // The last card can't snap to the start edge, so the end of the track
      // is the last card.
      const i = el.scrollLeft >= max - 4 ? n - 1 : Math.round(el.scrollLeft / (first.offsetWidth + 12));
      setIndex(Math.max(0, Math.min(n - 1, i)));
    });
  }, [n]);
  // Clamped at render: if the list shrinks, the position never points past
  // the last card (the next scroll re-derives it from scrollLeft).
  const shown = n === 0 ? 0 : Math.min(index, n - 1);
  useLayoutEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <>
      <PhoneSectionHeading
        icon={CalendarClock}
        title={title}
        margin="26px 2px 8px"
        right={
          <button
            type="button"
            onClick={onSeeAll}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              minHeight: 44,
              background: "none",
              border: "none",
              padding: 0,
              color: M.taupe,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              flex: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            See all
            <ChevronRight size={15} strokeWidth={2} color={M.taupe} aria-hidden />
          </button>
        }
      />
      {state !== "ready" || n === 0 ? (
        <PCard padded={false} style={{ marginBottom: 14 }}>
          <StateRow
            text={
              state === "loading" ? "Loading orders…" : state === "error" ? "Couldn't load orders." : "No upcoming orders"
            }
          />
        </PCard>
      ) : (
        <>
          <div
            ref={scroller}
            onScroll={onScroll}
            role="region"
            aria-label={`${title}: ${n} ${n === 1 ? "order" : "orders"}, swipe sideways`}
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              overflowY: "hidden",
              scrollSnapType: "x mandatory",
              scrollPaddingLeft: 18,
              // Right gutter comes from the end spacer: some engines drop a
              // scroller's padding-right, which would clip the last card.
              padding: "2px 0 20px 18px",
              margin: "-6px -18px 0",
              scrollbarWidth: "none",
              overscrollBehaviorX: "contain",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {rows.map((o) => {
              const sem: SemanticStyle =
                SO_STATUS_COLOR[o.status as keyof typeof SO_STATUS_COLOR] ?? SO_STATUS_COLOR.DRAFT;
              const DdIcon = o.overdue ? CircleAlert : Calendar;
              return (
                <MobileCard
                  key={o.id}
                  onClick={onOpen}
                  radius={16}
                  padded={false}
                  style={{
                    position: "relative",
                    flex: "none",
                    width: "min(262px, calc(100% - 58px))",
                    scrollSnapAlign: "start",
                    display: "flex",
                    flexDirection: "column",
                    padding: "14px 14px 13px 17px",
                    overflow: "hidden",
                    border: "none",
                    boxShadow: SHADOW_ORDER,
                  }}
                >
                  <span
                    aria-hidden
                    style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: sem.hex }}
                  />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: M.taupe,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                    >
                      {o.so}
                    </span>
                    <TilePill style={sem} label={o.status} />
                  </div>
                  <div
                    title={o.customer}
                    style={{
                      fontSize: 14.5,
                      fontWeight: 600,
                      color: M.raisin,
                      marginTop: 7,
                      lineHeight: 1.35,
                      minHeight: 39,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {o.customer}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "4px 8px",
                      marginTop: 10,
                      padding: "8px 10px",
                      background: M.paper,
                      borderRadius: 10,
                    }}
                  >
                    <DdIcon size={13} strokeWidth={1.9} color={o.overdue ? TEXT_DANGER : M.muted} aria-hidden />
                    <span
                      style={{
                        fontSize: 11.5,
                        color: o.overdue ? TEXT_DANGER : M.muted,
                        fontWeight: o.overdue ? 600 : 400,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Exp. DD {o.dd || "—"}
                      {o.overdue ? <span style={SR_ONLY}> (overdue)</span> : null}
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 13,
                        fontWeight: 700,
                        color: M.raisin,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.amount}
                    </span>
                  </div>
                </MobileCard>
              );
            })}
            <div aria-hidden style={{ flex: "none", width: 6 }} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              margin: "-8px 2px 0",
            }}
          >
            <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {rows.map((o, i) => (
                <span
                  key={o.id}
                  style={{
                    width: i === shown ? 16 : 6,
                    height: 6,
                    borderRadius: 999,
                    background: i === shown ? M.taupe : M.border,
                    transition: "width .18s ease, background-color .18s ease",
                  }}
                />
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: M.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {shown + 1} of {n}
            </span>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Order Pipeline — one stacked bar (delivered | outstanding) + legend
// ---------------------------------------------------------------------------
export function PhonePipeline({
  confirmed,
  delivered,
  outstanding,
  ratePct,
  note,
  state,
}: {
  /** Integer sen, straight from /api/sales-orders/stats (Home.tsx). */
  confirmed: number;
  delivered: number;
  outstanding: number;
  ratePct: number | null;
  note: string | null;
  state: LoadState;
}) {
  // Bar widths are display proportions of the three real totals
  // (outstanding = max(0, confirmed − delivered) on the server).
  const deliveredW = confirmed > 0 ? Math.max(0, Math.min(100, (delivered / confirmed) * 100)) : 0;
  const pct = (sen: number) => (confirmed > 0 ? `${Math.round((sen / confirmed) * 100)}%` : "—");
  const legend = [
    { label: "Confirmed", sen: confirmed, hex: TAUPE },
    { label: "Delivered", sen: delivered, hex: MOSS },
    { label: "Outstanding", sen: outstanding, hex: OCHRE },
  ];
  return (
    <PCard style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin }}>Order Pipeline</span>
            {/* Not a live feed: /api/sales-orders/stats is cached and has no
                date filter, so the pill says what it covers instead of
                implying a real-time feed. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.5,
                color: M.taupe,
                background: tint(TAUPE, 0.1),
                padding: "2px 7px",
                borderRadius: 999,
                whiteSpace: "nowrap",
              }}
            >
              ALL MONTHS
            </span>
          </div>
          <div style={{ fontSize: 11, color: M.muted, marginTop: 3 }}>
            shipped vs still to ship · not filtered by period
          </div>
        </div>
        {state === "ready" && ratePct != null ? (
          <div style={{ textAlign: "right", flex: "none" }}>
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: TEXT_SUCCESS,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {Math.round(ratePct)}%
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: LABEL, marginTop: 4, whiteSpace: "nowrap" }}>
              DELIVERED RATE
            </div>
          </div>
        ) : null}
      </div>
      {state !== "ready" ? (
        <div role="status" style={{ fontSize: 11.5, color: M.muted, marginTop: 14 }}>
          {state === "loading" ? "Loading…" : "Couldn't load the pipeline."}
        </div>
      ) : (
        <>
          <div
            role="img"
            aria-label={
              confirmed > 0
                ? `Delivered ${pct(delivered)} and outstanding ${pct(outstanding)} of confirmed`
                : "No confirmed sales"
            }
            style={{
              display: "flex",
              height: 10,
              borderRadius: 999,
              overflow: "hidden",
              marginTop: 16,
              background: M.divider,
              gap: deliveredW > 0 && outstanding > 0 ? 2 : 0,
            }}
          >
            {deliveredW > 0 ? <span style={{ width: `${deliveredW}%`, background: MOSS }} /> : null}
            {confirmed > 0 && outstanding > 0 ? <span style={{ flex: 1, background: OCHRE }} /> : null}
          </div>
          <div style={{ display: "grid", gap: 2, marginTop: 12 }}>
            {legend.map((p) => (
              <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 3, background: p.hex, flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: M.body, fontWeight: 600 }}>{p.label}</span>
                <span style={{ fontSize: 12, color: M.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {pct(p.sen)}
                </span>
                <span
                  style={{
                    minWidth: 112,
                    textAlign: "right",
                    fontSize: 12,
                    fontWeight: 700,
                    color: M.raisin,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCurrency(p.sen)}
                </span>
              </div>
            ))}
          </div>
          {note ? (
            <div
              style={{
                fontSize: 11,
                color: M.muted,
                marginTop: 8,
                paddingTop: 10,
                borderTop: `1px solid ${M.divider}`,
              }}
            >
              {note}
            </div>
          ) : null}
        </>
      )}
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Plant Load — ring + Workforce / Queue Load tiles + 2×2 detail tiles.
// Neutral colours (owner decision 6): no load thresholds exist, so the ring
// and Queue Load never claim a level is good or bad.
// ---------------------------------------------------------------------------
export type PlantTile = { icon: LucideIcon; label: string; value: string; sub: string };

export function PhonePlantLoad({
  queue,
  loadPct,
  workforce,
  tiles,
}: {
  queue: string;
  loadPct: number | null;
  workforce: number | null;
  tiles: PlantTile[];
}) {
  const p = loadPct ?? 0;
  const stat = (label: string, value: string) => (
    <div style={{ background: M.paper, borderRadius: 12, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: LABEL }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: M.raisin,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
  return (
    <PCard>
      <CardTitle title="Plant Load" sub="backlog vs daily capacity" />
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
        <div
          role="img"
          aria-label={`Queue ${queue}${loadPct != null ? `, queue load ${loadPct}%` : ""}`}
          style={{ position: "relative", width: 118, height: 118, flex: "none" }}
        >
          <div
            style={{
              width: 118,
              height: 118,
              borderRadius: "50%",
              background: `conic-gradient(${M.taupe} 0% ${p}%, ${M.divider} ${p}% 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 13,
              left: 13,
              width: 92,
              height: 92,
              borderRadius: "50%",
              background: M.card,
              boxShadow: "inset 0 2px 6px rgba(31,29,27,.06)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 28, fontWeight: 800, color: M.raisin, letterSpacing: -1, lineHeight: 1 }}>
              {queue}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: LABEL, marginTop: 4 }}>QUEUE</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
          {stat("WORKFORCE", workforce != null ? String(workforce) : "—")}
          {stat("QUEUE LOAD", loadPct != null ? `${loadPct}%` : "—")}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
        {tiles.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.label} style={{ minWidth: 0, borderRadius: 12, padding: "10px 11px", background: M.paper }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <Icon size={14} strokeWidth={1.9} color={BRONZE} style={{ flex: "none", marginTop: 1 }} aria-hidden />
                <span style={{ fontSize: 12.5, color: M.body, fontWeight: 600, lineHeight: 1.25, minWidth: 0 }}>
                  {r.label}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: M.raisin,
                  marginTop: 5,
                  fontVariantNumeric: "tabular-nums",
                  overflowWrap: "anywhere",
                }}
              >
                {r.value}
              </div>
              <div style={{ fontSize: 11, color: LABEL, marginTop: 1, lineHeight: 1.3 }}>{r.sub}</div>
            </div>
          );
        })}
      </div>
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Department Backlog — existing rule: #1 (bottleneck) red, > 20 days ochre.
// ---------------------------------------------------------------------------
export type BacklogRow = { dept: string; days: string; pct: number; raw: number | null };

export function PhoneDeptBacklog({ rows }: { rows: BacklogRow[] }) {
  return (
    <PCard style={{ marginTop: 12 }}>
      <CardTitle title="Department Backlog" sub="active work vs daily capacity · bottleneck first" />
      <div style={{ display: "grid", gap: 11, marginTop: 14 }}>
        {rows.map((d, i) => {
          const first = i === 0;
          const fill = first ? RED : (d.raw ?? Infinity) > 20 ? OCHRE : BRONZE;
          return (
            <div key={`${d.dept}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                title={d.dept}
                style={{
                  width: 88,
                  flex: "none",
                  fontSize: 11.5,
                  color: first ? TEXT_DANGER : M.body,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {d.dept}
              </span>
              <span
                aria-hidden
                style={{ flex: 1, height: 8, background: M.divider, borderRadius: 999, overflow: "hidden" }}
              >
                <span style={{ display: "block", width: `${d.pct}%`, height: "100%", background: fill, borderRadius: 999 }} />
              </span>
              <span
                style={{
                  minWidth: 42,
                  flex: "none",
                  textAlign: "right",
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: first ? TEXT_DANGER : M.ink,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {d.days}
              </span>
            </div>
          );
        })}
      </div>
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Stock alerts — heading count is the REAL number of low materials; the card
// lists the lowest few and says so when there are more.
// ---------------------------------------------------------------------------
export type StockRow = { id: string; title: string; code: string; qty: number; qtyText: string; minText: string };

export function PhoneStockAlerts({
  rows,
  total,
  state,
  onOpen,
}: {
  rows: StockRow[];
  total: number;
  state: LoadState;
  onOpen: () => void;
}) {
  return (
    <>
      <PhoneSectionHeading
        icon={Package}
        title="Stock alerts"
        right={
          state === "ready" && total > 0 ? (
            <span
              style={{
                background: tint(RED, 0.1),
                color: TEXT_DANGER,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 999,
                whiteSpace: "nowrap",
              }}
            >
              {total} low
            </span>
          ) : undefined
        }
      />
      <PCard padded={false} style={{ overflow: "hidden" }}>
        {state !== "ready" || rows.length === 0 ? (
          <StateRow
            text={
              state === "loading"
                ? "Loading stock alerts…"
                : state === "error"
                  ? "Couldn't load stock alerts."
                  : "No low-stock materials"
            }
          />
        ) : (
          <>
            {rows.map((s, i) => {
              const danger = s.qty === 0;
              const Icon = danger ? CircleAlert : TriangleAlert;
              const go = () => onOpen();
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      go();
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px 12px 15px",
                    minHeight: 60,
                    boxSizing: "border-box",
                    borderTop: i === 0 ? "none" : `1px solid ${M.divider}`,
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      borderRadius: 11,
                      background: danger ? tint(RED, 0.1) : tint(OCHRE, 0.12),
                      flex: "none",
                    }}
                  >
                    <Icon size={17} strokeWidth={1.75} color={danger ? TEXT_DANGER : TEXT_WARNING} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: M.raisin,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.title}
                    </div>
                    <div
                      style={{ fontSize: 11.5, color: M.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {s.code}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: danger ? TEXT_DANGER : TEXT_WARNING,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.qtyText}
                    </div>
                    <div style={{ fontSize: 10.5, color: M.faint }}>{s.minText}</div>
                  </div>
                </div>
              );
            })}
            {total > rows.length ? (
              <div
                style={{
                  padding: "10px 15px",
                  borderTop: `1px solid ${M.divider}`,
                  fontSize: 11.5,
                  color: M.muted,
                }}
              >
                Showing the {rows.length} lowest of {total}
              </div>
            ) : null}
          </>
        )}
      </PCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Purchasing — own heading (owner decision 5), tiles + top suppliers.
// ---------------------------------------------------------------------------
export function PhonePurchasing({
  openPOs,
  spend,
  suppliers,
}: {
  openPOs: number;
  spend: string;
  suppliers: { name: string; amt: string; sen: number }[];
}) {
  const top = Math.max(1, ...suppliers.map((s) => s.sen));
  return (
    <>
      <PhoneSectionHeading icon={ShoppingBag} title="Purchasing" />
      <PCard>
        <div style={{ fontSize: 11, color: M.muted }}>open POs · spend in the selected month · top suppliers</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, .8fr) minmax(0, 1.2fr)",
            gap: 8,
            margin: "11px 0 14px",
          }}
        >
          <div style={{ background: M.paper, borderRadius: 12, padding: "11px 12px", minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: LABEL }}>OPEN POS</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: M.raisin, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
              {openPOs}
            </div>
          </div>
          <div style={{ background: M.paper, borderRadius: 12, padding: "11px 12px", minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: LABEL }}>SPEND / MONTH</div>
            <div
              style={{
                fontSize: 15.5,
                fontWeight: 800,
                color: M.raisin,
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
                overflowWrap: "anywhere",
              }}
            >
              {spend}
            </div>
          </div>
        </div>
        {suppliers.length > 0 ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: LABEL, letterSpacing: 0.5, marginBottom: 4 }}>
              TOP SUPPLIERS
            </div>
            {suppliers.map((s, i) => (
              <div key={`${s.name}-${i}`} style={{ padding: "8px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      color: M.raisin,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.name}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: M.raisin, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {s.amt}
                  </span>
                </div>
                <div aria-hidden style={{ height: 4, background: M.divider, borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.max(0, Math.round((s.sen / top) * 100))}%`,
                      height: "100%",
                      background: BRONZE,
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            ))}
          </>
        ) : null}
      </PCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Revenue — 3 series; legend toggles are real buttons (aria-pressed).
// ---------------------------------------------------------------------------
const REV_W = 320;
const REV_H = 132;
const REV_STROKE: Record<string, { color: string; width: number; dash?: string }> = {
  so: { color: M.taupe, width: 2.2 },
  prod: { color: TEAL, width: 2 },
  inv: { color: BRONZE, width: 2, dash: "4 3" },
};

export function PhoneRevenue({
  periodText,
  lines,
  days,
  hidden,
  onToggle,
}: {
  periodText: string;
  lines: { key: string; label: string; points: string }[];
  days: { d: string }[];
  hidden: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const so = lines.find((l) => l.key === "so");
  return (
    <PCard style={{ marginTop: 14 }}>
      <CardTitle title={`Revenue · ${periodText}`} sub="Sales Orders · Invoices · Production · tap a legend to toggle" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 10px" }}>
        {lines.map((l) => {
          const on = !hidden[l.key];
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(l.key)}
              style={{
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 11px",
                borderRadius: 999,
                border: "none",
                background: on ? M.paper : M.card,
                fontSize: 11,
                color: on ? M.body : M.faint,
                fontWeight: 600,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  flex: "none",
                  background: on ? REV_STROKE[l.key]?.color ?? M.taupe : M.hairline,
                }}
              />
              {l.label}
            </button>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${REV_W} ${REV_H}`} width="100%" height="148" preserveAspectRatio="none" aria-hidden>
        {[33, 66, 99].map((y) => (
          <line key={y} x1="0" y1={y} x2={REV_W} y2={y} style={{ stroke: M.divider }} strokeWidth="1" />
        ))}
        <line x1="0" y1={REV_H - 0.5} x2={REV_W} y2={REV_H - 0.5} style={{ stroke: M.hairline }} strokeWidth="1" />
        {so && !hidden.so ? (
          <polygon points={`0,${REV_H} ${so.points} ${REV_W},${REV_H}`} style={{ fill: M.taupe }} opacity={0.08} />
        ) : null}
        {lines
          .filter((l) => !hidden[l.key])
          .map((l) => {
            const s = REV_STROKE[l.key] ?? { color: M.taupe, width: 2 };
            return (
              <polyline
                key={l.key}
                points={l.points}
                fill="none"
                style={{ stroke: s.color }}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {days.map((d, i) => (
          <span key={`d${i}`} style={{ fontSize: 8.5, color: LABEL }}>
            {d.d}
          </span>
        ))}
      </div>
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Worker Efficiency — existing bands (≥100 / 70–99 / <70), now explained.
// ---------------------------------------------------------------------------
type WorkerRowData = { name: string; dept: string; pct: number };

function bandOf(pct: number) {
  return pct >= 100
    ? { text: TEXT_SUCCESS, bg: tint(MOSS, 0.1) }
    : pct >= 70
      ? { text: TEXT_WARNING, bg: tint(OCHRE, 0.12) }
      : { text: TEXT_DANGER, bg: tint(RED, 0.1) };
}

function WorkerLine({ w, rank }: { w: WorkerRowData; rank: number }) {
  const band = bandOf(w.pct);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
      <RankBadge n={rank} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          fontWeight: 600,
          color: M.raisin,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {w.name} <span style={{ color: LABEL, fontWeight: 500 }}>· {w.dept}</span>
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 800,
          color: band.text,
          background: band.bg,
          padding: "2px 8px",
          borderRadius: 999,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {Math.round(w.pct)}%
      </span>
    </div>
  );
}

export function PhoneWorkerEfficiency({
  periodText,
  top,
  low,
}: {
  periodText: string;
  top: WorkerRowData[];
  low: WorkerRowData[];
}) {
  const head = (Icon: LucideIcon, text: string, color: string, divider: boolean) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        margin: "14px 0 4px",
        paddingTop: divider ? 12 : 0,
        borderTop: divider ? `1px solid ${M.divider}` : "none",
      }}
    >
      <Icon size={14} strokeWidth={2} color={color} aria-hidden />
      <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
  return (
    <PCard style={{ marginTop: 12 }}>
      <CardTitle title="Worker Efficiency" sub={`production mins ÷ clocked hours · ${periodText}`} />
      {head(TrendingUp, "TOP 5", TEXT_SUCCESS, false)}
      {top.map((w, i) => (
        <WorkerLine key={`wt${i}`} w={w} rank={i + 1} />
      ))}
      {head(TrendingDown, "LOWEST 5", TEXT_DANGER, true)}
      {low.map((w, i) => (
        <WorkerLine key={`wl${i}`} w={w} rank={i + 1} />
      ))}
      {/* The card's colour bands and the Daily Report's low-efficiency count
          use different thresholds (both existing); say so instead of letting
          a red 65% look like it should be in the Daily Report. */}
      <div style={{ fontSize: 11, color: M.muted, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${M.divider}` }}>
        Green 100%+, amber 70–99%, red under 70%. The Daily Report counts workers under 60% yesterday.
      </div>
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Sales by Customer — All / Bedframe / Sofa switch, donut, top rows.
// ---------------------------------------------------------------------------
const SBC_PHONE_COLORS = [TAUPE, TEAL, MOSS, PLUM, OCHRE, BRONZE];

export function PhoneSalesByCustomer({
  cat,
  onCat,
  rows,
  top3,
  total,
}: {
  cat: "all" | "bedframe" | "sofa";
  onCat: (c: "all" | "bedframe" | "sofa") => void;
  rows: { name: string; total: string; pct: number; sub: string }[];
  top3: number;
  total: string;
}) {
  // Segment boundaries as a running sum (the last one closes at 100%).
  const donut =
    "conic-gradient(" +
    rows
      .reduce<{ at: number; segs: string[] }>(
        (s, r, i) => {
          const end = i === rows.length - 1 ? 100 : s.at + r.pct;
          return { at: end, segs: [...s.segs, `${SBC_PHONE_COLORS[i % SBC_PHONE_COLORS.length]} ${s.at}% ${end}%`] };
        },
        { at: 0, segs: [] },
      )
      .segs.join(", ") +
    ")";
  const tabs: { key: "all" | "bedframe" | "sofa"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "bedframe", label: "Bedframe" },
    { key: "sofa", label: "Sofa" },
  ];
  return (
    <PCard style={{ marginTop: 12 }}>
      <CardTitle title="Sales by Customer" sub="sales value · top 5 customers · % is each one's share of these 5" />
      <div
        role="group"
        aria-label="Product type"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 3,
          height: 44,
          boxSizing: "border-box",
          padding: 3,
          borderRadius: 12,
          background: M.divider,
          marginTop: 12,
        }}
      >
        {tabs.map((t) => {
          const on = cat === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => onCat(t.key)}
              style={{
                border: "none",
                borderRadius: 9,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                background: on ? M.card : "transparent",
                color: on ? M.raisin : M.body,
                boxShadow: on ? SHADOW_THUMB : "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "16px 0 10px" }}>
        <div role="img" aria-label={`Top 3 customers: ${top3}% of these 5`} style={{ position: "relative", width: 104, height: 104, flex: "none" }}>
          <div style={{ width: 104, height: 104, borderRadius: "50%", background: donut }} />
          <div
            style={{
              position: "absolute",
              top: 20,
              left: 20,
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: M.card,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 9, color: LABEL, fontWeight: 700 }}>TOP 3</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: M.raisin }}>{top3}%</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: M.muted }}>All customers, all products</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: M.raisin,
              letterSpacing: -0.4,
              fontVariantNumeric: "tabular-nums",
              overflowWrap: "anywhere",
            }}
          >
            {total}
          </div>
        </div>
      </div>
      {rows.map((r, i) => (
        <div
          key={`sbc${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 0",
            borderTop: i === 0 ? "none" : `1px solid ${M.divider}`,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: SBC_PHONE_COLORS[i % SBC_PHONE_COLORS.length],
              flex: "none",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* The share sits outside the ellipsis so a long name never hides it. */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, fontSize: 12.5, fontWeight: 700 }}>
              <span
                title={r.name}
                style={{ color: M.raisin, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {r.name}
              </span>
              <span style={{ color: LABEL, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>· {r.pct}%</span>
            </div>
            <div style={{ fontSize: 10.5, color: M.muted }}>Avg {r.sub}</div>
          </div>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: M.raisin,
              flex: "none",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {r.total}
          </span>
        </div>
      ))}
    </PCard>
  );
}

// ---------------------------------------------------------------------------
// Top Sellers + Fabric Usage
// ---------------------------------------------------------------------------
function SubHeading({ icon: Icon, label, divider }: { icon?: LucideIcon; label: string; divider?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        margin: divider ? "14px 0 4px" : "12px 0 2px",
        paddingTop: divider ? 12 : 0,
        borderTop: divider ? `1px solid ${M.divider}` : "none",
      }}
    >
      {Icon ? <Icon size={14} strokeWidth={1.9} color={M.taupe} aria-hidden /> : null}
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>{label}</span>
    </div>
  );
}

export function PhoneTopSellers({
  bed,
  sofa,
}: {
  bed: { code: string; qty: string; amt: string }[];
  sofa: { code: string; qty: string; amt: string }[];
}) {
  const row = (t: { code: string; qty: string; amt: string }, i: number) => (
    <div key={`${t.code}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
      <RankBadge n={i + 1} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          title={t.code}
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: M.raisin,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {t.code}
        </span>
        <span style={{ fontSize: 11, color: LABEL, whiteSpace: "nowrap", flex: "none" }}>{t.qty}</span>
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: M.raisin, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {t.amt}
      </span>
    </div>
  );
  return (
    <PCard style={{ marginTop: 12 }}>
      <CardTitle title="Top Sellers" sub="bedframe by units · sofa by sets" />
      {bed.length > 0 ? (
        <>
          <SubHeading icon={BedDouble} label="BEDFRAME" divider={false} />
          {bed.map(row)}
        </>
      ) : null}
      {sofa.length > 0 ? (
        <>
          <SubHeading icon={Sofa} label="SOFA" divider={bed.length > 0} />
          {sofa.map(row)}
        </>
      ) : null}
    </PCard>
  );
}

export function PhoneFabricUsage({
  bedAvg,
  sofaAvg,
  bed,
  sofa,
}: {
  bedAvg: string;
  sofaAvg: string;
  bed: { code: string; used: string; avg: string }[];
  sofa: { code: string; used: string; avg: string }[];
}) {
  const tile = (label: string, value: string) => (
    <div style={{ background: M.paper, borderRadius: 12, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: LABEL }}>{label}</div>
      <div style={{ fontSize: 15.5, fontWeight: 800, color: M.raisin, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
  const row = (f: { code: string; used: string; avg: string }, i: number) => (
    <div
      key={`${f.code}-${i}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 0",
        borderTop: i === 0 ? "none" : `1px solid ${M.divider}`,
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          fontWeight: 600,
          color: M.raisin,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {f.code}
      </span>
      <span style={{ fontSize: 11.5, color: M.muted, whiteSpace: "nowrap" }}>{f.used}</span>
      <span
        style={{
          minWidth: 74,
          textAlign: "right",
          fontSize: 12,
          fontWeight: 700,
          color: M.raisin,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {f.avg}
      </span>
    </div>
  );
  return (
    <PCard style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: M.raisin }}>Fabric Usage</div>
        <div style={{ fontSize: 11, color: M.muted, whiteSpace: "nowrap" }}>metres used · avg cost /m</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, margin: "13px 0 6px" }}>
        {tile("BEDFRAME AVG / M", bedAvg)}
        {tile("SOFA AVG / M", sofaAvg)}
      </div>
      {bed.length > 0 ? (
        <>
          <SubHeading label="BEDFRAME" />
          {bed.map(row)}
        </>
      ) : null}
      {sofa.length > 0 ? (
        <>
          <SubHeading label="SOFA" />
          {sofa.map(row)}
        </>
      ) : null}
    </PCard>
  );
}

