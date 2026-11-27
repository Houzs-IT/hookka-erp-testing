// ===========================================================================
// Inventory — the prototype's building blocks: badge, KPI tiles, stat tiles,
// list card, document row, notice, section label, expander, key/value rows,
// small section states and skeletons. Layers (sheets, dialogs) come from the
// Batch 4 kits (threepl/tpl-kit.tsx, the shared components/Sheet.tsx), so this
// folder adds no fixed-position layer of its own.
// ===========================================================================
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Info, Lock, RotateCw, TriangleAlert, type LucideIcon } from "lucide-react";
import "../xops/xops-theme.css";
import type { Tone } from "../../lib/inventory-lib";
import { LABEL, SH_CARD, SH_CARD_ON, SH_HERO, SH_SECTION, SH_TILE, TONE, X } from "./inv-style";

export function Badge({ l, tone, size = "sm" }: { l: string; tone: Tone; size?: "sm" | "md" }) {
  const t = TONE[tone];
  const md = size === "md";
  return (
    <span
      style={{
        flex: "none", height: md ? 22 : 21, display: "inline-flex", alignItems: "center", gap: md ? 5 : 4, padding: `0 ${md ? 9 : 8}px`,
        borderRadius: 999, background: t.b, color: t.c, fontSize: md ? 11 : 10.5, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: md ? 6 : 5, height: md ? 6 : 5, borderRadius: "50%", background: t.c }} />
      {l}
    </span>
  );
}

export type Kpi = { l: string; v: string; icon: LucideIcon; c: string; b: string };
export function KpiGrid({ items, loading, cols }: { items: Kpi[]; loading: boolean; cols: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 8, padding: "12px 16px 0" }}>
      {items.map((k) => (
        <div key={k.l} style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: X.card, boxShadow: SH_TILE }}>
          <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: k.b, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <k.icon size={15} strokeWidth={2} color={k.c} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 17, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", color: X.ink }}>
              {loading ? "…" : k.v}
            </span>
            <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.3, color: X.mut, marginTop: 1 }}>{k.l}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export type Amt = { k: string; v: string; c?: string };
function Amts({ amts, bg }: { amts: Amt[]; bg: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${amts.length},minmax(0,1fr))`, gap: 6, marginTop: 9 }}>
      {amts.map((a) => (
        <div key={a.k} style={{ minWidth: 0, padding: "6px 9px", borderRadius: 10, background: bg }}>
          <div style={{ fontSize: 10, lineHeight: 1.25, fontWeight: 700, letterSpacing: 0.3, color: X.gold, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.k}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: a.c ?? X.ink, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{a.v}</div>
        </div>
      ))}
    </div>
  );
}

export type BadgeSpec = { l: string; tone: Tone };
/** The list card (prototype `p`): rail, code + badges + date + chevron, title, sub, amounts, warning. */
export function ListCard({ code, badges, date, title, sub, amts, rail, warn, faded, current, onTap, aria }: {
  code: string; badges: BadgeSpec[]; date?: string; title: string; sub?: string; amts: Amt[]; rail: string; warn?: string;
  faded?: boolean; current?: boolean; onTap: () => void; aria: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={aria}
      aria-current={current ? "true" : undefined}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onTap();
        }
      }}
      style={{
        position: "relative", overflow: "hidden", background: X.card, color: X.ink, borderRadius: 16, padding: "12px 14px 12px 17px",
        cursor: "pointer", boxShadow: current ? SH_CARD_ON : SH_CARD, opacity: faded ? 0.75 : 1, minWidth: 0, WebkitTapHighlightColor: "transparent",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: X.br, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{code}</span>
        {badges.map((b) => <Badge key={b.l} l={b.l} tone={b.tone} />)}
        <span style={{ flex: 1 }} />
        {date ? <span style={{ flex: "none", fontSize: 11.5, color: X.mut, whiteSpace: "nowrap" }}>{date}</span> : null}
        <ChevronRight size={17} strokeWidth={1.9} color={X.gold} style={{ flex: "none" }} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 5, lineHeight: 1.3, overflowWrap: "anywhere" }}>{title}</div>
      {sub ? <div style={{ fontSize: 12.5, color: X.sub, marginTop: 2, overflowWrap: "anywhere" }}>{sub}</div> : null}
      <Amts amts={amts} bg={X.bg} />
      {warn ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8, fontSize: 11.5, lineHeight: 1.4, color: X.bad }}>
          <span style={{ flex: "none", display: "flex", height: 16, alignItems: "center" }}>
            <CircleAlert size={13} strokeWidth={2.2} />
          </span>
          <span>{warn}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Section label with a hairline and an optional right-hand note (prototype `isLabel`). */
export function Label({ t, r, pad = "8px 4px 0" }: { t: string; r?: string; pad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: pad }}>
      <span style={LABEL}>{t}</span>
      <span style={{ flex: 1, height: 1, background: X.ln }} />
      {r ? <span style={{ flex: "none", fontSize: 11.5, color: X.mut, whiteSpace: "nowrap" }}>{r}</span> : null}
    </div>
  );
}

export function Hero({ code, badges, title, sub }: { code: string; badges: BadgeSpec[]; title: string; sub?: string }) {
  return (
    <section style={{ borderRadius: 20, padding: 14, background: X.card, boxShadow: SH_HERO, color: X.ink }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: X.br, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{code}</span>
        {badges.map((b) => <Badge key={b.l} l={b.l} tone={b.tone} size="md" />)}
      </div>
      <h1 style={{ margin: "8px 0 0", fontSize: 19, lineHeight: 1.3, fontWeight: 700, letterSpacing: -0.2, overflowWrap: "anywhere" }}>{title}</h1>
      {sub ? <div style={{ fontSize: 13, color: X.sub, marginTop: 3 }}>{sub}</div> : null}
    </section>
  );
}

export type Tile = { l: string; v: string; c?: string; s?: string };
export function Tiles({ tiles, cols = 2 }: { tiles: Tile[]; cols?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 8 }}>
      {tiles.map((k) => (
        <div key={k.l} style={{ minWidth: 0, padding: "10px 12px", borderRadius: 14, background: X.card, boxShadow: SH_TILE }}>
          <div style={{ fontSize: 11.5, lineHeight: 1.3, color: X.mut }}>{k.l}</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: k.c ?? X.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.v}</div>
          {k.s ? <div style={{ fontSize: 11, color: X.mut, marginTop: 2, lineHeight: 1.35 }}>{k.s}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** Info / warning / error strip with a coloured inset rail (prototype `isNote`). */
export function Notice({ tone, children }: { tone: "info" | "warn" | "bad"; children: ReactNode }) {
  const t = TONE[tone];
  const Icon = tone === "warn" ? TriangleAlert : tone === "bad" ? CircleAlert : Info;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "11px 12px", borderRadius: 14, background: t.b, boxShadow: `inset 3px 0 0 ${t.c}`, fontSize: 12.5, lineHeight: 1.45, color: X.sub }}>
      <Icon size={16} strokeWidth={2} color={t.c} style={{ flex: "none", marginTop: 1 }} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

export function Expander({ title, sub, icon: Icon, open, onToggle }: { title: string; sub: string; icon: LucideIcon; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 14px", borderRadius: 16, border: "none", background: X.card,
        boxShadow: `0 0 0 1px ${X.ring},0 8px 18px -14px ${X.shd}`, fontFamily: "inherit", textAlign: "left", cursor: "pointer", color: X.ink, width: "100%",
      }}
    >
      <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: X.tint, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={15} strokeWidth={2} color={X.br} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: X.mut, marginTop: 1 }}>{sub}</span>
      </span>
      <span style={{ display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
        <ChevronDown size={18} strokeWidth={2} color={X.gold} />
      </span>
    </button>
  );
}

export type KV = { k: string; v: string; c?: string };
export function Rows({ rows }: { rows: KV[] }) {
  return (
    <section style={{ borderRadius: 16, background: X.card, boxShadow: SH_SECTION, overflow: "hidden", color: X.ink }}>
      {rows.map((r, i) => {
        const empty = !r.v;
        return (
          <div key={`${r.k}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderTop: i ? `1px solid ${X.ln}` : "none" }}>
            <span style={{ width: 120, flex: "none", fontSize: 12.5, color: X.mut }}>{r.k}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, color: empty ? X.mut : (r.c ?? X.ink), fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
              {empty ? "—" : r.v}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** A movement / lot / source row (prototype `isDoc`). */
export function DocCard({ code, st, tone = "neu", date, title, sub, amts, rail }: {
  code: string; st?: string; tone?: Tone; date?: string; title: string; sub?: string; amts?: Amt[]; rail?: string;
}) {
  const t = TONE[tone];
  return (
    <div style={{ position: "relative", overflow: "hidden", background: X.card, color: X.ink, borderRadius: 16, padding: "11px 14px 11px 17px", boxShadow: `0 0 0 1px ${X.ring},0 10px 24px -16px ${X.shd}`, minWidth: 0 }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail ?? X.chev }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{code || "—"}</span>
        {st ? (
          <span style={{ flex: "none", height: 21, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 999, background: t.b, color: t.c, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: t.c }} />
            {st}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {date ? <span style={{ flex: "none", fontSize: 11.5, color: X.mut, whiteSpace: "nowrap" }}>{date}</span> : null}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 4, lineHeight: 1.35, overflowWrap: "anywhere" }}>{title}</div>
      {sub ? <div style={{ fontSize: 12, color: X.sub, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{sub}</div> : null}
      {amts && amts.length ? <Amts amts={amts} bg={X.bg} /> : null}
    </div>
  );
}

/** A small in-section state line (prototype `isState`). */
export function StateLine({ children, retry, tone = "neu" }: { children: ReactNode; retry?: () => void; tone?: "neu" | "bad" | "lock" }) {
  return (
    <div
      role={tone === "bad" ? "alert" : undefined}
      style={{ padding: 18, borderRadius: 16, background: X.card, boxShadow: `0 0 0 1px ${X.ring}`, textAlign: "center", fontSize: 12.5, color: tone === "bad" ? X.bad : X.mut, lineHeight: 1.45, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
    >
      {tone === "lock" ? <Lock size={16} strokeWidth={2} color={X.neu} /> : null}
      <span>{children}</span>
      {retry ? (
        <button type="button" onClick={retry} style={{ height: 36, padding: "0 14px", borderRadius: 999, border: "none", background: X.tint, color: X.br, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <RotateCw size={13} strokeWidth={2.2} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeletons({ n = 4, h = 118, pad = "12px 16px" }: { n?: number; h?: number; pad?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 8, padding: pad }}>
      {Array.from({ length: n }, (_, k) => (
        <div key={k} className="tpl-anim" style={{ height: h, borderRadius: 16, background: X.card, animation: "tpl-pulse 1.2s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

/** "Show more · N left" (prototype `canMore`). */
export function MoreButton({ left, onTap, label }: { left: number; onTap: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onTap}
      style={{ width: "100%", height: 44, borderRadius: 999, border: "none", background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 6px 14px -8px ${X.shd}`, color: X.br, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
    >
      {label ?? `Show more · ${left} left`}
    </button>
  );
}
