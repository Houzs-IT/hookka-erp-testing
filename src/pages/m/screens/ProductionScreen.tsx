// ===========================================================================
// ProductionScreen — L1 Production Orders list (/m/production).
//
// Claude Design "Production Orders v3" (owner 2026-10-29): same card skeleton,
// typography and section headings as Sales Orders v4 / Invoices v2. Visual layer
// only: the data, filters, department chips and stage rule are the ones this
// screen already had.
//   • GET /api/production-orders/board  — the live set (not COMPLETED/CANCELLED),
//     grouped / filtered client-side. Unchanged.
//   • GET /api/production-orders/overdue-counts — the SAME endpoint the desktop
//     Production overview uses. Its id sets decide which cards are officially
//     overdue (red). When it is unavailable nothing is inferred from dates.
//   • tap a card -> /m/production/:id (ProductionDetailScreen).
//
// The department bar / "Step N of 10" come from currentDepartment, as before.
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownUp, Calendar, CalendarX, Factory, Search, SearchX, TriangleAlert, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayISO } from "@/pages/production/utils";
import { MobileHeader, Sheet } from "../components";
import { DashLabel, StatusDotPill } from "../components/ProductionBits";
import { ListCardShell } from "../components/ListCardShell";
import { M, M_ACCENT, titleCaseStatus } from "../theme";
import { resolveStatus, STATUS_MAPS, str, num, dateOnly } from "../config/helpers";
import { useDebounced } from "../lib/use-debounced";
import { CHIP_ROW, CHIP_ROW_CLASS, CHIP_COUNT, chip as chipStyle } from "../lib/control-styles";
import { CARD_LABEL } from "../lib/list-card-styles";
import {
  DEPTS,
  dueLook,
  SHADOW_CARD,
  SHADOW_CONTROL,
  shortDate,
  statusTint,
  TINT_DANGER,
  TINT_WARNING,
} from "../lib/production-ui";

type PO = {
  id: string;
  poNo?: string;
  status?: string;
  productCode?: string;
  productName?: string;
  customerName?: string;
  companySOId?: string;
  customerSO?: string;
  quantity?: number;
  targetEndDate?: string;
  currentDepartment?: string;
};
type Resp = { success?: boolean; data?: PO[] };
type OverdueResp = {
  success?: boolean;
  data?: {
    bedframeCount?: number;
    sofaCount?: number;
    overdueBedframePoIds?: string[];
    overdueSofaPoIds?: string[];
  };
};

const CHIPS = [{ code: "all", name: "All" }, ...DEPTS];
const STATUS_FILTERS = ["PENDING", "IN_PROGRESS", "ON_HOLD", "PAUSED"] as const;
type OverdueKey = "BEDFRAME" | "SOFA";

/** Position of the PO's current department in the pipeline (-1 if unknown). */
function stageIndexOf(po: PO): number {
  const dept = str(po, "currentDepartment");
  return DEPTS.findIndex((d) => d.code === dept);
}

function isLive(po: PO): boolean {
  const s = str(po, "status");
  return s !== "COMPLETED" && s !== "CANCELLED";
}

function matches(po: PO, q: string): boolean {
  if (!q) return true;
  return [
    str(po, "poNo"),
    str(po, "companySOId"),
    str(po, "customerSO"),
    str(po, "productCode"),
    str(po, "productName"),
    str(po, "customerName"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function ProductionScreen() {
  const navigate = useNavigate();
  // Dedicated board endpoint (perf 2026-07-14): ONLY the live set, slimmed to the
  // fields the board renders. The client still runs search + per-dept counts over
  // the WHOLE returned set, so nothing becomes unfindable.
  const { data, loading, error } = useCachedJson<Resp>("/api/production-orders/board");
  // Same endpoint + params the desktop overview uses (no dept = Overview rule).
  // Slow historically, so it never blocks the list: tiles show "—" until it lands.
  const { data: odData } = useCachedJson<OverdueResp>("/api/production-orders/overdue-counts");
  const [query, setQuery] = useState("");
  const dquery = useDebounced(query);
  const [chip, setChip] = useState("all");
  const [od, setOd] = useState<OverdueKey | null>(null);
  const [fs, setFs] = useState<string[]>([]);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const all = useMemo(() => (data?.success ? data.data ?? [] : []), [data]);
  const odOk = !!odData?.success && !!odData.data;
  const bedIds = useMemo(() => new Set(odData?.data?.overdueBedframePoIds ?? []), [odData]);
  const sofaIds = useMemo(() => new Set(odData?.data?.overdueSofaPoIds ?? []), [odData]);
  const overdueIds = useMemo(() => new Set([...bedIds, ...sofaIds]), [bedIds, sofaIds]);

  const q = dquery.trim().toLowerCase();
  const liveAll = useMemo(() => all.filter(isLive), [all]);
  // Live + searched (ignores the dept chip / overdue / status filters).
  const live = useMemo(() => liveAll.filter((po) => matches(po, q)), [liveAll, q]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: live.length };
    for (const po of live) {
      const d = str(po, "currentDepartment") || "";
      c[d] = (c[d] ?? 0) + 1;
    }
    return c;
  }, [live]);
  const base = useMemo(() => {
    const odSet = od === "BEDFRAME" ? bedIds : od === "SOFA" ? sofaIds : null;
    return live.filter(
      (po) =>
        (chip === "all" || str(po, "currentDepartment") === chip) && (!odSet || odSet.has(po.id)),
    );
  }, [live, chip, od, bedIds, sofaIds]);
  const rows = useMemo(
    () => (fs.length ? base.filter((po) => fs.includes(str(po, "status"))) : base),
    [base, fs],
  );

  const today = todayISO();
  const narrowed = !!query || chip !== "all" || !!od || fs.length > 0;
  const draftN = base.filter((po) => !draft.length || draft.includes(str(po, "status"))).length;

  const activeChips: { key: string; label: string }[] = [
    ...fs.map((k) => ({ key: `st:${k}`, label: titleCaseStatus(k) })),
    ...(od ? [{ key: "od", label: od === "SOFA" ? "Sofa overdue" : "Bedframe overdue" }] : []),
  ];
  const fCount = activeChips.length;
  const removeChip = (key: string) => {
    if (key === "od") setOd(null);
    else setFs((cur) => cur.filter((k) => `st:${k}` !== key));
  };
  const openSheet = () => {
    setDraft([...fs]);
    setSheet(true);
  };

  const overdueTiles: { key: OverdueKey; label: string; count: number | null; unit: string }[] = [
    { key: "BEDFRAME", label: "BEDFRAME", count: odOk ? odData?.data?.bedframeCount ?? 0 : null, unit: "pieces overdue" },
    { key: "SOFA", label: "SOFA", count: odOk ? odData?.data?.sofaCount ?? 0 : null, unit: "sets overdue" },
  ];

  return (
    <>
      <MobileHeader title="Production Orders" menu />

      {/* Search */}
      <div style={{ padding: "6px 18px 0" }}>
        <label
          style={{
            height: 44,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 4px 0 13px",
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
            value={query}
            placeholder="Search PRD · product · SO · customer"
            aria-label="Search production orders"
            onChange={(e) => setQuery(e.target.value)}
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
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
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
                color: M.muted,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
        </label>
      </div>

      {/* Department chips (All + the 10 real departments) */}
      <div className={CHIP_ROW_CLASS} style={CHIP_ROW} role="group" aria-label="Department">
        {CHIPS.map((c) => {
          const on = chip === c.code;
          const n = counts[c.code] ?? 0;
          return (
            <button
              key={c.code}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setChip(c.code);
                setOd(null);
              }}
              style={chipStyle(on)}
            >
              {c.name}
              {n > 0 ? <span style={CHIP_COUNT}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Summary card */}
      <section aria-label="Production summary" style={{ padding: "12px 18px 4px" }}>
        <div style={{ borderRadius: 20, backgroundColor: M.card, boxShadow: SHADOW_CARD, padding: "16px 16px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <DashLabel>LIVE PRODUCTION ORDERS</DashLabel>
            <Factory size={16} strokeWidth={1.9} color="var(--m-inv-icon)" aria-hidden="true" />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 8, minWidth: 0 }}>
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
              {data?.success ? liveAll.length : "—"}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>orders</span>
          </div>
          <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3 }}>Not completed or cancelled</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 14 }}>
            {overdueTiles.map((t) => {
              const on = od === t.key;
              const enabled = t.count != null;
              return (
                <button
                  key={t.key}
                  type="button"
                  disabled={!enabled}
                  aria-pressed={on}
                  aria-label={enabled ? `${t.label}: ${t.count} ${t.unit}` : `${t.label}: overdue count unavailable`}
                  onClick={() => {
                    if (on) setOd(null);
                    else {
                      setOd(t.key);
                      setChip("all");
                      setQuery("");
                    }
                  }}
                  style={{
                    minWidth: 0,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "none",
                    fontFamily: "inherit",
                    cursor: enabled ? "pointer" : "default",
                    backgroundColor: on ? TINT_DANGER.bg : "var(--m-inv-past-bg)",
                    boxShadow: on ? `inset 0 0 0 1.5px ${TINT_DANGER.fg}` : "none",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      color: TINT_DANGER.fg,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
                    {t.label}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: TINT_DANGER.fg, fontVariantNumeric: "tabular-nums" }}>
                      {t.count ?? "—"}
                    </span>
                    <span style={{ fontSize: 11.5, color: M.ink }}>{t.unit}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* "N ORDERS" ── round Sort/Filter button */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 15px 0 18px" }}>
        {data?.success ? (
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
            {rows.length} {rows.length === 1 ? "ORDER" : "ORDERS"}
          </span>
        ) : null}
        <span style={{ flex: 1, minWidth: 8, height: 1, backgroundColor: M.hairline }} />
        <button
          type="button"
          onClick={openSheet}
          aria-label={fs.length ? `Filter orders, ${fs.length} active` : "Filter orders"}
          aria-haspopup="dialog"
          title="Filter"
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
              backgroundColor: fs.length ? M.taupe : M.card,
              color: fs.length ? M.paper : M.taupe,
              boxShadow: fs.length ? "0 8px 18px -8px rgba(107,92,50,.6)" : SHADOW_CONTROL,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowDownUp size={16} strokeWidth={1.9} />
            {fCount > 0 ? (
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
                  backgroundColor: TINT_DANGER.fg,
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
      {fCount > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 18px 2px" }}>
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => removeChip(c.key)}
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
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
                boxShadow: "0 4px 12px -6px rgba(107,92,50,.45)",
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
            onClick={() => {
              setFs([]);
              setOd(null);
            }}
            style={{
              height: 30,
              padding: "0 6px",
              border: "none",
              background: "transparent",
              color: M.taupe,
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Clear all
          </button>
        </div>
      ) : null}
      <div style={{ height: 6 }} />

      {loading && !data ? (
        <Msg text="Loading…" role="status" />
      ) : error && !data ? (
        <Msg text="Couldn’t load production orders." role="alert" card />
      ) : rows.length === 0 ? (
        <Msg text={narrowed ? "No matching production orders." : "No live production orders."} role="status" card icon={narrowed} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10, padding: "0 18px 120px" }}>
          {rows.map((po) => (
            <PoCard
              key={po.id}
              po={po}
              today={today}
              overdue={overdueIds.has(po.id)}
              onClick={() => navigate(`/m/production/${encodeURIComponent(po.id)}`)}
            />
          ))}
        </div>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filter orders">
        <section aria-label="Status">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 2px 10px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>STATUS</span>
            <span style={{ fontSize: 11.5, color: M.taupe }}>{draft.length ? `${draft.length} selected` : "Any"}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {STATUS_FILTERS.map((k) => {
              const on = draft.includes(k);
              const n = base.filter((po) => str(po, "status") === k).length;
              const tint = statusTint(resolveStatus(k, STATUS_MAPS.production).style.hex);
              return (
                <button
                  key={k}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setDraft((cur) => (on ? cur.filter((x) => x !== k) : [...cur, k]))}
                  style={{
                    height: 36,
                    boxSizing: "border-box",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 14px",
                    borderRadius: 999,
                    border: "none",
                    background: on ? M.taupe : M.card,
                    color: on ? "var(--m-text-on-accent)" : M.ink,
                    fontFamily: "inherit",
                    fontSize: 12.5,
                    fontWeight: on ? 700 : 500,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    boxShadow: on ? "var(--m-shadow-chip-on)" : "var(--m-shadow-chip)",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: tint.fg,
                      boxShadow: on ? "0 0 0 1.5px rgba(255,255,255,.85)" : "none",
                    }}
                  />
                  {titleCaseStatus(k)}
                  {n > 0 ? <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{n}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            type="button"
            onClick={() => setDraft([])}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 12,
              border: "none",
              background: M.card,
              color: M.ink,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: SHADOW_CONTROL,
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              setFs([...draft]);
              setSheet(false);
            }}
            style={{
              flex: 1.4,
              height: 46,
              borderRadius: 12,
              border: "none",
              background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
              color: "var(--m-text-on-accent)",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 8px 18px -8px rgba(107,92,50,.65)",
            }}
          >
            {draftN === 1 ? "Show 1 order" : `Show ${draftN} orders`}
          </button>
        </div>
      </Sheet>
    </>
  );
}

// ---- One production-order card (Production Orders v3) ----------------------
function PoCard({
  po,
  today,
  overdue,
  onClick,
}: {
  po: PO;
  today: string;
  overdue: boolean;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const code = str(po, "poNo", "companySOId") || "—";
  const product = str(po, "productName", "productCode") || "—";
  const customer = str(po, "customerName");
  const companySO = str(po, "companySOId");
  const customerRef = str(po, "customerSO");
  const qty = num(po, "quantity");
  const target = dateOnly(po, "targetEndDate");
  const si = stageIndexOf(po);
  const statusKey = str(po, "status");
  const status = resolveStatus(statusKey, STATUS_MAPS.production);
  const tint = statusTint(status.style.hex);
  const label = titleCaseStatus(status.label);
  const due = dueLook(target, overdue, today);

  // Reference chips. /board carries the company SO number but neither the order
  // type nor a company CO number, so a missing companySOId does NOT prove a
  // consignment order. When there is no company SO the customer's own reference is
  // shown under the neutral label "Customer Ref" rather than guessing SO vs CO.
  const refs: { k: string; v: string }[] = [];
  if (companySO) refs.push({ k: "SO", v: companySO });
  else if (customerRef) refs.push({ k: "Customer Ref", v: customerRef });
  if (customer) refs.push({ k: "", v: customer });

  const dueTint = due.tone === "overdue" ? TINT_DANGER : due.tone === "soon" ? TINT_WARNING : null;
  const keyColor = dueTint ? dueTint.fg : M.ink;
  const DueIcon = due.tone === "overdue" ? CalendarX : Calendar;

  return (
    <div
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{ transform: pressed ? "scale(.985)" : "none", transition: "transform .12s ease" }}
    >
      <ListCardShell
        rail={tint.fg}
        code={code}
        codeStyle={{ flexShrink: 1, minWidth: 0, fontSize: 14, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis" }}
        pill={<StatusDotPill hex={status.style.hex} label={status.label} />}
        party={product}
        partyGap={6}
        refs={refs}
        middle={
          <div style={{ marginTop: 10 }}>
            <div
              aria-hidden="true"
              style={{ display: "grid", gridTemplateColumns: `repeat(${DEPTS.length},minmax(0,1fr))`, gap: 3 }}
            >
              {DEPTS.map((d, i) => (
                <span
                  key={d.code}
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: i === si ? M.gold : si >= 0 && i < si ? M.taupe : "var(--m-segment-track)",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 6,
                fontSize: 11.5,
                color: M.ink,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                Dept <span style={{ fontWeight: 700, color: tint.fg }}>{si >= 0 ? DEPTS[si].name : "—"}</span>
              </span>
              <span style={{ flex: "none" }}>{si >= 0 ? `Step ${si + 1} of ${DEPTS.length}` : ""}</span>
            </div>
          </div>
        }
        left={{
          bg: dueTint ? dueTint.bg : M.paper,
          children: (
            <>
              <span
                style={{ ...CARD_LABEL, fontWeight: 700, color: keyColor, display: "flex", alignItems: "center", gap: 5 }}
              >
                <DueIcon size={12} strokeWidth={2} aria-hidden="true" />
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
                {shortDate(target) || "—"}
                {due.text ? <span style={{ fontWeight: 600, color: keyColor }}> · {due.text}</span> : null}
              </div>
            </>
          ),
        }}
        right={{ label: "QTY", value: `×${qty}` }}
        ariaLabel={`${code}, ${product}, ${label}`}
        onOpen={onClick}
      />
    </div>
  );
}

function Msg({ text, role, card, icon }: { text: string; role: "status" | "alert"; card?: boolean; icon?: boolean }) {
  if (card) {
    return (
      <div
        role={role}
        style={{
          margin: "12px 18px",
          padding: "28px 18px",
          textAlign: "center",
          backgroundColor: M.card,
          borderRadius: 16,
          fontSize: 13.5,
          color: M.ink,
          boxShadow: SHADOW_CARD,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        {icon ? <SearchX size={22} strokeWidth={1.75} color={M.taupe} aria-hidden="true" /> : null}
        {text}
      </div>
    );
  }
  return (
    <div role={role} style={{ padding: "40px 18px", textAlign: "center", color: M.ink, fontSize: 14 }}>
      {text}
    </div>
  );
}
