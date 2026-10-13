// SegmentedSwitch — slim full-width view switch (phone Home: Operations |
// Performance, owner 2026-10-13).
//
// 44px warm-neutral track (M.divider + 1px M.border), equal-width text-only
// segments; the active one is an M.card surface with a hairline border and a
// very soft shadow. Tokens only, so dark mode follows body[data-theme].
// A group of two pressed/not-pressed buttons: Tab reaches each, Enter/Space
// selects (native <button>).
import { M } from "../theme";

type Option<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  options: Option<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Accessible name of the group, e.g. "Home view". */
  ariaLabel: string;
};

export function SegmentedSwitch<K extends string>({ options, value, onChange, ariaLabel }: Props<K>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
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
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            style={{
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
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
