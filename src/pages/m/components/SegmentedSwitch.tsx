// SegmentedSwitch — slim full-width view switch (phone Home: Operations |
// Performance, owner 2026-10-13; /m/updates: Notifications | Announcements).
//
// 44px warm-neutral track (M.divider + 1px M.border), equal-width text-only
// segments; the active one is an M.card surface with a hairline border and a
// very soft shadow. Tokens only, so dark mode follows body[data-theme].
// A group of two pressed/not-pressed buttons: Tab reaches each, Enter/Space
// selects (native <button>).
//
// Optional per-option `badge`: a small count pill after the label, rendered
// only when the number is > 0 (capped "99+"). Pass a REAL count or nothing.
// An option without a badge renders exactly as before (bare label).
//
// `variant="prominent"` (opt-in, owner 2026-10-21): the Claude Design handoff
// switch from lib/control-styles.ts — 46px warm track, borderless segments,
// text-only. Used by phone Home only; the default variant (Updates, Sales
// detail) is unchanged.
import { M } from "../theme";
import { segmentTrack, segmentButton } from "../lib/control-styles";

type Option<K extends string> = {
  key: K;
  label: string;
  /** Real count to show after the label; hidden when missing or 0. */
  badge?: number;
  /** Accessible name while the badge shows, e.g. "Notifications, 3 unread". */
  badgeLabel?: string;
};

type Props<K extends string> = {
  options: Option<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Accessible name of the group, e.g. "Home view". */
  ariaLabel: string;
  /** "prominent" = the handoff switch; omitted = the original slim switch. */
  variant?: "default" | "prominent";
};

export function SegmentedSwitch<K extends string>({ options, value, onChange, ariaLabel, variant = "default" }: Props<K>) {
  const prominent = variant === "prominent";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={prominent ? segmentTrack(options.length) : {
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: 3,
        height: 44,
        boxSizing: "border-box",
        padding: 3,
        borderRadius: 12,
        backgroundColor: M.divider,
        border: `1px solid ${M.border}`,
      }}
    >
      {options.map((o) => {
        const on = o.key === value;
        const count = typeof o.badge === "number" && o.badge > 0 ? Math.floor(o.badge) : 0;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            aria-label={count > 0 ? (o.badgeLabel ?? `${o.label}, ${count}`) : undefined}
            onClick={() => onChange(o.key)}
            style={prominent ? segmentButton(on) : {
              minWidth: 0,
              height: "100%",
              padding: "0 8px",
              borderRadius: 9,
              border: `1px solid ${on ? M.hairline : "transparent"}`,
              backgroundColor: on ? M.card : "transparent",
              boxShadow: on ? "0 1px 2px rgba(31, 29, 27, 0.06)" : "none",
              color: on ? M.raisin : M.muted,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: on ? 700 : 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {count > 0 ? (
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, maxWidth: "100%" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    minWidth: 18,
                    height: 18,
                    boxSizing: "border-box",
                    padding: "0 5px",
                    borderRadius: 9,
                    backgroundColor: M.taupe,
                    color: M.card,
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: "18px",
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {count > 99 ? "99+" : count}
                </span>
              </span>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </div>
  );
}
