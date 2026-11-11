// ===========================================================================
// NotificationFilterSheet — /m/updates → Notifications filter panel (owner
// 2026-10-13). Three single-select groups — Category, Read status, Severity —
// on the shared bottom Sheet (centred dialog on tablets).
//
// Works on a DRAFT seeded from the applied filters each time it opens (same
// pattern as FilterSheet): closing (X / Esc / backdrop) discards it, Reset
// sets the draft back to "All", and only "Show N results" applies. N is the
// live count for the draft AND the current search, so a dead end shows before
// it is applied.
//
// Looks like the /m FilterSheet (2026-10-13 consistency pass): the Sheet's own
// 16px padding (none added here), 12/700 section labels 18px apart, chips in
// its style (12px, M.border / taupe, body / white text), and two equal
// 14/700 footer buttons with radius 12. Each chip sits in a 44px tap target.
//
// Each group is an ARIA radiogroup: one chip in the Tab order, arrow keys move
// and select, Home / End jump.
// ===========================================================================
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Sheet } from "../components";
import { M } from "../theme";
import {
  CATEGORY_OPTIONS,
  DEFAULT_FILTERS,
  READ_OPTIONS,
  SEVERITY_OPTIONS,
  type NotificationFilters,
} from "../lib/notification-filters";

const SEVERITY_DOT: Record<string, string> = {
  CRITICAL: M.sevCritical,
  WARNING: M.sevWarning,
  INFO: M.sevInfo,
};

type Props = {
  open: boolean;
  onClose: () => void;
  filters: NotificationFilters;
  /** Rows the draft would show (with the current search). */
  countFor: (draft: NotificationFilters) => number;
  onApply: (filters: NotificationFilters) => void;
};

export function NotificationFilterSheet({ open, onClose, filters, countFor, onApply }: Props) {
  const [draft, setDraft] = useState<NotificationFilters>(filters);
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(filters);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const count = countFor(draft);

  return (
    <Sheet open={open} onClose={onClose} title="Filter notifications">
      <div style={{ display: "grid", gap: 18 }}>
        <ChipGroup
          id="notif-filter-category"
          title="Category"
          options={CATEGORY_OPTIONS}
          value={draft.category}
          onChange={(category) => setDraft((d) => ({ ...d, category }))}
        />
        <ChipGroup
          id="notif-filter-read"
          title="Read status"
          options={READ_OPTIONS}
          value={draft.read}
          onChange={(read) => setDraft((d) => ({ ...d, read }))}
        />
        <ChipGroup
          id="notif-filter-severity"
          title="Severity"
          options={SEVERITY_OPTIONS}
          value={draft.severity}
          onChange={(severity) => setDraft((d) => ({ ...d, severity }))}
          dotFor={(v) => SEVERITY_DOT[v]}
        />
      </div>

      {/* Footer: FilterSheet's buttons, kept in view while the groups scroll.
          The negative side margins let its background span the sheet width
          (the Sheet pads its content 16px). */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          display: "flex",
          gap: 10,
          margin: "20px -16px 0",
          padding: "12px 16px 0",
          backgroundColor: M.paper,
          borderTop: `1px solid ${M.border}`,
        }}
      >
        <button type="button" onClick={() => setDraft(DEFAULT_FILTERS)} style={footerButton(false)}>
          Reset
        </button>
        <button type="button" onClick={() => onApply(draft)} style={footerButton(true)}>
          {count === 1 ? "Show 1 result" : `Show ${count} results`}
        </button>
      </div>
    </Sheet>
  );
}

/** FilterSheet's btnStyle, at a fixed 44px height. In light mode M.card is
 *  white (same as FilterSheet); in dark it keeps the label readable on taupe. */
function footerButton(primary: boolean): CSSProperties {
  return {
    flex: 1,
    height: 44,
    borderRadius: 12,
    border: `1px solid ${primary ? M.taupe : M.border}`,
    backgroundColor: primary ? M.taupe : M.card,
    color: primary ? M.card : M.body,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };
}

function ChipGroup<T extends string>({
  id,
  title,
  options,
  value,
  onChange,
  dotFor,
}: {
  id: string;
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  dotFor?: (v: T) => string | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next === -1) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div>
      {/* FilterSheet's SectionLabel */}
      <div id={`${id}-label`} style={{ fontSize: 12, fontWeight: 700, color: M.raisin, marginBottom: 2 }}>
        {title}
      </div>
      {/* 44px tap targets, 6px visual gap between chips (FilterSheet). */}
      <div role="radiogroup" aria-labelledby={`${id}-label`} style={{ display: "flex", flexWrap: "wrap", margin: "0 -3px" }}>
        {options.map((o, i) => {
          const on = i === current;
          const dot = dotFor?.(o.value);
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => move(e, i)}
              style={{
                height: 44,
                padding: "0 3px",
                border: "none",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                style={{
                  height: 32,
                  boxSizing: "border-box",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 13px",
                  borderRadius: 9999,
                  border: `1px solid ${on ? M.taupe : M.border}`,
                  backgroundColor: on ? M.taupe : M.card,
                  color: on ? M.card : M.body,
                  fontSize: 12,
                  fontWeight: on ? 700 : 500,
                  whiteSpace: "nowrap",
                }}
              >
                {dot ? (
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: dot,
                      boxShadow: on ? `0 0 0 1.5px ${M.card}` : "none",
                    }}
                  />
                ) : null}
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
