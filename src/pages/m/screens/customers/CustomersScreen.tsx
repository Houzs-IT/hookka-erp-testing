// ===========================================================================
// CustomersScreen — L1 /m/customers (Claude Design `Customers v3.dc.html`,
// design-only handoff). Visuals follow the design; every rule is unchanged:
//   GET /api/customers (customersConfig.sources[0]) — stage, credit and the
//   KPI sums use the same fields and thresholds as src/pages/customers.tsx.
//   GET /api/users — read only to turn salespersonUserId into a name (desktop
//   does the same); a failed/forbidden read just hides that meta item.
// Read-only: "+" opens the existing New Customer form.
// ===========================================================================
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BadgeCheck, Building2, ChevronRight, Clock, Info, Landmark, MapPin, ScanLine, Search, SlidersHorizontal, User, Wallet, Warehouse, X } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader, FormSheet, ScanSheet } from "../../components";
import { FilterSheet } from "../../components/FilterSheet";
import { M } from "../../theme";
import { customersConfig } from "../../config/modules";
import { createSpecFor } from "../../config/forms";
import { activeFilterCount, applyFilters, applySort, money, num, selectData, str } from "../../config/helpers";
import type { ActiveFilter, RawRow } from "../../config/types";
import type { FormSpec } from "../../config/form-types";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useDebounced } from "../../lib/use-debounced";
import { CHIP_COUNT, SEGMENT_WRAP, segmentButton, segmentTrack } from "../../lib/control-styles";
import { EmptyCard } from "../delivery/DeliveryCards";
import { useMobileToast } from "../delivery/ui-hooks";
import { ErrorCard, HeaderPlus, SkeletonCards } from "../procurement/parts";
import { CountLine } from "../invoices/parts";
import {
  CUSTOMER_COLUMNS, DEFAULT_SORT, STAGE_TABS, TONE_COLOR, stateText, creditOf, hubsOf, initials, isActive, limitKpi, stageOf, stripRM, termsLabel,
  type Stage,
} from "./customer-lib";

const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
const SHADOW_SELECTED = "0 0 0 2px var(--m-taupe), 0 12px 28px -16px rgba(31,29,27,.22)";
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const PAGE_SIZE = 40;
const ICON_BTN = { width: 36, height: 44, flexShrink: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: M.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent", position: "relative" } as const;
const ICON = { size: 13, strokeWidth: 2, "aria-hidden": true, color: "var(--m-taupe-icon, #8B7A4E)" } as const;

type UsersResp = { data?: Array<{ id?: string; displayName?: string; email?: string }> };

export function CustomersScreen() {
  const navigate = useNavigate();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const { id: openId } = useParams();
  const inPane = layout.canSplitDetail && !!openId;
  const gridCols = tablet && !inPane ? "repeat(auto-fill, minmax(320px, 1fr))" : "minmax(0, 1fr)";

  const [stage, setStage] = useState<Stage>("CONFIRMED");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, ActiveFilter>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>({ ...DEFAULT_SORT });
  const [filterOpen, setFilterOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const toast = useMobileToast();
  const filterCount = activeFilterCount(filters);
  const dq = useDebounced(q).trim().toLowerCase();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [lastKey, setLastKey] = useState("");
  const resetKey = `${stage}|${dq}|${JSON.stringify(filters)}|${JSON.stringify(sort)}`;
  if (resetKey !== lastKey) {
    setLastKey(resetKey);
    setVisible(PAGE_SIZE);
  }

  const resp = useCachedJson<unknown>(customersConfig.sources[0].url);
  const users = useCachedJson<UsersResp>("/api/users");

  const all = useMemo(() => selectData(resp.data), [resp.data]);
  const salesperson = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users.data?.data ?? []) {
      if (u.id) m.set(String(u.id), String(u.displayName || "").trim() || String(u.email || "").trim());
    }
    return m;
  }, [users.data]);
  const spName = (r: RawRow) => {
    const id = str(r, "salespersonUserId", "salesperson_user_id");
    return id ? salesperson.get(id) ?? "" : "";
  };

  const counts = useMemo(() => {
    let c = 0, p = 0;
    for (const r of all) {
      if (stageOf(r) === "POTENTIAL") p++;
      else c++;
    }
    return { CONFIRMED: c, POTENTIAL: p, ALL: c + p } as Record<Stage, number>;
  }, [all]);

  // Stage-scoped set: feeds the summary exactly like desktop's `stageScoped`.
  const scoped = useMemo(() => (stage === "ALL" ? all : all.filter((r) => stageOf(r) === stage)), [all, stage]);
  const sum = useMemo(() => {
    let out = 0, lim = 0, hubs = 0;
    for (const r of scoped) {
      out += num(r, "outstandingSen", "outstanding_sen");
      lim += num(r, "creditLimitSen", "credit_limit_sen");
      hubs += hubsOf(r).length;
    }
    return { out, lim, hubs, n: scoped.length };
  }, [scoped]);

  const rows = useMemo(() => {
    const filtered = applyFilters(scoped, CUSTOMER_COLUMNS, filters, "");
    const list = dq
      ? filtered.filter((r) => `${str(r, "name")} ${str(r, "code", "debtorCode")} ${str(r, "contactName")} ${stateText(r)}`.toLowerCase().includes(dq))
      : filtered;
    return applySort(list, CUSTOMER_COLUMNS, sort ?? DEFAULT_SORT);
  }, [scoped, dq, filters, sort]);

  const [createSpec, setCreateSpec] = useState<FormSpec | null>(null);
  const canCreate = createSpecFor(customersConfig.slug) != null;

  const hasData = resp.data != null;
  const showSkeleton = resp.loading && !hasData;
  const failed = !!resp.error && !hasData;
  const potentialNote = stage !== "CONFIRMED" && counts.POTENTIAL > 0;
  const hidden = Math.max(0, rows.length - visible);

  return (
    <>
      <MobileHeader
        title={customersConfig.title}
        onBack={() => navigate(-1)}
        menu
        glass
        trailing={canCreate ? <HeaderPlus label="New Customer" onClick={() => setCreateSpec(createSpecFor(customersConfig.slug))} /> : null}
      />

      {/* Stage switch — not sticky; same switch as Delivery / Invoices. */}
      <div style={SEGMENT_WRAP}>
        <div role="group" aria-label="Customer stage" style={segmentTrack(3)}>
          {STAGE_TABS.map((t) => (
            <button key={t.key} type="button" aria-pressed={stage === t.key} onClick={() => setStage(t.key)} style={segmentButton(stage === t.key)}>
              {t.label}
              <span style={CHIP_COUNT}>{hasData ? counts[t.key] : ""}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search — 12px below the switch. */}
      <div style={{ padding: "12px 18px 0" }}>
        <div style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 6, padding: "0 4px 0 13px", background: M.card, borderRadius: 14, boxShadow: SHADOW_CONTROL }}>
          <Search size={18} strokeWidth={1.75} color={M.faint} style={{ flexShrink: 0 }} aria-hidden />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, code, PIC, state"
            aria-label="Search customers"
            style={{ flex: 1, minWidth: 0, padding: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: M.raisin }}
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 32, height: 32, marginRight: -6, border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.faint }}>
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
          <span aria-hidden style={{ width: 1, height: 20, background: "var(--m-inv-line)", flexShrink: 0 }} />
          <button type="button" onClick={() => setScanOpen(true)} aria-label="Scan QR code" style={ICON_BTN}>
            <ScanLine size={18} strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => setFilterOpen(true)} aria-label={filterCount ? `Filter and sort, ${filterCount} active` : "Filter and sort"} style={ICON_BTN}>
            <SlidersHorizontal size={18} strokeWidth={1.75} />
            {filterCount ? <span aria-hidden style={{ position: "absolute", top: 9, right: 5, width: 8, height: 8, borderRadius: "50%", background: M.gold }} /> : null}
          </button>
        </div>
      </div>

      {potentialNote ? (
        <div role="note" style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "10px 18px 0", padding: "11px 13px", borderRadius: 14, background: "var(--m-inv-gold-box)" }}>
          <Info size={15} strokeWidth={2} color={M.taupe} aria-hidden style={{ flex: "none", marginTop: 1 }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: M.ink }}>
            Potential customers come from the Sales Pipeline. They can be quoted, but can’t be used on a sales order until confirmed on desktop.
          </span>
        </div>
      ) : null}

      {/* Summary — scoped to the selected stage (desktop KPI sums). */}
      {hasData && !failed ? (
        <section aria-label="Customer summary" style={{ margin: "12px 18px 0", background: M.card, borderRadius: 20, padding: 16, boxShadow: SHADOW_CARD }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span aria-hidden style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: "var(--m-inv-warning-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Wallet size={19} strokeWidth={1.9} color="var(--m-inv-warning)" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap" }}>
                <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
                TOTAL OUTSTANDING
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 5 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: M.ink }}>RM</span>
                <span style={{ fontSize: 26, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.5px", color: M.raisin, fontVariantNumeric: "tabular-nums", minWidth: 0, overflowWrap: "anywhere" }}>
                  {stripRM(money(sum.out))}
                </span>
              </div>
              {stage === "POTENTIAL" ? <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>Potential customers carry no A/R</div> : null}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${M.divider}` }}>
            {[
              { icon: Building2, label: "Customers", value: String(sum.n) },
              { icon: Warehouse, label: "Hubs", value: String(sum.hubs) },
              { icon: Landmark, label: "Credit limit", value: limitKpi(sum.lim) },
            ].map((k, i) => (
              <div key={k.label} style={{ minWidth: 0, padding: "0 10px", borderLeft: i ? `1px solid ${M.divider}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: M.ink, whiteSpace: "nowrap" }}>
                  <k.icon size={12} strokeWidth={2} color="var(--m-taupe-icon, #8B7A4E)" aria-hidden />
                  {k.label}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 4, lineHeight: 1.3, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <CountLine text={showSkeleton || failed ? "" : `${rows.length} CUSTOMER${rows.length === 1 ? "" : "S"}`} />

      <div style={{ padding: "0 18px 32px" }}>
        {showSkeleton ? (
          <SkeletonCards maxColumns={tablet ? undefined : 1} />
        ) : failed ? (
          <ErrorCard text="Couldn’t load customers. Check your connection and try again." onRetry={() => resp.refresh()} />
        ) : rows.length === 0 ? (
          <EmptyCard text="No customers match." />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}>
              {rows.slice(0, visible).map((r, i) => {
                const id = str(r, "id", "code");
                return (
                  <CustomerCard
                    key={id || i}
                    r={r}
                    salesperson={spName(r)}
                    current={inPane && id === openId}
                    onOpen={() => navigate(`/m/customers/${encodeURIComponent(id)}`)}
                  />
                );
              })}
            </div>
            {hidden > 0 ? (
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                style={{ marginTop: 12, width: "100%", height: 44, borderRadius: 12, border: "none", background: M.card, color: M.taupe, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: SHADOW_CONTROL }}
              >
                Show more ({hidden} more)
              </button>
            ) : null}
          </>
        )}
      </div>

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        columns={CUSTOMER_COLUMNS}
        filters={filters}
        sort={sort}
        onApply={(f, s) => {
          setFilters(f);
          setSort(s);
        }}
      />

      {/* QR scanner — same handling as the generic list and Invoices v2: a same-origin link opens in-app, anything else shows what scanned. */}
      <ScanSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={(value) => {
          setScanOpen(false);
          try {
            const url = new URL(value, window.location.origin);
            if (url.origin === window.location.origin && url.pathname.startsWith("/")) {
              navigate(url.pathname + url.search);
              return;
            }
          } catch {
            // not a URL — fall through to the toast
          }
          toast.show(`Scanned: ${value.length > 60 ? `${value.slice(0, 60)}…` : value}`, "info");
        }}
      />
      {toast.node}

      <FormSheet
        open={createSpec != null}
        onClose={() => setCreateSpec(null)}
        spec={createSpec}
        onSaved={(to) => {
          setCreateSpec(null);
          if (to) navigate(to);
        }}
      />
    </>
  );
}

function CustomerCard({ r, salesperson, current, onOpen }: { r: RawRow; salesperson: string; current?: boolean; onOpen: () => void }) {
  const pot = stageOf(r) === "POTENTIAL";
  const active = isActive(r);
  const cr = creditOf(r);
  const name = str(r, "name") || "—";
  const code = str(r, "code", "debtorCode") || "No code yet";
  const hubN = hubsOf(r).length;
  const out = num(r, "outstandingSen", "outstanding_sen");
  const pill = pot
    ? { label: "Potential", dot: M.gold }
    : !active
      ? { label: "Inactive", dot: "var(--m-inv-neutral)" }
      : null;
  const rail = pot ? M.gold : !active ? "var(--m-faint)" : cr.over || cr.pct > 80 ? "var(--m-inv-danger)" : M.taupe;
  const meta: { icon: typeof User; v: string }[] = [
    { icon: User, v: str(r, "contactName") },
    { icon: MapPin, v: stateText(r) },
    { icon: Warehouse, v: hubN ? `${hubN} hub${hubN === 1 ? "" : "s"}` : "" },
    { icon: BadgeCheck, v: salesperson || "Unassigned" },
  ].filter((m) => m.v);
  const termsText = termsLabel(str(r, "creditTerms", "credit_terms"));
  const limitSen = num(r, "creditLimitSen", "credit_limit_sen");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${name}, ${code}${pill ? `, ${pill.label}` : ""}${pot ? "" : `, outstanding ${money(out)}`}`}
      style={{ position: "relative", overflow: "hidden", background: M.card, borderRadius: 16, padding: "14px 14px 14px 17px", cursor: "pointer", boxShadow: current ? SHADOW_SELECTED : SHADOW_CARD, WebkitTapHighlightColor: "transparent" }}
      aria-current={current ? "true" : undefined}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <span aria-hidden style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: pot ? "var(--m-inv-gold-box)" : active ? "var(--m-inv-gold-box)" : "var(--m-inv-neutral-bg)", color: pot ? "var(--m-inv-warning)" : active ? M.taupe : "var(--m-inv-neutral-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13.5, fontWeight: 800, letterSpacing: 0.3 }}>
          {initials(name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{code}</span>
            {pill ? (
              <span style={{ height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 999, background: "var(--m-inv-neutral-bg)", color: "var(--m-inv-neutral-fg)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: pill.dot }} />
                {pill.label}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <ChevronRight size={18} strokeWidth={1.9} color="var(--m-taupe-icon, #8B7A4E)" aria-hidden style={{ flex: "none" }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, marginTop: 6, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
            {name}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 6, fontSize: 12.5, color: M.ink }}>
            {meta.map((m, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                <m.icon {...ICON} style={{ flex: "none" }} />
                {m.v}
              </span>
            ))}
          </div>
        </div>
      </div>

      {pot ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "var(--m-inv-gold-box)", fontSize: 12.5, color: M.ink }}>
          <Clock size={14} strokeWidth={2} color="var(--m-inv-warning)" aria-hidden style={{ flex: "none" }} />
          Not billable yet · confirm on desktop to set credit
        </div>
      ) : (
        <div style={{ marginTop: 12, padding: "11px 12px", borderRadius: 12, background: M.paper }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: M.taupe }}>OUTSTANDING</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: cr.pct > 80 ? "var(--m-inv-danger)" : M.raisin, marginTop: 3, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{money(out)}</div>
            </div>
            <div style={{ minWidth: 0, textAlign: "right" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: M.taupe }}>{cr.has && cr.over ? "OVER LIMIT BY" : "AVAILABLE"}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: cr.has ? (cr.over ? "var(--m-inv-danger)" : "var(--m-inv-success)") : M.ink, marginTop: 3, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>
                {cr.has ? money(Math.abs(cr.availSen)) : "—"}
              </div>
            </div>
          </div>
          {cr.has ? (
            <div role="img" aria-label={`${cr.pct.toFixed(0)}% of credit limit used`} style={{ marginTop: 9, height: 6, borderRadius: 999, background: "var(--m-inv-line)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(cr.pct, 100).toFixed(0)}%`, borderRadius: 999, background: TONE_COLOR[cr.tone] }} />
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 6, fontSize: 12, color: M.ink }}>
            <span style={{ minWidth: 0, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>
              {cr.has ? `${cr.pct.toFixed(0)}% of ${money(limitSen)}` : "No credit limit"}
            </span>
            <span style={{ flex: "none", fontWeight: 600 }}>{termsText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
