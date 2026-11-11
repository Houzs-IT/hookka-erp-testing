// ===========================================================================
// SalesScreen — L1 Sales Orders list.
//
// Owner 2026-07-02 (v20 React reference `MobileSoList.tsx`): Sales is a bespoke
// list — status chips + a "count · revenue" summary strip + rich cards (Order →
// Expected date row, prominent total, cancelled rows dimmed). This rebuild
// matches the v20 look while keeping the REAL data + the existing sales power
// features (design "A": v20 look + keep function):
//   • same GET /api/sales-orders + the salesConfig source mapping (real fields
//     companySO / customerName / customerPO / totalSen / status…),
//   • KEEPS: ＋ create (FormSheet), Scan-PO OCR, and Filter/Sort sheet,
//   • summary strip shows count + revenue (sum of totalSen); "outstanding" is
//     omitted on the list because the list rows carry no paid figure — we don't
//     fabricate it (it IS shown on the detail, derived from linked payments).
//   • tap a card → /m/sales/:id (unchanged DocumentDetailScreen).
//
// ADDITIVE: replaces ONLY the /m/sales L1 view (CUSTOM_L1 in MobileLayout).
//
// Owner 2026-10-14, PHONE ONLY (<720px; tablet keeps the layout above):
// follows the Claude Design prototype `Sales Orders.dc.html` (premium card
// refresh) for every visual EXCEPT typography, which stays the repo's (sizes,
// weights, text colours of the v20 SoCard — e.g. Amount + meta values 13/600).
//   • borderless shadowed search field with a clear button and the Scan PO
//     tile inside it; borderless Filter button (taupe when active);
//   • borderless chips; a summary card (Revenue · Total Orders) that expands
//     to a per-status breakdown — same revenue rule, Cancelled excluded;
//   • Sort (opens the FilterSheet) + "New SO" row — the header "+" moves here;
//   • PhoneSoCard: 3px status rail, borderless tile pill, customer wraps,
//     "PO · Cust SO" line, inset meta panel (Expected DD · Total Qty ·
//     Amount), Cancelled dimmed.
//
// Owner 2026-10-15, PHONE ONLY: re-arranged to the LIVE prototype (newer than
// the handoff README above; typography still the repo's):
//   • header "+" is back (round gradient) and the Sort + New SO row is gone;
//   • the summary moves to the top as a gradient card (fixed taupe hex, so
//     its white text stays readable in dark mode, where the logo tokens turn
//     light gold), titled after the active chip (superseded 2026-10-26/27 below);
//   • search row = search + Scan PO only; Filter moves to a round
//     button on a new "N ORDERS" row, with removable active-filter chips.
//
// Owner 2026-10-26/27, Sales Orders v3 (Claude Design `Sales Orders v3`, UI only):
//   • order: header, search + Scan PO (ScanLine), status chips (with a status dot),
//     white summary card (revenue + order count, no status-breakdown control), the
//     sort/filter bar, cards;
//   • card: icon tile, SO number + dot pill, 2-line customer, PO / Cust SO chips,
//     Expected DD tag + countdown; no progress bar (the row has no such field).
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Search,
  Plus,
  ScanLine,
  X,
  ArrowDownUp,
  Calendar,
  SearchX,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import {
  MobileHeader,
  FormSheet,
  ResponsiveGrid,
  ScanPOSheet,
} from "../components";
import { M, M_ACCENT, SEMANTIC, titleCaseStatus } from "../theme";
import { salesConfig } from "../config/modules";
import { newSalesOrderSpec, type SOCreatePrefill } from "../config/forms";
import { type FormSpec } from "../config/form-types";
import { type ActiveFilter } from "../config/types";
import {
  resolveStatus,
  STATUS_MAPS,
  str,
  num,
  dateOnly,
  money,
  applyFilters,
  applySort,
  activeFilterCount,
} from "../config/helpers";
import { useDebounced } from "../lib/use-debounced";
import { CHIP_ROW, CHIP_ROW_CLASS, CHIP_COUNT, chip as chipStyle, chipDot } from "../lib/control-styles";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { activeFilterChips, soCountdown, soRefChips, soShortDate, soStage, SO_STAGES } from "../lib/so-card";
import { localToday } from "../lib/so-filter-presets";
import { ListCardShell } from "../components/ListCardShell";
import { CARD_LABEL } from "../lib/list-card-styles";
import { SalesFilterSheet } from "./SalesFilterSheet";

// Sales Orders v3 shadows (Sales Orders v3.dc.html).
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const SHADOW_CHIP_ON = "0 4px 12px -6px rgba(107,92,50,.45)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65),inset 0 1px 0 rgba(255,255,255,.18)";
const SHADOW_FILTER_ON = "0 8px 18px -8px rgba(107,92,50,.6)";

// Status text/dot/icon colour, keyed by the resolved SO_STATUS_COLOR hex. The
// semantic text vars are lifted in dark mode (theme-vars.css), so the pill and
// icon tile stay readable on the dark card; the tint is a mix with transparent
// for the same reason (a fixed light tint would glare on a dark surface).
const STATUS_TEXT: Record<string, string> = {
  "#6B7280": "var(--m-body)", // NEUTRAL
  "#3E6570": "var(--m-text-status-info)", // INFO
  "#4F7C3A": "var(--m-text-status-success)", // SUCCESS
  "#9C6F1E": "var(--m-text-status-warning)", // WARNING
  "#9A3A2D": "var(--m-text-status-danger)", // DANGER
};
function statusTint(hex: string): { bg: string; fg: string } {
  const fg = STATUS_TEXT[hex] ?? hex;
  return { fg, bg: `color-mix(in srgb, ${fg} 14%, transparent)` };
}

// EXPECTED DD box when a countdown label shows (0–7 days): amber, a visual cue only.
const DATE_SOON = statusTint("#9C6F1E");

type Sort = { key: string; dir: "asc" | "desc" } | null;

// v20 status chips (adds "Cancelled" vs the old sub-tabs) → real SO statuses.
const CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "IN_PRODUCTION", label: "In Production" },
  { key: "READY_TO_SHIP", label: "Ready" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" },
];

export function SalesScreen() {
  const navigate = useNavigate();
  // One list UI at every width (owner 2026-10-23): the approved phone design. Wider screens
  // arrange the SAME cards in columns (one column in the split view's list pane) and keep
  // the Sort the tablet list always had, inside the same filter sheet.
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const { id: openId } = useParams();
  const inPane = layout.canSplitDetail && !!openId;
  const columns = tablet && !inPane;
  const source = salesConfig.sources[0];

  const { data, loading, error } = useCachedJson<unknown>(source.url);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [chip, setChip] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, ActiveFilter>>({});
  const [sort, setSort] = useState<Sort>(source.defaultSort ?? null);
  const [createSpec, setCreateSpec] = useState<FormSpec | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const allRows = useMemo(
    () => (data ? source.select(data) : []),
    [data, source],
  );

  const rows = useMemo(() => {
    const byChip = allRows.filter(
      (r) => chip === "all" || str(r, "status") === chip,
    );
    const filtered = applyFilters(byChip, source.columns, filters, dq);
    return applySort(filtered, source.columns, sort);
  }, [allRows, chip, source, filters, dq, sort]);

  // Per-chip counts + the summary strip (count · revenue over the searched set).
  const chipCounts = useMemo(() => {
    const searched = applyFilters(allRows, source.columns, filters, dq);
    const c: Record<string, number> = { all: searched.length };
    for (const r of searched) {
      const s = str(r, "status");
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [allRows, source, filters, dq]);

  const summary = useMemo(() => {
    let rev = 0;
    for (const r of rows) {
      if (str(r, "status") === "CANCELLED") continue;
      rev += num(r, "totalSen");
    }
    return { count: rows.length, rev };
  }, [rows]);

  const fCount = activeFilterCount(filters);
  const fChips = useMemo(
    () => activeFilterChips(filters, source.columns, { today: localToday(), money }),
    [filters, source],
  );
  const openCreate = () => setCreateSpec(newSalesOrderSpec());
  const narrowed = !!q || chip !== "all" || fCount > 0;
  // The main chip and the sheet's Status never disagree — picking a chip replaces any
  // sheet Status filter (lib/so-filter-presets.ts splitStatus).
  const pickChip = (k: string) => {
    setChip(k);
    removeFilter("status");
  };
  const chipLabel = chip === "all" ? "ALL SALES ORDERS" : (CHIPS.find((c) => c.key === chip)?.label ?? "").toUpperCase();
  const heroTitle = fCount > 0 ? (chip === "all" ? "FILTERED SALES ORDERS" : `${chipLabel} · FILTERED`) : chipLabel;
  const removeFilter = (key: string) =>
    setFilters((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });

  const today = localToday();
  const cards = rows.map((r) => (
    <PhoneSoCard
      today={today}
      key={str(r, "id", "companySO") || str(r, "companySO")}
      r={r}
      onClick={() => navigate(`/m/sales/${encodeURIComponent(str(r, "id", "companySO", "companySOId"))}`)}
    />
  ));

  return (
    <>
      <MobileHeader
        title="Sales Orders"
        onBack={() => navigate(-1)}
        menu
        trailing={<PhoneNewButton onClick={openCreate} />}
      />

      <>
        <PhoneSearchRow q={q} setQ={setQ} onScan={() => setScanOpen(true)} />
        <PhoneChips chip={chip} setChip={pickChip} counts={chipCounts} />
        {data ? <PhoneSummary title={heroTitle} count={summary.count} rev={summary.rev} /> : null}
        <PhoneListBar
          count={data ? rows.length : null}
          fCount={fCount}
          onFilter={() => setFilterOpen(true)}
        />
        {fChips.length > 0 ? (
          <PhoneActiveFilters
            chips={fChips}
            onRemove={removeFilter}
            onClear={() => setFilters({})}
          />
        ) : null}
      </>

      {loading && !data ? (
        <Msg text="Loading…" />
      ) : error && !data ? (
        <Msg text="Couldn’t load sales orders." />
      ) : rows.length === 0 ? (
        <Msg
          text={narrowed ? "No matching sales orders." : "No sales orders. Tap ＋ to create one."}
          icon
          onReset={
            narrowed
              ? () => {
                  setQ("");
                  setChip("all");
                  setFilters({});
                  setSort(source.defaultSort ?? null);
                }
              : undefined
          }
        />
      ) : columns ? (
        <ResponsiveGrid gap={11} style={{ padding: "8px 18px 120px" }}>
          {cards}
        </ResponsiveGrid>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: "8px 18px 120px" }}>{cards}</div>
      )}

      <SalesFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        columns={source.columns}
        rows={allRows}
        search={dq}
        filters={filters}
        chip={chip}
        chipKeys={CHIPS.map((c) => c.key).filter((k) => k !== "all")}
        // The sort button opens this sheet at every width, so it always carries the Sort section.
        withSort
        sort={sort}
        sortDefault={source.defaultSort ?? null}
        onApply={(nextFilters, nextChip, nextSort) => {
          setFilters(nextFilters);
          setChip(nextChip);
          if (nextSort !== undefined) setSort(nextSort);
        }}
      />
      <FormSheet
        open={createSpec != null}
        onClose={() => setCreateSpec(null)}
        spec={createSpec}
        onSaved={(to) => {
          setCreateSpec(null);
          if (to) navigate(to);
        }}
      />
      <ScanPOSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(extracted, sampleId) => {
          setScanOpen(false);
          const prefill: SOCreatePrefill = {
            customerId: extracted.customerId ?? "",
            customerPOId: extracted.customerPO ?? "",
            customerSOId: extracted.customerSO ?? extracted.yourRefNo ?? "",
            customerDeliveryDate: (extracted.deliveryDate ?? "").slice(0, 10),
            hookkaExpectedDD: (extracted.deliveryDate ?? "").slice(0, 10),
            items: extracted.items,
            // OCR accuracy: report the FINAL imported values on submit.
            scanSampleId: sampleId,
            scanRaw: extracted as unknown as Record<string, unknown>,
          };
          setCreateSpec(newSalesOrderSpec(prefill));
        }}
      />
    </>
  );
}

// ---- Phone (Claude Design prototype, owner 2026-10-14). -------------------

/** Pressed state for touch feedback (inline styles have no :active). */
function usePressed() {
  const [pressed, setPressed] = useState(false);
  const on = () => setPressed(true);
  const off = () => setPressed(false);
  return {
    pressed,
    handlers: {
      onPointerDown: on,
      onPointerUp: off,
      onPointerLeave: off,
      onPointerCancel: off,
    },
  };
}

function PhoneSearchRow({
  q,
  setQ,
  onScan,
}: {
  q: string;
  setQ: (v: string) => void;
  onScan: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "14px 18px 4px", minWidth: 0 }}>
      <label
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 44,
          padding: "0 4px 0 13px",
          boxSizing: "border-box",
          backgroundColor: M.card,
          borderRadius: 14,
          boxShadow: SHADOW_CONTROL,
        }}
      >
        <Search size={18} strokeWidth={1.75} color={M.muted} style={{ flexShrink: 0 }} />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          placeholder="Search SO · customer · PO"
          aria-label="Search sales orders"
          onChange={(e) => setQ(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            padding: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 16,
            color: M.raisin,
            textOverflow: "ellipsis",
          }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            style={{
              width: 32,
              height: 44,
              flexShrink: 0,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: M.muted,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                backgroundColor: M.divider,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={13} strokeWidth={2.4} />
            </span>
          </button>
        ) : null}
        {/* Scan treatment shared with Invoices (parts.tsx SearchPill): hairline divider +
            a 36x44 plain button, ScanLine 18/1.75 in M.ink. Opens the Scan-PO sheet. */}
        <span aria-hidden="true" style={{ width: 1, height: 20, background: "var(--m-inv-line)", flexShrink: 0 }} />
        <button
          type="button"
          onClick={onScan}
          aria-label="Scan customer PO"
          title="Scan PO"
          style={{
            width: 36,
            height: 44,
            flexShrink: 0,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            color: M.ink,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
            position: "relative",
          }}
        >
          <ScanLine size={18} strokeWidth={1.75} />
        </button>
      </label>
    </div>
  );
}

function PhoneChips({
  chip,
  setChip,
  counts,
}: {
  chip: string;
  setChip: (k: string) => void;
  counts: Record<string, number>;
}) {
  // Handoff filter chips (lib/control-styles.ts, owner 2026-10-21).
  return (
    <div className={CHIP_ROW_CLASS} style={CHIP_ROW}>
      {CHIPS.map((c) => {
        const on = chip === c.key;
        const n = counts[c.key] ?? 0;
        return (
          <button key={c.key} type="button" onClick={() => setChip(c.key)} aria-pressed={on} style={chipStyle(on)}>
            {c.key !== "all" ? (
              <span
                aria-hidden="true"
                style={chipDot(statusTint(resolveStatus(c.key, STATUS_MAPS.so).style.hex).fg)}
              />
            ) : null}
            {c.label}
            {n > 0 ? <span style={CHIP_COUNT}>{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function PhoneSummary({
  title,
  count,
  rev,
}: {
  title: string;
  count: number;
  rev: number;
}) {
  // Money is never ellipsised (owner 2026-10-15): the figure is nowrap and
  // flex:none, and its row wraps rather than clips if a value is ever wider
  // than the card. "RM" is split off only to render it as the small prefix.
  // Revenue excludes Cancelled (summary memo in SalesScreen); the count does not.
  const split = /^RM\s*(.*)$/.exec(money(rev));
  const figure = split ? split[1] : money(rev);

  return (
    <div style={{ padding: "14px 18px 6px" }}>
      <div
        role="status"
        style={{
          borderRadius: 20,
          backgroundColor: M.card,
          boxShadow: SHADOW_CARD,
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "15px 16px 14px" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              minWidth: 0,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              color: M.taupe,
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 14, height: 3, flex: "none", borderRadius: 2, backgroundColor: M.gold }}
            />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          </span>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              columnGap: 5,
              marginTop: 8,
              minWidth: 0,
            }}
          >
            {split ? <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>RM</span> : null}
            <span
              style={{
                flex: "none",
                fontSize: 27,
                lineHeight: 1.1,
                fontWeight: 700,
                letterSpacing: "-0.6px",
                color: M.raisin,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {figure}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
            {count} {count === 1 ? "order" : "orders"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Round gradient "+" for the phone header (prototype); same FormSheet. */
function PhoneNewButton({ onClick }: { onClick: () => void }) {
  const { pressed, handlers } = usePressed();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="New Sales Order"
      title="New SO"
      {...handlers}
      style={{
        width: 44,
        height: 44,
        flex: "none",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 999,
          background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
          color: M.paper,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: SHADOW_PRIMARY,
          opacity: pressed ? 0.86 : 1,
        }}
      >
        <Plus size={20} strokeWidth={2.2} />
      </span>
    </button>
  );
}

/** "N ORDERS" ── round Filter button (opens the phone SalesFilterSheet; filter only). */
function PhoneListBar({
  count,
  fCount,
  onFilter,
}: {
  count: number | null;
  fCount: number;
  onFilter: () => void;
}) {
  const active = fCount > 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 15px 1px 18px",
      }}
    >
      {count != null ? (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: M.taupe,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count} {count === 1 ? "ORDER" : "ORDERS"}
        </span>
      ) : null}
      <span style={{ flex: 1, minWidth: 8, height: 1, backgroundColor: M.hairline }} />
      <button
        type="button"
        onClick={onFilter}
        aria-label={active ? `Sort and filter orders, ${fCount} filters active` : "Sort and filter orders"}
        aria-haspopup="dialog"
        title="Sort and filter orders"
        style={{
          width: 44,
          height: 44,
          flex: "none",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            position: "relative",
            width: 38,
            height: 38,
            borderRadius: 999,
            backgroundColor: active ? M.taupe : M.card,
            color: active ? M.paper : M.taupe,
            boxShadow: active ? SHADOW_FILTER_ON : SHADOW_CONTROL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowDownUp size={16} strokeWidth={1.9} />
          {active ? (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                minWidth: 17,
                height: 17,
                padding: "0 4px",
                boxSizing: "border-box",
                borderRadius: 999,
                backgroundColor: SEMANTIC.DANGER.hex,
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 0 0 2px ${M.paper}`,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fCount}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

/** Removable chips for the active FilterSheet filters + "Clear all". */
function PhoneActiveFilters({
  chips,
  onRemove,
  onClear,
}: {
  chips: { key: string; label: string }[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: "6px 18px 2px",
      }}
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onRemove(c.key)}
          aria-label={`Remove filter: ${c.label}`}
          style={{
            height: 30,
            maxWidth: "100%",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "0 10px 0 12px",
            borderRadius: 999,
            border: "none",
            backgroundColor: M_ACCENT.gold.bg,
            color: M.taupe,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            boxShadow: SHADOW_CHIP_ON,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
          <X size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        style={{
          height: 30,
          padding: "0 6px",
          border: "none",
          background: "transparent",
          color: M.taupe,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        Clear all
      </button>
    </div>
  );
}

// Sales Orders v4 card (owner 2026-10-27): the SAME card as Invoices v2, through the
// shared ListCardShell — rail, code + pill + chevron, customer, ref chips, a bar
// slot, then the EXPECTED DD box and the AMOUNT box. The press scale and the
// Cancelled dimming sit on a wrapper because the shell takes no pointer handlers.
// Everything shown is a field the list row already carries. The stage bar is the
// order's position in the status lifecycle (soStage), NOT production progress.
function PhoneSoCard({
  r,
  today,
  onClick,
}: {
  r: Record<string, unknown>;
  today: string;
  onClick: () => void;
}) {
  const { pressed, handlers } = usePressed();
  const code = str(r, "companySO", "companySOId", "company_so", "company_so_id") || "—";
  const customer = str(r, "customerName") || "—";
  const refs = soRefChips(r);
  const expected = dateOnly(r, "hookkaExpectedDD");
  const total = num(r, "totalSen");
  const statusKey = str(r, "status");
  const cancelled = statusKey === "CANCELLED";
  const status = resolveStatus(statusKey, STATUS_MAPS.so);
  const tint = statusTint(status.style.hex);
  const cd = soCountdown(expected, statusKey, today);
  const soon = cd.tone === "soon";
  const stage = soStage(statusKey);
  const label = titleCaseStatus(status.label);
  const keyColor = soon ? DATE_SOON.fg : M.ink;

  return (
    <div
      {...handlers}
      style={{
        transform: pressed ? "scale(.985)" : "none",
        transition: "transform .12s ease",
        opacity: cancelled ? 0.55 : 1,
      }}
    >
      <ListCardShell
        rail={status.style.hex}
        code={code}
        codeStyle={{ flexShrink: 1, minWidth: 0, fontSize: 14, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis" }}
        pill={<TilePill tint={tint} label={status.label} />}
        party={customer}
        partyGap={6}
        refs={refs}
        middle={
          stage ? (
            <div style={{ marginTop: 10 }}>
              <div
                aria-hidden="true"
                style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 3 }}
              >
                {SO_STAGES.map((k, i) => (
                  <span
                    key={k}
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background:
                        i + 1 < stage.n
                          ? `color-mix(in srgb, ${tint.fg} 45%, transparent)`
                          : i + 1 === stage.n
                            ? tint.fg
                            : "var(--m-segment-track)",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  marginTop: 5,
                  fontSize: 11.5,
                  color: M.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Stage <span style={{ fontWeight: 700, color: tint.fg }}>{label}</span>
                </span>
                <span style={{ flex: "none", whiteSpace: "nowrap" }}>
                  Stage {stage.n} of {stage.total}
                </span>
              </div>
            </div>
          ) : null
        }
        left={{
          bg: soon ? DATE_SOON.bg : M.paper,
          children: (
            <>
              <span
                style={{
                  ...CARD_LABEL,
                  fontWeight: 700,
                  color: keyColor,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Calendar size={12} strokeWidth={2} aria-hidden="true" />
                EXPECTED DD
              </span>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: M.raisin,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {soShortDate(expected) || "—"}
                {cd.text ? <span style={{ fontWeight: 600, color: keyColor }}> · {cd.text}</span> : null}
              </div>
            </>
          ),
        }}
        right={{ label: "AMOUNT", value: money(total) }}
        ariaLabel={`${code}, ${customer}, ${label}, ${money(total)}`}
        onOpen={onClick}
      />
    </div>
  );
}

/** Status pill: 6px dot in the status colour + label (v3). */
function TilePill({ tint, label }: { tint: { bg: string; fg: string }; label: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "0 9px",
        borderRadius: 9999,
        backgroundColor: tint.bg,
        color: tint.fg,
        fontSize: 11,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: tint.fg }}
      />
      {titleCaseStatus(label)}
    </span>
  );
}

/** The prototype empty state (icon + reset button). */
function Msg({
  text,
  icon,
  onReset,
}: {
  text: string;
  icon?: boolean;
  onReset?: () => void;
}) {
  return (
    <div
      style={{
        padding: icon ? "44px 18px" : "40px 18px",
        textAlign: "center",
        color: M.body,
        fontSize: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: icon ? 14 : 12,
      }}
    >
      {icon ? (
        <span
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            backgroundColor: M.divider,
            color: M.taupe,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SearchX size={22} strokeWidth={1.75} />
        </span>
      ) : null}
      {text}
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            height: 44,
            padding: "0 18px",
            borderRadius: 999,
            border: "none",
            backgroundColor: M.card,
            color: M.ink,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: SHADOW_CONTROL,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Reset search &amp; filters
        </button>
      ) : null}
    </div>
  );
}
