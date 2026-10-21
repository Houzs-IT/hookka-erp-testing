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
//     light gold), titled after the active chip, "By status" breakdown;
//   • search row = search + Scan PO only; Filter moves to a round
//     button on a new "N ORDERS" row, with removable active-filter chips.
// ===========================================================================
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  Plus,
  FileSearch,
  ChevronRight,
  ChevronDown,
  X,
  ArrowDownUp,
  Calendar,
  Package,
  Wallet,
  ShoppingCart,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import {
  MobileCard,
  MobileHeader,
  StatusPill,
  FilterSheet,
  FormSheet,
  ScanPOSheet,
} from "../components";
import { M, M_ACCENT, SEMANTIC, titleCaseStatus, type SemanticStyle } from "../theme";
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
import { CHIP_ROW, CHIP_ROW_CLASS, CHIP_COUNT, chip as chipStyle } from "../lib/control-styles";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { activeFilterChips, soRefLine, soTotalQty } from "../lib/so-card";
import { localToday } from "../lib/so-filter-presets";
import { SalesFilterSheet } from "./SalesFilterSheet";

// Prototype shadows (Sales Orders.dc.html).
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 30px -14px rgba(31,29,27,.24)";
const SHADOW_CHIP_ON = "0 4px 12px -6px rgba(107,92,50,.45)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65),inset 0 1px 0 rgba(255,255,255,.18)";
const SHADOW_FILTER_ON = "0 8px 18px -8px rgba(107,92,50,.6)";
const SHADOW_HERO = "0 16px 32px -18px rgba(107,92,50,.75),inset 0 1px 0 rgba(255,255,255,.14)";
// Fixed light-theme taupe gradient (not M.logoFrom/To): in dark mode those
// turn light gold and the hero's white text would lose contrast.
const HERO_BG = "linear-gradient(140deg,#8B7A4E 0%,#6B5C32 62%)";
// Prototype KPI columns; KPI_FIXED = the two 14px gaps + the 1px divider.
const KPI_COLS = "minmax(0,1.4fr) 1px minmax(0,.9fr)";
const KPI_FIXED = 29;
// Repo label colour (v20 SoCard / DocCard).
const LABEL = "#A89F8D";

// Borderless tile pill backgrounds, keyed by the resolved SO_STATUS_COLOR hex
// (prototype values). The text colour stays the semantic hex, as StatusPill.
const PILL_TILE_BG: Record<string, string> = {
  "#6B7280": "#EEEBE6", // NEUTRAL
  "#3E6570": "#E0EDF0", // INFO
  "#4F7C3A": "#EEF3E4", // SUCCESS
  "#9C6F1E": "#FAEFCB", // WARNING
  "#9A3A2D": "#F9E1DA", // DANGER
};

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
  const phone = useResponsiveLayout().mode === "phone";
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
  const [summaryOpen, setSummaryOpen] = useState(false);

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
  const narrowed = !!q || chip !== "all" || (phone && fCount > 0);
  // Phone: the main chip and the sheet's Status never disagree — picking a chip
  // replaces any sheet Status filter (lib/so-filter-presets.ts splitStatus).
  const pickChip = (k: string) => {
    setChip(k);
    if (phone) removeFilter("status");
  };
  const chipLabel = chip === "all" ? "ALL SALES ORDERS" : (CHIPS.find((c) => c.key === chip)?.label ?? "").toUpperCase();
  const heroTitle = fCount > 0 ? (chip === "all" ? "FILTERED SALES ORDERS" : `${chipLabel} · FILTERED`) : chipLabel;
  const removeFilter = (key: string) =>
    setFilters((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });

  return (
    <>
      <MobileHeader
        title="Sales Orders"
        onBack={() => navigate(-1)}
        menu
        trailing={
          phone ? (
            <PhoneNewButton onClick={openCreate} />
          ) : (
          <button
            onClick={openCreate}
            aria-label="New Sales Order"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "none",
              backgroundColor: M.taupe,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Plus size={20} strokeWidth={2.2} />
          </button>
          )
        }
      />

      {phone ? (
        <>
          {data ? (
            <PhoneSummary
              title={heroTitle}
              rows={rows}
              count={summary.count}
              rev={summary.rev}
              open={summaryOpen}
              onToggle={() => setSummaryOpen((o) => !o)}
            />
          ) : null}
          <PhoneSearchRow q={q} setQ={setQ} onScan={() => setScanOpen(true)} />
          <PhoneChips chip={chip} setChip={pickChip} counts={chipCounts} />
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
      ) : (
      <>
      {/* Search + Scan PO + Filter */}
      <div style={{ display: "flex", gap: 7, padding: "12px 18px 4px", minWidth: 0 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "11px 13px",
            backgroundColor: M.card,
            border: `1px solid ${M.hairline}`,
            borderRadius: 12,
          }}
        >
          <Search size={18} strokeWidth={1.75} color={M.faint} />
          <input
            value={q}
            placeholder="Search SO · customer · PO · reference"
            onChange={(e) => setQ(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 14,
              color: M.raisin,
            }}
          />
        </div>
        <button
          onClick={() => setScanOpen(true)}
          aria-label="Scan customer PO"
          style={{
            width: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: M.taupe,
            border: `1px solid ${M.taupe}`,
            borderRadius: 12,
            color: "#fff",
            cursor: "pointer",
            flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <FileSearch size={19} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => setFilterOpen(true)}
          aria-label="Filter and sort"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: fCount > 0 ? undefined : 44,
            padding: fCount > 0 ? "0 14px" : 0,
            backgroundColor: fCount > 0 ? M.taupe : M.card,
            border: `1px solid ${fCount > 0 ? M.taupe : M.hairline}`,
            borderRadius: 12,
            color: fCount > 0 ? "#fff" : M.ink,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <SlidersHorizontal size={19} strokeWidth={1.75} />
          {fCount > 0 ? fCount : ""}
        </button>
      </div>

      {/* Status chips — handoff chip style (lib/control-styles.ts, owner
          2026-10-21); the tablet row keeps its own 10px top spacing. */}
      <div className={CHIP_ROW_CLASS} style={{ ...CHIP_ROW, padding: "10px 18px 4px" }}>
        {CHIPS.map((c) => {
          const on = chip === c.key;
          const n = chipCounts[c.key] ?? 0;
          return (
            <button key={c.key} type="button" onClick={() => setChip(c.key)} aria-pressed={on} style={chipStyle(on)}>
              {c.label}
              {n > 0 ? <span style={CHIP_COUNT}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Summary strip — count · revenue */}
      {rows.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            flexWrap: "wrap",
            fontSize: 11.5,
            color: M.muted,
            padding: "10px 20px 2px",
          }}
        >
          <span>
            <b style={{ color: M.raisin }}>{summary.count}</b> orders
          </span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ fontWeight: 700, color: M.raisin }}>
            {money(summary.rev)} rev
          </span>
        </div>
      ) : null}
      </>
      )}

      {loading && !data ? (
        <Msg text="Loading…" />
      ) : error && !data ? (
        <Msg text="Couldn’t load sales orders." />
      ) : rows.length === 0 ? (
        <Msg
          text={narrowed ? "No matching sales orders." : "No sales orders. Tap ＋ to create one."}
          icon={phone}
          onReset={
            phone && narrowed
              ? () => {
                  setQ("");
                  setChip("all");
                  setFilters({});
                  setSort(source.defaultSort ?? null);
                }
              : undefined
          }
        />
      ) : phone ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: "8px 18px 120px" }}>
          {rows.map((r) => (
            <PhoneSoCard
              key={str(r, "id", "companySO") || str(r, "companySO")}
              r={r}
              onClick={() =>
                navigate(
                  `/m/sales/${encodeURIComponent(str(r, "id", "companySO", "companySOId"))}`,
                )
              }
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: "8px 18px 120px" }}>
          {rows.map((r) => (
            <SoCard
              key={str(r, "id", "companySO") || str(r, "companySO")}
              r={r}
              onClick={() =>
                navigate(
                  `/m/sales/${encodeURIComponent(str(r, "id", "companySO", "companySOId"))}`,
                )
              }
            />
          ))}
        </div>
      )}

      {phone ? (
        <SalesFilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          columns={source.columns}
          rows={allRows}
          search={dq}
          filters={filters}
          chip={chip}
          chipKeys={CHIPS.map((c) => c.key).filter((k) => k !== "all")}
          onApply={(nextFilters, nextChip) => {
            setFilters(nextFilters);
            setChip(nextChip);
          }}
        />
      ) : (
        <FilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          columns={source.columns}
          filters={filters}
          sort={sort}
          onApply={(nextFilters, nextSort) => {
            setFilters(nextFilters);
            setSort(nextSort);
          }}
        />
      )}
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
          gap: 8,
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
        <button
          type="button"
          onClick={onScan}
          aria-label="Scan customer PO"
          title="Scan PO"
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
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
              width: 34,
              height: 34,
              borderRadius: 9,
              backgroundColor: M_ACCENT.gold.bg,
              color: M.taupe,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FileSearch size={18} strokeWidth={1.75} />
          </span>
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
  rows,
  count,
  rev,
  open,
  onToggle,
}: {
  title: string;
  rows: Record<string, unknown>[];
  count: number;
  rev: number;
  open: boolean;
  onToggle: () => void;
}) {
  // One row per status present in the visible list, in SO lifecycle order;
  // Cancelled is listed but its revenue is excluded (same rule as the total).
  const breakdown = useMemo(() => {
    const by = new Map<string, { n: number; rev: number }>();
    for (const r of rows) {
      const s = str(r, "status").toUpperCase();
      const b = by.get(s) ?? { n: 0, rev: 0 };
      b.n += 1;
      b.rev += num(r, "totalSen");
      by.set(s, b);
    }
    const order = Object.keys(STATUS_MAPS.so);
    return [...by.entries()]
      .sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
      })
      .map(([key, b]) => ({ key, ...b }));
  }, [rows]);

  // Money is never ellipsised (owner 2026-10-15): when either value is wider
  // than its 1.4fr / .9fr column, the two figures stack full-width instead.
  // The value spans are inline-block + nowrap, so offsetWidth is their natural
  // width whatever the current layout; re-checked on resize and value change.
  const boxRef = useRef<HTMLDivElement>(null);
  const revRef = useRef<HTMLSpanElement>(null);
  const cntRef = useRef<HTMLSpanElement>(null);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const check = () => {
      const avail = box.clientWidth - KPI_FIXED;
      const revW = revRef.current?.offsetWidth ?? 0;
      const cntW = cntRef.current?.offsetWidth ?? 0;
      setStacked(revW > (avail * 1.4) / 2.3 || cntW > (avail * 0.9) / 2.3);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(box);
    return () => ro.disconnect();
  }, [rev, count]);

  return (
    <div style={{ padding: "6px 18px 0" }}>
      <div
        role="status"
        style={{
          borderRadius: 20,
          background: HERO_BG,
          boxShadow: SHADOW_HERO,
          color: "#fff",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 16px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <SummaryLabel color="rgba(255,255,255,.88)">{title}</SummaryLabel>
            <button
              type="button"
              onClick={onToggle}
              aria-label={open ? "Hide status breakdown" : "Show status breakdown"}
              aria-expanded={open}
              style={{
                flex: "none",
                height: 44,
                margin: "-12px -6px -12px 0",
                padding: 0,
                display: "flex",
                alignItems: "center",
                background: "none",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                style={{
                  height: 28,
                  padding: "0 8px 0 10px",
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,.14)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                By status
                <ChevronDown
                  size={14}
                  strokeWidth={2.2}
                  style={{
                    transform: open ? "rotate(180deg)" : "none",
                    transition: "transform .18s ease",
                  }}
                />
              </span>
            </button>
          </div>
          <div
            ref={boxRef}
            style={{
              display: "grid",
              gridTemplateColumns: stacked ? "minmax(0,1fr)" : KPI_COLS,
              gap: 14,
              marginTop: 12,
              alignItems: "stretch",
            }}
          >
            <HeroFigure icon={Wallet} label="REVENUE" value={money(rev)} valueRef={revRef} />
            <div style={{ backgroundColor: "rgba(255,255,255,.2)", height: stacked ? 1 : undefined }} />
            <HeroFigure icon={ShoppingCart} label="TOTAL ORDERS" value={String(count)} valueRef={cntRef} />
          </div>
        </div>
        {open && breakdown.length > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 9,
              padding: "12px 16px 14px",
              backgroundColor: "rgba(31,29,27,.14)",
            }}
          >
            {breakdown.map((b) => (
              <div
                key={b.key}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    backgroundColor: "#fff",
                    opacity: b.key === "CANCELLED" ? 0.45 : 1,
                    flex: "none",
                  }}
                />
                {/* Name wraps on narrow phones rather than truncating; the count and
                    amount keep fixed right-aligned columns so the figures line up. */}
                <span style={{ flex: 1, minWidth: 0, color: "#fff", overflowWrap: "anywhere" }}>
                  {titleCaseStatus(b.key || "—")}
                </span>
                <span
                  style={{
                    width: 36,
                    flex: "none",
                    textAlign: "right",
                    color: "rgba(255,255,255,.8)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {b.n}
                </span>
                <span
                  style={{
                    minWidth: 108,
                    flex: "none",
                    textAlign: "right",
                    fontWeight: 600,
                    color: "#fff",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.key === "CANCELLED" ? "excluded" : money(b.rev)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One hero figure: icon tile, value (repo 20/700), label below (repo 10/600). */
function HeroFigure({
  icon: Icon,
  label,
  value,
  valueRef,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: "rgba(255,255,255,.16)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={16} strokeWidth={1.9} color="#fff" />
      </span>
      <div style={{ marginTop: 10 }}>
        <span
          ref={valueRef}
          style={{
            display: "inline-block",
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.3px",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <SummaryLabel color="rgba(255,255,255,.9)">{label}</SummaryLabel>
      </div>
    </div>
  );
}

function SummaryLabel({ children, color }: { children: string; color: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {children}
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
            color: M.muted,
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
        aria-label={active ? `Filter orders, ${fCount} active` : "Filter orders"}
        aria-haspopup="dialog"
        title="Filter orders"
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

// MobileCard is reused as-is; border, shadow, rail and padding go through its
// `style` prop only, so no other module's card changes. The press scale sits
// on a wrapper because MobileCard takes no pointer handlers.
function PhoneSoCard({
  r,
  onClick,
}: {
  r: Record<string, unknown>;
  onClick: () => void;
}) {
  const { pressed, handlers } = usePressed();
  const code = str(r, "companySO", "companySOId") || "—";
  const customer = str(r, "customerName") || "—";
  const refLine = soRefLine(r);
  const expected = dateOnly(r, "hookkaExpectedDD");
  const qty = soTotalQty(r);
  const total = num(r, "totalSen");
  const cancelled = str(r, "status") === "CANCELLED";
  const status = resolveStatus(str(r, "status"), STATUS_MAPS.so);

  return (
    <div
      {...handlers}
      style={{
        transform: pressed ? "scale(.985)" : "none",
        transition: "transform .12s ease",
      }}
    >
      <MobileCard
        onClick={onClick}
        padded={false}
        radius={16}
        style={{
          position: "relative",
          overflow: "hidden",
          border: "none",
          padding: "14px 14px 14px 18px",
          boxShadow: SHADOW_CARD,
          opacity: cancelled ? 0.55 : 1,
        }}
      >
        {/* Status rail — colour from the same map as the pill. */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: status.style.hex,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 700,
              color: M.taupe,
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {code}
          </span>
          <TilePill style={status.style} label={status.label} />
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 15,
              fontWeight: 700,
              color: M.raisin,
              letterSpacing: "-0.2px",
              overflowWrap: "anywhere",
            }}
          >
            {customer}
          </span>
          <ChevronRight
            aria-hidden="true"
            size={19}
            strokeWidth={1.75}
            color="#C4BDB2"
            style={{ flexShrink: 0, marginTop: 1 }}
          />
        </div>

        {refLine ? (
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: M.taupe,
              marginTop: 2,
              overflowWrap: "anywhere",
            }}
          >
            {refLine}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,.7fr) auto",
            columnGap: 10,
            alignItems: "end",
            marginTop: 12,
            padding: "10px 12px",
            backgroundColor: M.paper,
            borderRadius: 12,
          }}
        >
          <Metric icon={Calendar} label="EXPECTED DD" value={expected || "—"} />
          <Metric icon={Package} label="TOTAL QTY" value={qty == null ? "—" : String(qty)} />
          <Metric icon={Wallet} label="AMOUNT" value={money(total)} align="right" />
        </div>
      </MobileCard>
    </div>
  );
}

/** Borderless status pill (prototype "tile"); StatusPill's sm typography. */
function TilePill({ style, label }: { style: SemanticStyle; label: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 9999,
        padding: "1px 8px",
        backgroundColor: PILL_TILE_BG[style.hex] ?? M.divider,
        color: style.hex,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.3,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {titleCaseStatus(label)}
    </span>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  align,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  align?: "right";
}) {
  return (
    <div style={{ minWidth: 0, textAlign: align }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: align === "right" ? "flex-end" : undefined,
          gap: 4,
          fontSize: 10,
          fontWeight: 600,
          color: LABEL,
          whiteSpace: "nowrap",
        }}
      >
        <Icon size={12} strokeWidth={1.75} style={{ flexShrink: 0 }} />
        {label}
      </div>
      <div
        style={{
          marginTop: 3,
          fontSize: 13,
          fontWeight: 600,
          color: M.raisin,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---- One SO card (v20 MobileSoList layout; tablet). ------------------------
function SoCard({
  r,
  onClick,
}: {
  r: Record<string, unknown>;
  onClick: () => void;
}) {
  const code = str(r, "companySO", "companySOId") || "—";
  const customer = str(r, "customerName") || "—";
  const custPO = str(r, "customerPO", "customerPOId");
  const custSO = str(r, "customerSO", "customerSOId");
  const orderDate = dateOnly(r, "companySODate");
  const expected = dateOnly(r, "hookkaExpectedDD");
  const total = num(r, "totalSen");
  const cancelled = str(r, "status") === "CANCELLED";
  const status = resolveStatus(str(r, "status"), STATUS_MAPS.so);

  const sub = [custPO ? `PO ${custPO}` : "", custSO ? `Cust SO ${custSO}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        background: M.card,
        border: `1px solid ${M.border}`,
        borderRadius: 16,
        padding: "13px 15px",
        marginBottom: 11,
        cursor: "pointer",
        opacity: cancelled ? 0.55 : 1,
        boxShadow: "0 1px 0 rgba(31,29,27,.03),0 6px 20px -12px rgba(31,29,27,.14)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 700,
            color: M.taupe,
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {code}
        </span>
        <StatusPill style={status.style} label={status.label} size="sm" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            fontWeight: 700,
            color: M.raisin,
            letterSpacing: "-0.2px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {customer}
        </span>
        <ChevronRight
          aria-hidden="true"
          size={19}
          strokeWidth={1.75}
          color="#C4BDB2"
          style={{ flexShrink: 0 }}
        />
      </div>
      {sub ? (
        <div
          style={{
            fontSize: 12.5,
            color: M.taupe,
            fontWeight: 500,
            marginTop: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto",
          columnGap: 8,
          alignItems: "end",
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${M.divider}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#A89F8D", fontWeight: 600, whiteSpace: "nowrap" }}>
            ORDER DATE
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 13,
              fontWeight: 600,
              color: M.raisin,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {orderDate || "—"}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#A89F8D", fontWeight: 600, whiteSpace: "nowrap" }}>
            EXPECTED DD
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 13,
              fontWeight: 600,
              color: M.raisin,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {expected || "—"}
          </div>
        </div>
        <div style={{ minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#A89F8D", fontWeight: 600, whiteSpace: "nowrap" }}>
            AMOUNT
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 13,
              fontWeight: 600,
              color: M.raisin,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {money(total)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Phone (icon): prototype empty state; the reset button only renders on phones. */
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
        color: M.muted,
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
