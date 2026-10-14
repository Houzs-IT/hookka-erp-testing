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
// ===========================================================================
import { useMemo, useState } from "react";
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
import { M, M_ACCENT, titleCaseStatus, type SemanticStyle } from "../theme";
import { salesConfig } from "../config/modules";
import { newSalesOrderSpec, type SOCreatePrefill } from "../config/forms";
import { type FormSpec } from "../config/form-types";
import { type ActiveFilter, type ColumnDef } from "../config/types";
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
import { useResponsiveLayout } from "../lib/responsive-layout";
import { soRefLine, soTotalQty } from "../lib/so-card";

// Prototype shadows (Sales Orders.dc.html).
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const SHADOW_SUMMARY = "0 1px 2px rgba(31,29,27,.05),0 10px 28px -12px rgba(31,29,27,.20)";
const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 30px -14px rgba(31,29,27,.24)";
const SHADOW_CHIP = "0 1px 2px rgba(31,29,27,.06),0 3px 8px -4px rgba(31,29,27,.10)";
const SHADOW_CHIP_ON = "0 4px 12px -6px rgba(107,92,50,.45)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65),inset 0 1px 0 rgba(255,255,255,.18)";
const SHADOW_FILTER_ON = "0 8px 18px -8px rgba(107,92,50,.6)";
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
  const openCreate = () => setCreateSpec(newSalesOrderSpec());
  const narrowed = !!q || chip !== "all" || (phone && fCount > 0);

  return (
    <>
      <MobileHeader
        title="Sales Orders"
        onBack={() => navigate(-1)}
        menu
        trailing={
          phone ? undefined : (
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
          <PhoneSearchRow
            q={q}
            setQ={setQ}
            fCount={fCount}
            onScan={() => setScanOpen(true)}
            onFilter={() => setFilterOpen(true)}
          />
          <PhoneChips chip={chip} setChip={setChip} counts={chipCounts} />
          {data ? (
            <PhoneSummary
              rows={rows}
              count={summary.count}
              rev={summary.rev}
              open={summaryOpen}
              onToggle={() => setSummaryOpen((o) => !o)}
            />
          ) : null}
          <PhoneSortRow
            sort={sort}
            columns={source.columns}
            onSort={() => setFilterOpen(true)}
            onNew={openCreate}
          />
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

      {/* Status chips */}
      <div
        style={{
          display: "flex",
          gap: 7,
          overflowX: "auto",
          padding: "10px 18px 4px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {CHIPS.map((c) => {
          const on = chip === c.key;
          const n = chipCounts[c.key] ?? 0;
          return (
            <button
              key={c.key}
              onClick={() => setChip(c.key)}
              style={{
                height: 30,
                padding: "0 13px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                flex: "none",
                cursor: "pointer",
                border: `1px solid ${on ? M.taupe : M.hairline}`,
                background: on ? M_ACCENT.gold.bg : M.card,
                color: on ? M.taupe : M.muted,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {c.label}
              {n > 0 ? (
                <span style={{ marginLeft: 6, fontSize: 10.5, opacity: 0.7 }}>{n}</span>
              ) : null}
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
          text={
            narrowed
              ? "No matching sales orders."
              : phone
                ? "No sales orders. Tap New SO to create one."
                : "No sales orders. Tap ＋ to create one."
          }
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 18px 120px" }}>
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
  fCount,
  onScan,
  onFilter,
}: {
  q: string;
  setQ: (v: string) => void;
  fCount: number;
  onScan: () => void;
  onFilter: () => void;
}) {
  const active = fCount > 0;
  return (
    <div style={{ display: "flex", gap: 8, padding: "12px 18px 4px", minWidth: 0 }}>
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
      <button
        type="button"
        onClick={onFilter}
        aria-label={active ? `Filter and sort, ${fCount} active` : "Filter and sort"}
        style={{
          height: 44,
          minWidth: 44,
          boxSizing: "border-box",
          padding: active ? "0 14px" : 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          flexShrink: 0,
          border: "none",
          borderRadius: 14,
          backgroundColor: active ? M.taupe : M.card,
          color: active ? "#fff" : M.ink,
          boxShadow: active ? SHADOW_FILTER_ON : SHADOW_CONTROL,
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <SlidersHorizontal size={19} strokeWidth={1.75} />
        {active ? fCount : null}
      </button>
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
  return (
    <div
      style={{
        display: "flex",
        gap: 7,
        overflowX: "auto",
        padding: "12px 18px 8px",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {CHIPS.map((c) => {
        const on = chip === c.key;
        const n = counts[c.key] ?? 0;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            aria-pressed={on}
            style={{
              height: 30,
              padding: "0 13px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              flex: "none",
              cursor: "pointer",
              border: "1px solid transparent",
              background: on ? M_ACCENT.gold.bg : M.card,
              color: on ? M.taupe : M.muted,
              boxShadow: on ? SHADOW_CHIP_ON : SHADOW_CHIP,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {c.label}
            {n > 0 ? (
              <span style={{ marginLeft: 6, fontSize: 10.5, opacity: 0.7 }}>{n}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function PhoneSummary({
  rows,
  count,
  rev,
  open,
  onToggle,
}: {
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
      .map(([key, b]) => ({ key, ...b, style: resolveStatus(key, STATUS_MAPS.so).style }));
  }, [rows]);

  return (
    <div style={{ padding: "6px 18px 0" }}>
      <div
        role="status"
        style={{
          backgroundColor: M.card,
          borderRadius: 16,
          boxShadow: SHADOW_SUMMARY,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            padding: "14px 12px 14px 16px",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <SummaryLabel>REVENUE</SummaryLabel>
            <SummaryValue>{money(rev)}</SummaryValue>
          </div>
          <div style={{ flex: "none", textAlign: "right" }}>
            <SummaryLabel>TOTAL ORDERS</SummaryLabel>
            <SummaryValue>{count}</SummaryValue>
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? "Hide status breakdown" : "Show status breakdown"}
            aria-expanded={open}
            style={{
              flex: "none",
              width: 44,
              height: 44,
              margin: "-6px -4px -6px 0",
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
                width: 30,
                height: 30,
                borderRadius: 999,
                backgroundColor: M.divider,
                color: M.taupe,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform .18s ease",
              }}
            >
              <ChevronDown size={16} strokeWidth={2} />
            </span>
          </button>
        </div>
        {open && breakdown.length > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: "12px 16px 14px",
              backgroundColor: M.paper,
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
                    backgroundColor: b.style.hex,
                    flex: "none",
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, color: M.ink }}>
                  {titleCaseStatus(b.key || "—")}
                </span>
                <span style={{ color: M.muted, fontVariantNumeric: "tabular-nums" }}>{b.n}</span>
                <span
                  style={{
                    width: 104,
                    textAlign: "right",
                    fontWeight: 600,
                    color: M.raisin,
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

function SummaryLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: LABEL,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function SummaryValue({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 3,
        fontSize: 20,
        fontWeight: 700,
        color: M.raisin,
        letterSpacing: "-0.3px",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function PhoneSortRow({
  sort,
  columns,
  onSort,
  onNew,
}: {
  sort: Sort;
  columns: ColumnDef[];
  onSort: () => void;
  onNew: () => void;
}) {
  const { pressed, handlers } = usePressed();
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sortLabel = sort && col ? `${col.label} ${sort.dir === "asc" ? "↑" : "↓"}` : "Default";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "14px 18px 2px",
      }}
    >
      <button
        type="button"
        onClick={onSort}
        style={{
          height: 44,
          minWidth: 0,
          marginLeft: -4,
          padding: "0 4px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: M.muted,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <ArrowDownUp size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12 }}>Sort</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: M.raisin,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sortLabel}
        </span>
      </button>
      <button
        type="button"
        onClick={onNew}
        aria-label="New Sales Order"
        {...handlers}
        style={{
          height: 38,
          padding: "0 16px 0 12px",
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          border: "none",
          background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: "nowrap",
          boxShadow: SHADOW_PRIMARY,
          opacity: pressed ? 0.86 : 1,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Plus size={17} strokeWidth={2.2} />
        New SO
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

function Msg({ text, onReset }: { text: string; onReset?: () => void }) {
  return (
    <div
      style={{
        padding: "40px 18px",
        textAlign: "center",
        color: M.muted,
        fontSize: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      {text}
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            height: 44,
            padding: "0 16px",
            borderRadius: 12,
            border: `1px solid ${M.border}`,
            backgroundColor: M.card,
            color: M.ink,
            fontSize: 14,
            fontWeight: 700,
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
