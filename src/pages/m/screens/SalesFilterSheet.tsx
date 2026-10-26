// ===========================================================================
// SalesFilterSheet — PHONE-only "Filter orders" sheet for /m/sales (owner
// 2026-10-15, Claude Design `Sales Orders.dc.html`; repo typography: the
// shared FilterSheet's 12/700 labels, 12 chips, 14/700 buttons, 16px inputs
// like the phone search).
//
// Not a shared component: tablet Sales and every other module keep
// components/FilterSheet.tsx unchanged. The sheet only edits a draft and
// hands back the SAME Record<string, ActiveFilter> the list already runs
// through applyFilters (logic in lib/so-filter-presets.ts):
//   Status · Expected DD presets · Amount presets (RM in, sen out) · More
//   filters (every other column) · sticky Reset + "Show N orders", where
//   N = applyFilters over the real rows with the draft.
// Filter only, as the prototype (owner 2026-10-15: the Sort | Filter switch
// was removed). The list keeps its sort state and applySort untouched.
// `withSort` (owner 2026-10-27: every width) adds a collapsed "Sort by" row at the top
// — the design's 7 readable options plus "All columns" for every other supported sort.
// The sort is a draft and applies together with the filters on "Show N orders".
// ===========================================================================
import { useMemo, useState } from "react";
import { Building2, Calendar, CalendarPlus, Check, ChevronDown, Package, Wallet, type LucideIcon } from "lucide-react";
import { Sheet } from "../components";
import { M, titleCaseStatus } from "../theme";
import { type ActiveFilter, type ColumnDef } from "../config/types";
import { applyFilters, resolveStatus, STATUS_MAPS } from "../config/helpers";
import {
  AMT_KEY,
  AMT_PRESETS,
  EXP_KEY,
  EXP_PRESETS,
  STATUS_KEY,
  buildFilters,
  localToday,
  moreCount,
  seedDraft,
  splitStatus,
  type Draft,
} from "../lib/so-filter-presets";

type Sort = { key: string; dir: "asc" | "desc" } | null;

const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const SHADOW_OFF = "0 1px 2px rgba(31,29,27,.06),0 3px 8px -4px rgba(31,29,27,.10)";
const SHADOW_ON = "0 6px 14px -6px rgba(107,92,50,.6)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65)";

export function SalesFilterSheet({
  open,
  onClose,
  columns,
  rows,
  search,
  filters,
  chip,
  chipKeys,
  withSort = false,
  sort = null,
  sortDefault = null,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: ColumnDef[];
  /** Every fetched row (the main chip is folded into the draft's Status). */
  rows: Record<string, unknown>[];
  search: string;
  filters: Record<string, ActiveFilter>;
  chip: string;
  chipKeys: string[];
  /** Wider screens: show a "Sort by" section (the phone sheet is filter-only). */
  withSort?: boolean;
  sort?: Sort;
  /** What Reset returns the sort to (the list's own default). */
  sortDefault?: Sort;
  /** `sort` is passed only when `withSort`. */
  onApply: (filters: Record<string, ActiveFilter>, chip: string, sort?: Sort) => void;
}) {
  const [today, setToday] = useState(localToday);
  const [draft, setDraft] = useState<Draft>(() => seedDraft(filters, chip, columns, today));
  const [more, setMore] = useState(false);
  const [draftSort, setDraftSort] = useState<Sort>(sort);
  const [wasOpen, setWasOpen] = useState(open);
  // Re-seed on every closed→open (same pattern as the shared FilterSheet).
  if (open && !wasOpen) {
    const t = localToday();
    const d = seedDraft(filters, chip, columns, t);
    setWasOpen(true);
    setToday(t);
    setDraft(d);
    setDraftSort(sort);
    setMore(moreCount(d) > 0);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const built = useMemo(() => buildFilters(draft, columns, today), [draft, columns, today]);
  const n = useMemo(
    () => applyFilters(rows, columns, built as Record<string, ActiveFilter>, search).length,
    [rows, columns, built, search],
  );

  const col = (k: string) => columns.find((c) => c.key === k);
  const statusCol = col(STATUS_KEY);
  const otherCols = columns.filter(
    (c) => c.key !== STATUS_KEY && c.key !== EXP_KEY && c.key !== AMT_KEY && c.type !== "enum",
  );
  const set = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));

  const apply = () => {
    const s = splitStatus(built, chipKeys);
    onApply(s.filters as Record<string, ActiveFilter>, s.chip, withSort ? draftSort : undefined);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Filter orders">
          <div style={{ display: "grid", gap: 22 }}>
            {withSort ? <SortBy columns={columns} sort={draftSort} onChange={setDraftSort} /> : null}

            {statusCol ? (
              <section aria-label="Status">
                <Label hint={draft.status.length ? `${draft.status.length} selected` : "Any"}>
                  {statusCol.label}
                </Label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {(statusCol.options ?? []).map((o) => {
                    const on = draft.status.includes(o);
                    return (
                      <Choice
                        key={o}
                        on={on}
                        role="checkbox"
                        onClick={() =>
                          set((d) => ({
                            ...d,
                            status: on ? d.status.filter((s) => s !== o) : [...d.status, o],
                          }))
                        }
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            flex: "none",
                            backgroundColor: resolveStatus(o, STATUS_MAPS.so).style.hex,
                            boxShadow: on ? `0 0 0 1.5px ${M.paper}` : "none",
                          }}
                        />
                        {titleCaseStatus(o)}
                      </Choice>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {col(EXP_KEY) ? (
              <section aria-label={col(EXP_KEY)!.label}>
                <Label>{col(EXP_KEY)!.label}</Label>
                <div role="radiogroup" aria-label={col(EXP_KEY)!.label} style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {EXP_PRESETS.map((p) => (
                    <Choice
                      key={p.key}
                      on={draft.exp.preset === p.key}
                      role="radio"
                      onClick={() => set((d) => ({ ...d, exp: { ...d.exp, preset: p.key } }))}
                    >
                      {p.label}
                    </Choice>
                  ))}
                </div>
                {draft.exp.preset === "custom" ? (
                  <Pair>
                    <Input
                      type="date"
                      aria-label={`${col(EXP_KEY)!.label} from`}
                      value={draft.exp.from}
                      onChange={(v) => set((d) => ({ ...d, exp: { ...d.exp, from: v } }))}
                    />
                    <Input
                      type="date"
                      aria-label={`${col(EXP_KEY)!.label} to`}
                      value={draft.exp.to}
                      onChange={(v) => set((d) => ({ ...d, exp: { ...d.exp, to: v } }))}
                    />
                  </Pair>
                ) : null}
              </section>
            ) : null}

            {col(AMT_KEY) ? (
              <section aria-label={col(AMT_KEY)!.label}>
                <Label>{col(AMT_KEY)!.label}</Label>
                <div role="radiogroup" aria-label={col(AMT_KEY)!.label} style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {AMT_PRESETS.map((p) => (
                    <Choice
                      key={p.key}
                      on={draft.amt.preset === p.key}
                      role="radio"
                      onClick={() => set((d) => ({ ...d, amt: { ...d.amt, preset: p.key } }))}
                    >
                      {p.label}
                    </Choice>
                  ))}
                </div>
                {draft.amt.preset === "custom" ? (
                  <Pair sep="to">
                    <Input
                      inputMode="decimal"
                      aria-label="Minimum amount (RM)"
                      placeholder="Min RM"
                      value={draft.amt.min}
                      onChange={(v) => set((d) => ({ ...d, amt: { ...d.amt, min: v } }))}
                    />
                    <Input
                      inputMode="decimal"
                      aria-label="Maximum amount (RM)"
                      placeholder="Max RM"
                      value={draft.amt.max}
                      onChange={(v) => set((d) => ({ ...d, amt: { ...d.amt, max: v } }))}
                    />
                  </Pair>
                ) : null}
              </section>
            ) : null}

            {otherCols.length ? (
              <section aria-label="More filters">
                <Expander
                  label="More filters"
                  count={moreCount(draft)}
                  open={more}
                  onToggle={() => setMore((o) => !o)}
                />
                {more ? (
                  <div style={{ display: "grid", gap: 14, padding: "16px 2px 0" }}>
                    {otherCols.map((c) => (
                      <div key={c.key} style={{ display: "grid", gap: 6, minWidth: 0 }}>
                        <FieldLabel>{c.label}</FieldLabel>
                        {c.type === "text" ? (
                          <Input
                            aria-label={c.label}
                            placeholder="Contains…"
                            value={draft.text[c.key] ?? ""}
                            onChange={(v) => set((d) => ({ ...d, text: { ...d.text, [c.key]: v } }))}
                          />
                        ) : c.type === "date" ? (
                          <Pair>
                            <Input
                              type="date"
                              aria-label={`${c.label} from`}
                              value={draft.dates[c.key]?.from ?? ""}
                              onChange={(v) =>
                                set((d) => ({ ...d, dates: { ...d.dates, [c.key]: { ...d.dates[c.key], from: v } } }))
                              }
                            />
                            <Input
                              type="date"
                              aria-label={`${c.label} to`}
                              value={draft.dates[c.key]?.to ?? ""}
                              onChange={(v) =>
                                set((d) => ({ ...d, dates: { ...d.dates, [c.key]: { ...d.dates[c.key], to: v } } }))
                              }
                            />
                          </Pair>
                        ) : (
                          <Pair sep="to">
                            <Input
                              inputMode="numeric"
                              aria-label={`Minimum ${c.label}`}
                              placeholder="Min"
                              value={draft.nums[c.key]?.min ?? ""}
                              onChange={(v) =>
                                set((d) => ({ ...d, nums: { ...d.nums, [c.key]: { ...d.nums[c.key], min: v } } }))
                              }
                            />
                            <Input
                              inputMode="numeric"
                              aria-label={`Maximum ${c.label}`}
                              placeholder="Max"
                              value={draft.nums[c.key]?.max ?? ""}
                              onChange={(v) =>
                                set((d) => ({ ...d, nums: { ...d.nums, [c.key]: { ...d.nums[c.key], max: v } } }))
                              }
                            />
                          </Pair>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>

          {/* Sticky actions; negative margins cancel the Sheet's padding so the bar is flush. */}
          <div
            style={{
              position: "sticky",
              bottom: 0,
              display: "flex",
              gap: 10,
              margin: "22px -16px calc(-16px - max(16px, env(safe-area-inset-bottom)))",
              padding: "12px 16px max(16px, env(safe-area-inset-bottom))",
              backgroundColor: M.paper,
              boxShadow: `0 -1px 0 ${M.hairline}`,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setDraft(seedDraft({}, "all", columns, today));
                setDraftSort(sortDefault);
              }}
              style={{ ...btn, flex: 1, backgroundColor: M.card, color: M.body, boxShadow: SHADOW_CONTROL }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={apply}
              style={{
                ...btn,
                flex: 1.4,
                background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
                color: M.paper,
                fontVariantNumeric: "tabular-nums",
                boxShadow: SHADOW_PRIMARY,
              }}
            >
              {n === 1 ? "Show 1 order" : `Show ${n} orders`}
            </button>
          </div>
    </Sheet>
  );
}

// ---- Pieces ----------------------------------------------------------------

const btn: React.CSSProperties = {
  height: 46,
  border: "none",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

/** Section heading as the Sales Orders design: 11/700, 1px tracking, taupe small caps, optional right hint. */
function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        margin: "0 2px 10px",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: M.taupe }}>{children}</span>
      {hint ? <span style={{ fontSize: 11.5, color: M.ink }}>{hint}</span> : null}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 700, color: M.raisin, marginLeft: 2 }}>{children}</span>;
}

/** Borderless pill choice (prototype); the shared Chip's 12px and 700/500 weights. */
function Choice({
  on,
  role,
  onClick,
  children,
}: {
  on: boolean;
  role: "checkbox" | "radio";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      style={{
        height: 36,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 14px",
        borderRadius: 999,
        border: "none",
        backgroundColor: on ? M.taupe : M.card,
        color: on ? M.paper : "var(--m-chip-text)",
        fontSize: 12.5,
        fontWeight: on ? 700 : 500,
        whiteSpace: "nowrap",
        boxShadow: on ? SHADOW_ON : SHADOW_OFF,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date";
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  "aria-label": string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
      style={{
        flex: 1,
        width: "100%",
        minWidth: 0,
        height: 44,
        boxSizing: "border-box",
        padding: "0 12px",
        borderRadius: 12,
        border: "none",
        backgroundColor: M.card,
        fontSize: 16,
        color: M.raisin,
        outline: "none",
        boxShadow: SHADOW_CONTROL,
      }}
    />
  );
}

/** Two inputs side by side. A grid of minmax(0,1fr) so native date inputs
 *  (which keep an intrinsic minimum width in flex rows) shrink at 320px. */
function Pair({ children, sep }: { children: [React.ReactNode, React.ReactNode]; sep?: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: sep ? "minmax(0,1fr) auto minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
      }}
    >
      {children[0]}
      {sep ? <span style={{ fontSize: 12, color: M.ink }}>{sep}</span> : null}
      {children[1]}
    </div>
  );
}

function Expander({
  label,
  subtitle,
  count = 0,
  open,
  onToggle,
}: {
  label: string;
  subtitle?: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        width: "100%",
        minHeight: 52,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
        border: "none",
        borderRadius: 14,
        backgroundColor: M.card,
        boxShadow: SHADOW_CONTROL,
        textAlign: "left",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, padding: subtitle ? "8px 0" : 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: M.raisin }}>{label}</span>
        {subtitle ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1, overflowWrap: "anywhere" }}>{subtitle}</span> : null}
      </span>
      {count ? (
        <span
          style={{
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            boxSizing: "border-box",
            borderRadius: 999,
            backgroundColor: M.taupe,
            color: M.paper,
            fontSize: 11,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {count}
        </span>
      ) : null}
      <ChevronDown
        size={18}
        strokeWidth={2}
        color={M.taupe}
        style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
      />
    </button>
  );
}

// ---- Sort by ------------------------------------------------------------------
// Sales Orders design (`Sales Orders v3/v4.dc.html` SORT_LIST): seven readable
// options, each with an icon, a label and a hint. Collapsed by default behind a
// compact row whose subtitle is the current choice. Every other supported sort
// (any column, either direction, or none) stays under "All columns". The choice is
// a draft: it applies together with the filters on "Show N orders".

type SortOpt = { key: string; dir: "asc" | "desc"; label: string; hint: string; icon: LucideIcon };

const MAIN_SORTS: SortOpt[] = [
  { key: "expectedDD", dir: "asc", label: "Expected DD", hint: "Soonest first", icon: Calendar },
  { key: "expectedDD", dir: "desc", label: "Expected DD", hint: "Latest first", icon: Calendar },
  { key: "orderDate", dir: "desc", label: "Order Date", hint: "Newest first", icon: CalendarPlus },
  { key: "amount", dir: "desc", label: "Amount", hint: "Highest first", icon: Wallet },
  { key: "amount", dir: "asc", label: "Amount", hint: "Lowest first", icon: Wallet },
  { key: "qty", dir: "desc", label: "Total Qty", hint: "Most first", icon: Package },
  { key: "customer", dir: "asc", label: "Customer", hint: "A – Z", icon: Building2 },
];

const sameSort = (a: Sort, b: { key: string; dir: "asc" | "desc" }) => !!a && a.key === b.key && a.dir === b.dir;

function sortSubtitle(sort: Sort, columns: ColumnDef[]): string {
  if (!sort) return "None · list order";
  const main = MAIN_SORTS.find((o) => sameSort(sort, o));
  if (main) return `${main.label} · ${main.hint}`;
  const label = columns.find((c) => c.key === sort.key)?.label ?? sort.key;
  return `${label} · ${sort.dir === "asc" ? "Ascending" : "Descending"}`;
}

function SortBy({
  columns,
  sort,
  onChange,
}: {
  columns: ColumnDef[];
  sort: Sort;
  onChange: (s: Sort) => void;
}) {
  const options = MAIN_SORTS.filter((o) => columns.some((c) => c.key === o.key));
  const [open, setOpen] = useState(false);
  // A sort that is not one of the seven opens straight to "All columns".
  const [all, setAll] = useState(() => sort != null && !options.some((o) => sameSort(sort, o)));

  return (
    <section aria-label="Sort by">
      <Expander label="Sort by" subtitle={sortSubtitle(sort, columns)} open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? (
        <div
          style={{
            marginTop: 10,
            borderRadius: 14,
            backgroundColor: M.card,
            boxShadow: SHADOW_CONTROL,
            overflow: "hidden",
          }}
        >
          <div role="radiogroup" aria-label="Sort by">
            {options.map((o, i) => {
              const on = sameSort(sort, o);
              const Icon = o.icon;
              return (
                <button
                  key={`${o.key}-${o.dir}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ key: o.key, dir: o.dir })}
                  style={{
                    width: "100%",
                    minHeight: 52,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "0 14px",
                    border: "none",
                    borderTop: i ? `1px solid ${M.divider}` : "none",
                    backgroundColor: on ? M.paper : M.card,
                    textAlign: "left",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 34,
                      height: 34,
                      flex: "none",
                      borderRadius: 10,
                      backgroundColor: on ? "color-mix(in srgb, var(--m-taupe) 16%, transparent)" : M.divider,
                      color: M.taupe,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: on ? 700 : 500, color: M.raisin }}>{o.label}</span>
                    <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>{o.hint}</span>
                  </span>
                  <Check aria-hidden="true" size={18} strokeWidth={2.2} color={M.taupe} style={{ flex: "none", opacity: on ? 1 : 0 }} />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            aria-expanded={all}
            style={{
              width: "100%",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
              border: "none",
              borderTop: `1px solid ${M.divider}`,
              backgroundColor: M.card,
              color: M.taupe,
              fontSize: 13,
              fontWeight: 600,
              textAlign: "left",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ flex: 1 }}>All columns</span>
            <ChevronDown
              size={16}
              strokeWidth={2}
              style={{ transform: all ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
            />
          </button>
          {all ? (
            <div style={{ display: "grid", gap: 10, padding: "4px 14px 14px" }}>
              <select
                aria-label="Sort column"
                value={sort?.key ?? ""}
                onChange={(e) => onChange(e.target.value ? { key: e.target.value, dir: sort?.dir ?? "asc" } : null)}
                style={{
                  width: "100%",
                  height: 44,
                  boxSizing: "border-box",
                  padding: "0 12px",
                  borderRadius: 12,
                  border: `1px solid ${M.hairline}`,
                  backgroundColor: M.paper,
                  color: M.raisin,
                  fontSize: 16,
                }}
              >
                <option value="">None (list order)</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div role="radiogroup" aria-label="Sort direction" style={{ display: "flex", gap: 7, opacity: sort ? 1 : 0.5 }}>
                {(["asc", "desc"] as const).map((dir) => (
                  <Choice
                    key={dir}
                    on={sort?.dir === dir}
                    role="radio"
                    onClick={() => sort && onChange({ key: sort.key, dir })}
                  >
                    {dir === "asc" ? "Ascending" : "Descending"}
                  </Choice>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
