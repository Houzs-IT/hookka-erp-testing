// ===========================================================================
// ServiceCasesScreen — L1 Service Cases list (Claude Design "Service Cases
// Phase 4": status chips with counts, search, sort & filter, case cards with
// stage bar / ages / orders, Export CSV).
//
// Logic is the desktop's, not the prototype's: stage + ages come from
// src/lib/case-pipeline.ts via use-case-rows; chip counts are taken BEFORE
// search / filters (desktop + prototype agree); the 500-row server cap is
// stated, not hidden; CSV is the desktop's 11 columns over the rows shown.
// ===========================================================================
import { todayYmdMY } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownUp, ChevronRight, CloudOff, Ellipsis, FileSpreadsheet, Info, LifeBuoy, Lock, Plus, SearchX, Inbox, X } from "lucide-react";
import { exportToCsv } from "@/lib/export-csv";
import { MobileHeader, Sheet } from "../components";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { M } from "../theme";
import { useDebounced } from "../lib/use-debounced";
import {
  AGED_DAYS,
  CASE_CSV_COLUMNS,
  CASE_PIPELINE_STEPS,
  CASE_STATUSES,
  CATEGORY_TONE,
  DEFAULT_TONE,
  LIST_CAP,
  ROOT_CAUSE_SHORT,
  STAGE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  daysOpenLabel,
  fmtDay,
  isAged,
  isStageAged,
  ordersLabel,
  stageDaysLabel,
  type CaseRow,
  type CaseStatus,
} from "./cases/case-model";
import { CC, SH_CARD, SH_CTRL, SH_FIELD, SH_ON } from "./cases/case-style";
import { Chip, IconBtn, IconTile, Msg, Note, Pill, RefChip, SearchField, StageBar, Tag } from "./cases/case-ui";
import { CaseFilterSheet } from "./cases/CaseFilterSheet";
import { EMPTY_FILTERS, SORT_LABEL, filterCount, matchesCase, sortCases, type CaseFilters } from "./cases/case-filters";
import { useCaseRows } from "./cases/use-case-rows";
import { useCasePerms, useCaseToast } from "./cases/case-hooks";
import { QuickReport } from "./cases/QuickReport";

export function ServiceCasesScreen() {
  const navigate = useNavigate();
  const { mode } = useResponsiveLayout();
  const perms = useCasePerms();
  const toast = useCaseToast();
  const { rows, loading, error, stageReady, now } = useCaseRows();
  const [q, setQ] = useState("");
  const dq = useDebounced(q).trim().toLowerCase();
  const [chip, setChip] = useState<"ALL" | CaseStatus>("ALL");
  const [filters, setFilters] = useState<CaseFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Counts are taken before search + filters (desktop casesInPeriod).
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const s of CASE_STATUSES) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const byChip = chip === "ALL" ? rows : rows.filter((r) => r.status === chip);
    return sortCases(byChip.filter((r) => matchesCase(r, dq, filters, now)), filters.sort);
  }, [rows, chip, dq, filters, now]);

  const departments = useMemo(() => Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort(), [rows]);
  const fCount = filterCount(filters);
  const narrowed = !!dq || fCount > 0;
  const forbidden = !!error && /\b403\b|forbidden|permission/i.test(error);
  const cols = mode === "phone" ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))";

  const exportCsv = () => {
    exportToCsv({ filename: `service-cases-${todayYmdMY()}`, columns: CASE_CSV_COLUMNS, rows: shown });
    setMoreOpen(false);
    toast.show(`CSV exported · ${shown.length} case${shown.length === 1 ? "" : "s"}`);
  };

  const activeChips: { label: string; clear: () => void }[] = [];
  filters.src.forEach((s) => activeChips.push({ label: s === "SO" ? "Sales order" : s === "CO" ? "Consignment" : "External", clear: () => setFilters({ ...filters, src: filters.src.filter((x) => x !== s) }) }));
  filters.cats.forEach((c) => activeChips.push({ label: ROOT_CAUSE_SHORT[c] ?? c, clear: () => setFilters({ ...filters, cats: filters.cats.filter((x) => x !== c) }) }));
  filters.depts.forEach((d) => activeChips.push({ label: d, clear: () => setFilters({ ...filters, depts: filters.depts.filter((x) => x !== d) }) }));
  filters.stages.forEach((s) => activeChips.push({ label: CASE_PIPELINE_STEPS[s], clear: () => setFilters({ ...filters, stages: filters.stages.filter((x) => x !== s) }) }));
  if (filters.created !== "all") activeChips.push({ label: filters.created === "month" ? "This month" : "Last 30 days", clear: () => setFilters({ ...filters, created: "all" }) });
  if (filters.aged) activeChips.push({ label: `Open ${AGED_DAYS}+ days`, clear: () => setFilters({ ...filters, aged: false }) });
  if (filters.sort !== "created") activeChips.push({ label: `Sort: ${SORT_LABEL[filters.sort]}`, clear: () => setFilters({ ...filters, sort: "created" }) });

  const emptyCopy = narrowed
    ? { icon: SearchX, title: "No cases match", text: "Try a different search or clear the filters. Only loaded cases are searched." }
    : rows.length === 0
      ? { icon: LifeBuoy, title: "No service cases yet", text: "Cases you open from a sales order, consignment order or external report will show here." }
      : { icon: Inbox, title: `No ${STATUS_LABEL[chip as CaseStatus]?.toLowerCase() ?? ""} cases`, text: "Pick another status to see more cases." };

  return (
    <>
      <MobileHeader
        title="Service Cases"
        menu
        onBack={() => navigate(-1)}
        trailing={
          <div style={{ display: "flex", gap: 8 }}>
            <IconBtn label="More actions" onClick={() => setMoreOpen(true)} disabled={loading || !!error}><Ellipsis size={20} strokeWidth={2} /></IconBtn>
            {perms.create ? <IconBtn label="New service case" primary onClick={() => setCreateOpen(true)}><Plus size={20} strokeWidth={2.2} /></IconBtn> : null}
          </div>
        }
      />

      {forbidden ? (
        <Msg icon={Lock} text="You don’t have access to Service Cases" sub="Ask an admin for Service Cases access. Your other modules are unchanged." />
      ) : (
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 8, padding: "14px 18px 4px" }}>
            <SearchField
              value={q}
              onChange={setQ}
              placeholder="Search case, customer, source, PO"
              label="Search service cases"
              trailing={q ? (
                <button type="button" aria-label="Clear search" onClick={() => setQ("")} style={{ flex: "none", width: 36, height: 44, border: "none", background: "none", color: M.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, background: "#F2EEE6", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} strokeWidth={2.4} /></span>
                </button>
              ) : null}
            />
          </div>

          <div role="tablist" aria-label="Case status" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 18px 4px", scrollbarWidth: "none" }}>
            <Chip role="tab" label="All" on={chip === "ALL"} count={counts.ALL} onClick={() => setChip("ALL")} />
            {CASE_STATUSES.map((s) => (
              <Chip role="tab" key={s} label={STATUS_LABEL[s]} on={chip === s} count={counts[s]} dot={STATUS_TONE[s].fg} onClick={() => setChip(s)} />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px 4px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {shown.length} CASE{shown.length === 1 ? "" : "S"}
            </span>
            <span style={{ flex: 1, minWidth: 8, height: 1, background: "#E6E0D9" }} />
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              aria-label={fCount ? `Sort and filter, ${fCount} active` : "Sort and filter"}
              title="Sort & filter"
              aria-haspopup="dialog"
              style={{ position: "relative", width: 38, height: 38, borderRadius: "50%", border: "none", padding: 0, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: fCount ? CC.brown : M.card, color: fCount ? "#FFFFFF" : CC.brown, boxShadow: fCount ? SH_ON : SH_CTRL }}
            >
              <ArrowDownUp size={16} strokeWidth={1.9} />
              {fCount > 0 ? <span aria-hidden style={{ position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: CC.danger, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #FAF8F4", fontVariantNumeric: "tabular-nums" }}>{fCount}</span> : null}
            </button>
          </div>

          {activeChips.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 18px 2px" }}>
              {activeChips.map((c) => (
                <button key={c.label} type="button" aria-label={`Remove filter ${c.label}`} onClick={c.clear} style={{ height: 30, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px 0 12px", borderRadius: 999, border: "none", background: CC.tileWarm, color: CC.brown, fontFamily: "inherit", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", boxShadow: "0 4px 12px -6px rgba(107,92,50,.45)" }}>
                  {c.label}<X size={13} strokeWidth={2.2} />
                </button>
              ))}
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} style={{ height: 30, padding: "0 6px", border: "none", background: "transparent", color: CC.brown, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Clear all</button>
            </div>
          ) : null}

          {loading ? (
            <div aria-busy="true" aria-label="Loading service cases" style={{ display: "grid", gridTemplateColumns: cols, gap: 11, padding: "10px 18px 120px" }}>
              {[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 168, borderRadius: 16, background: "#EFEAE1" }} />)}
            </div>
          ) : error ? (
            <Msg icon={CloudOff} tone="danger" text="Couldn’t load service cases" sub="This is a load failure, not an empty list. Check your connection and try again." action={<button type="button" onClick={() => window.location.reload()} style={{ height: 44, padding: "0 22px", borderRadius: 12, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Try again</button>} />
          ) : shown.length === 0 ? (
            <Msg
              card={false}
              icon={emptyCopy.icon}
              text={emptyCopy.title}
              sub={emptyCopy.text}
              action={narrowed ? <button type="button" onClick={() => { setQ(""); setFilters(EMPTY_FILTERS); }} style={{ height: 44, padding: "0 18px", borderRadius: 999, border: "none", background: M.card, color: CC.brown, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: SH_FIELD }}>Reset search &amp; filters</button> : undefined}
            />
          ) : (
            <>
              <div style={{ padding: "6px 18px 0", display: "grid", gridTemplateColumns: cols, gap: 11 }}>
                {shown.map((r) => <CaseCard key={r.id} r={r} onOpen={() => navigate(`/m/servicecases/${encodeURIComponent(r.id)}`)} />)}
              </div>
              <div style={{ margin: "16px 18px 0" }}>
                <Note>{rows.length >= LIST_CAP ? `Newest ${LIST_CAP} cases loaded. Search and export cover loaded cases.` : `${rows.length} case${rows.length === 1 ? "" : "s"} loaded. Search and export cover loaded cases.`}{!stageReady ? " Stages are still updating…" : ""}</Note>
              </div>
              <div style={{ height: 120 }} />
            </>
          )}
        </div>
      )}

      <CaseFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onChange={setFilters} departments={departments} matchCount={shown.length} />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SH_CARD }}>
          <button type="button" onClick={exportCsv} disabled={shown.length === 0} aria-disabled={shown.length === 0} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "8px 15px", background: "none", border: "none", fontFamily: "inherit", textAlign: "left", cursor: shown.length ? "pointer" : "default", opacity: shown.length ? 1 : 0.5 }}>
            <IconTile icon={FileSpreadsheet} size={34} r={10} iconSize={17} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>Export CSV</span>
              <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{shown.length ? `${shown.length} case${shown.length === 1 ? "" : "s"} · current status, search and filters` : "No cases to export"}</span>
            </span>
          </button>
        </div>
        <div style={{ margin: "12px 0 8px" }}>
          <Note icon={Info}>Newest {LIST_CAP} cases are loaded. Search and export cover loaded cases. Export always includes all 11 desktop columns.</Note>
        </div>
      </Sheet>

      <QuickReport
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); navigate(`/m/servicecases/${encodeURIComponent(id)}`); }}
      />
      {toast.node}
    </>
  );
}

function CaseCard({ r, onOpen }: { r: CaseRow; onOpen: () => void }) {
  const st = STATUS_TONE[r.status];
  const stageTone = STAGE_TONE[r.stageLabel] ?? DEFAULT_TONE;
  const cats = r.categoryCodes;
  const ord = ordersLabel(r);
  const refs: [string, string][] = [
    [r.sourceType === "EXTERNAL" ? "External" : r.sourceType, r.sourceType === "EXTERNAL" ? r.externalRef || "—" : r.sourceNo || "—"],
    ["PO", r.customerPO || "—"],
  ];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${r.caseNo}, ${r.customerName}, ${STATUS_LABEL[r.status]}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ position: "relative", minWidth: 0, background: M.card, borderRadius: 16, padding: "13px 14px 12px 17px", cursor: "pointer", overflow: "hidden", boxShadow: SH_CARD, WebkitTapHighlightColor: "transparent" }}
    >
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: st.fg }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{r.caseNo}</span>
        <Pill label={STATUS_LABEL[r.status]} tone={st} dot={st.fg} />
        <span style={{ flex: 1 }} />
        <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDay(r.createdAt)}</span>
        <ChevronRight size={18} strokeWidth={1.9} color={CC.brownSoft} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: M.raisin, marginTop: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{r.customerName || "—"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
        {refs.map(([k, v]) => <RefChip key={k} k={k} v={v} />)}
      </div>
      <div style={{ marginTop: 10 }}>
        <StageBar index={r.stageIndex} cancelled={r.cancelled} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, fontSize: 11.5, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden" }}>Stage<Tag label={r.stageLabel} tone={stageTone} h={20} /></span>
          <span style={{ flex: "none", whiteSpace: "nowrap" }}>{r.cancelled ? "" : `${r.stageIndex + 1} of 8`}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 9, minHeight: 22 }}>
        {cats.length === 0 ? <span style={{ fontSize: 11.5, color: CC.hint }}>No root cause recorded</span> : (
          <>
            {cats.slice(0, 2).map((c) => <Tag key={c} label={ROOT_CAUSE_SHORT[c] ?? c} tone={CATEGORY_TONE[c] ?? DEFAULT_TONE} upper />)}
            {cats.length > 2 ? <Tag label={`+${cats.length - 2}`} upper /> : null}
          </>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginTop: 10, paddingTop: 8, borderTop: `1px solid ${CC.sep}` }}>
        <Metric label="DAYS OPEN" value={daysOpenLabel(r)} red={isAged(r)} first />
        <Metric label="STATUS DAYS" value={stageDaysLabel(r)} red={isStageAged(r)} />
        <Metric label="ORDERS" value={ord === "none" ? "None" : String(r.ordersCount)} ink />
      </div>
    </div>
  );
}

function Metric({ label, value, red, first, ink }: { label: string; value: string; red?: boolean; first?: boolean; ink?: boolean }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: first ? 0 : 10, borderLeft: first ? "none" : `1px solid ${CC.sep}` }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".5px", color: CC.brown }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: red ? CC.danger : ink ? M.raisin : CC.neutralDays, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
