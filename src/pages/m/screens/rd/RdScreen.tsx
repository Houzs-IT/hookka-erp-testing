// ===========================================================================
// RdScreen — /m/rd, the R&D Projects list (Final Batch 5, Claude Design
// "R&D Projects"). Six sections: Summary · Drafts · Projects · Completed ·
// Pipeline · Reports. Search + sort/type filter + category chips on the card
// tabs; tap a card → /m/rd/:id (the project workspace; split view on tablets).
//
//   read    GET /api/rd-projects (ungated, owner decision R-1)
//   +       New project (rd-projects:create)
//   draft   Start Project → POST /:id/start (rd-projects:update)
// Health chips come from src/pages/rd/health.ts with the Malaysia "today".
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity, ArrowDownUp, CalendarCheck, CalendarX, ChartColumn, ChevronRight, CircleCheck, CloudOff, Columns3, FilePen, FlaskConical, FolderKanban,
  FolderOpen, Gauge, LayoutDashboard, Lock, Play, Plus, Receipt, Search, SearchX, TriangleAlert, Users, Wallet, X as XIcon, type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { MobileHeader, ResponsiveGrid } from "../../components";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { StateCard, TplSheet, TplStyles } from "../threepl/tpl-kit";
import { CHIP_BTN, PLUS_BTN } from "../threepl/tpl-style";
import { useRdLifecycle } from "./rd-actions";
import { FormStack, type Frame } from "./rd-forms";
import { Badge, DocCard, InlineState, Label, Note, Skeleton, StageBar, Thumb, Tiles } from "./rd-kit";
import {
  barTone, baseFilter, budgetPct, CATEGORY_LABEL, catCount, dayCount, defaultStageLabel, fmtDate, healthChips, isTab, LIST_URL, listOf, pct1, plural,
  projectHealth, reports, rm, scheduleChip, SORT_LABEL, sortProjects, STAGE_COLOR, STAGES, stageIndex, stageLabels, STATUS_LABEL, STATUS_TONE,
  summary, tabPool, TABS, thumbOf, toProject, TYPE_LABEL, type CatFilter, type Envelope, type Project, type Sort, type Tab, type TypeFilter,
} from "./rd-lib";
import { useRdPerms } from "./rd-perms";
import { CARD, R, SH_CARD, SH_CARD_ON, SH_CONTROL, TAB_BTN, TONE } from "./rd-style";
import { useRdToast } from "./rd-toast";

const TAB_ICON: Record<Tab, LucideIcon> = {
  summary: LayoutDashboard, drafts: FilePen, projects: FolderKanban, completed: CircleCheck, pipeline: Columns3, reports: ChartColumn,
};
const CHIPS: { k: CatFilter; l: string }[] = [
  { k: "all", l: "All" }, { k: "SOFA", l: "Sofa" }, { k: "BEDFRAME", l: "Bedframe" }, { k: "ACCESSORY", l: "Accessory" },
];
const CAT_TONE = { SOFA: TONE.info, BEDFRAME: TONE.br, ACCESSORY: TONE.warn } as const;

// Search / chips / sort survive a trip into a project and back (phone).
const memo: { q: string; cat: CatFilter; sort: Sort; type: TypeFilter } = { q: "", cat: "all", sort: "target", type: "all" };

export function RdScreen() {
  const navigate = useNavigate();
  const { id: openId } = useParams();
  const [sp] = useSearchParams();
  const tabParam = sp.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "projects";
  const layout = useResponsiveLayout();
  const wide = layout.canSplitDetail;
  const inPane = wide && !!openId;
  const perms = useRdPerms();
  const toast = useRdToast();
  const life = useRdLifecycle(toast.show);
  const today = todayYmdMY();

  const res = useCachedJson<Envelope>(LIST_URL);
  const all = useMemo(() => listOf(res.data, toProject), [res.data]);

  const [q, setQ] = useState(memo.q);
  const [cat, setCat] = useState<CatFilter>(memo.cat);
  const [sort, setSort] = useState<Sort>(memo.sort);
  const [type, setType] = useState<TypeFilter>(memo.type);
  useEffect(() => {
    Object.assign(memo, { q, cat, sort, type });
  }, [q, cat, sort, type]);
  const [sortOpen, setSortOpen] = useState(false);
  const tabsRef = useRef<HTMLElement>(null);
  // Keep the active section visible in the scrolling tab strip (e.g. Pipeline / Reports on a phone).
  useEffect(() => {
    const nav = tabsRef.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && on) nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
  }, [tab]);
  const [frames, setFrames] = useState<Frame[]>([]);

  const cardTab = tab !== "summary" && tab !== "reports";
  const pool = useMemo(() => tabPool(all, tab), [all, tab]);
  const base = useMemo(() => baseFilter(pool, q, type), [pool, q, type]);
  const list = useMemo(() => sortProjects(base.filter((p) => cat === "all" || p.productCategory === cat), sort), [base, cat, sort]);
  const filtered = !!q.trim() || cat !== "all" || type !== "all";
  const fN = (sort !== "target" ? 1 : 0) + (type !== "all" ? 1 : 0);

  const loading = res.loading && !res.data;
  const denied = !res.data && res.failure?.status === 403;
  const failed = !!res.error && !res.data && !denied;
  const ready = !!res.data;

  const qs = `?tab=${tab}`;
  const open = (p: Project) => navigate(`/m/rd/${encodeURIComponent(p.id)}${qs}`);
  // Tablet split (prototype): the first project of the section opens beside the list.
  const listFor = (t: Tab) =>
    t === "summary" || t === "reports"
      ? sortProjects(tabPool(all, t), "target")
      : sortProjects(baseFilter(tabPool(all, t), q, type).filter((p) => cat === "all" || p.productCategory === cat), sort);
  const first = listFor(tab)[0]?.id;
  useEffect(() => {
    if (wide && !openId && first) navigate(`/m/rd/${encodeURIComponent(first)}${qs}`, { replace: true });
  }, [wide, openId, first, qs, navigate]);
  const setTab = (k: Tab) => {
    const f = wide ? listFor(k)[0]?.id : undefined;
    navigate(f ? `/m/rd/${encodeURIComponent(f)}?tab=${k}` : `/m/rd?tab=${k}`, { replace: true });
  };
  const clearFilters = () => {
    setQ("");
    setCat("all");
    setType("all");
  };
  const ctx = {
    toast: toast.show,
    pop: () => setFrames((s) => s.slice(0, -1)),
    onCreated: (id: string) => navigate(`/m/rd/${encodeURIComponent(id)}?tab=drafts`, { state: { rdToast: "Project created as a draft" } }),
  };
  const newProject = () => setFrames([{ kind: "new" }]);
  const gridCols = !inPane && layout.mode !== "phone" ? undefined : 1;

  let body: ReactNode;
  if (loading) {
    body = (
      <div aria-busy="true" aria-label="Loading projects" style={{ padding: "12px 16px", display: "grid", gap: 10 }}>
        <Skeleton h={86} />
        <Skeleton h={220} />
        <Skeleton h={220} />
      </div>
    );
  } else if (denied) {
    body = <StateCard icon={Lock} title="You can't see R&D projects" sub="Your role doesn't include R&D access. Ask an admin." />;
  } else if (failed) {
    body = <StateCard icon={CloudOff} tone="bad" role="alert" title="Couldn't load projects" sub={res.error || "The R&D service didn't answer."} btn="Try again" onTap={() => res.refresh()} />;
  } else if (!all.length) {
    body = (
      <StateCard
        icon={FlaskConical}
        title="No R&D projects yet"
        sub="Start a project to track its stages, budget and prototypes."
        btn={perms.create ? "New project" : undefined}
        onTap={newProject}
      />
    );
  } else if (tab === "summary") {
    body = <SummaryTab all={all} today={today} open={open} />;
  } else if (tab === "reports") {
    body = <ReportsTab all={all} open={open} current={inPane ? openId : undefined} />;
  } else {
    const chips = (
      <div className="tpl-scroll" role="group" aria-label="Category" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px 4px", scrollbarWidth: "none" }}>
        {CHIPS.map((c) => {
          const on = cat === c.k;
          return (
            <button key={c.k} type="button" aria-pressed={on} onClick={() => setCat(c.k)} style={{ ...CHIP_BTN(on), height: 40 }}>
              {c.l}
              <span style={{ minWidth: 20, height: 20, padding: "0 6px", boxSizing: "border-box", borderRadius: 999, background: on ? "rgba(255,255,255,.24)" : R.chip, color: on ? "#FFFFFF" : R.sub, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>
                {catCount(base, c.k)}
              </span>
            </button>
          );
        })}
      </div>
    );
    const none = filtered ? (
      <StateCard icon={SearchX} title="No projects match" sub="Try another search, category or type." btn="Clear filters" onTap={clearFilters} />
    ) : tab === "drafts" ? (
      <StateCard icon={FilePen} title="No drafts" sub="New projects land here until you start them." />
    ) : tab === "completed" ? (
      <StateCard icon={FolderOpen} title="Nothing completed yet" sub="Projects show here as they move through their stages." />
    ) : (
      <StateCard icon={FolderOpen} title="No projects here" sub="Projects show here as they move through their stages." />
    );
    if (tab === "pipeline") {
      body = (
        <>
          {chips}
          <div style={{ padding: "0 16px" }}>
            <Label t={`${list.length} IN PROGRESS`} r="Swipe for more stages" />
          </div>
          {list.length || !filtered ? <Pipeline list={list} today={today} open={open} current={inPane ? openId : undefined} /> : none}
          <div style={{ padding: "12px 16px 0" }}>
            <Note>Stages change only from a project's workspace, one stage at a time.</Note>
          </div>
        </>
      );
    } else {
      body = (
        <>
          {chips}
          <div style={{ padding: "0 16px" }}>
            <Label t={plural(list.length, "PROJECT", "PROJECTS")} r={SORT_LABEL[sort]} />
          </div>
          {list.length ? (
            <div style={{ padding: "0 16px" }}>
              <ResponsiveGrid maxColumns={gridCols} gap={10}>
                {list.map((p) => (
                  <ProjectCard
                    key={p.id}
                    p={p}
                    today={today}
                    current={inPane && p.id === openId}
                    onOpen={() => open(p)}
                    onStart={p.status === "DRAFT" && perms.update ? () => life.ask(p, "start") : undefined}
                  />
                ))}
              </ResponsiveGrid>
            </div>
          ) : (
            none
          )}
        </>
      );
    }
  }

  return (
    <>
      <TplStyles />
      <MobileHeader
        title="R&D Projects"
        menu
        onBack={() => navigate(-1)}
        trailing={perms.create && !denied ? (
          <button type="button" aria-label="New project" onClick={newProject} style={PLUS_BTN}>
            <Plus size={20} strokeWidth={2.2} />
          </button>
        ) : null}
      />
      <nav ref={tabsRef} className="tpl-scroll" aria-label="R&D sections" style={{ position: "relative", display: "flex", gap: 2, overflowX: "auto", padding: "0 8px", borderBottom: `1px solid ${R.ln}`, scrollbarWidth: "none", background: R.bg }}>
        {TABS.map((t) => {
          const Icon = TAB_ICON[t.k];
          const on = tab === t.k;
          return (
            <button key={t.k} type="button" aria-current={on ? "page" : undefined} onClick={() => setTab(t.k)} style={TAB_BTN(on)}>
              <Icon size={16} strokeWidth={on ? 2.2 : 1.9} aria-hidden />
              {t.l}
            </button>
          );
        })}
      </nav>
      {cardTab && ready && all.length ? (
        <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
          <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: R.card, borderRadius: 14, boxShadow: SH_CONTROL }}>
            <Search size={18} strokeWidth={1.75} color={R.ph} style={{ flex: "none" }} aria-hidden />
            <input
              className="tpl-in"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Code, name, type or category"
              aria-label="Search projects"
              style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: R.ink, padding: 0, textOverflow: "ellipsis" }}
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ width: 36, height: 36, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: R.mut, flex: "none" }}>
                <XIcon size={15} strokeWidth={2.2} />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            onClick={() => setSortOpen(true)}
            aria-label={fN ? `Sort and filter, ${fN} on` : "Sort and filter"}
            style={{ position: "relative", width: 44, height: 44, flex: "none", borderRadius: "50%", border: "none", background: R.card, color: R.br, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: SH_CONTROL }}
          >
            <ArrowDownUp size={17} strokeWidth={1.9} />
            {fN ? (
              <span style={{ position: "absolute", top: -2, right: -2, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: R.grad, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{fN}</span>
            ) : null}
          </button>
        </div>
      ) : null}
      {body}
      <div style={{ height: 28 }} />

      <TplSheet
        open={sortOpen}
        title="Sort and filter"
        onClose={() => setSortOpen(false)}
        groups={[
          {
            t: "SORT BY",
            rows: ([["target", "Target date — soonest"], ["code", "Code"], ["budget", "Budget used — highest"]] as [Sort, string][]).map(([k, l]) => ({
              key: k, l, check: sort === k, pressed: sort === k, onTap: () => { setSort(k); setSortOpen(false); },
            })),
          },
          {
            t: "PROJECT TYPE",
            rows: ([["all", "All types"], ["DEVELOPMENT", "Research"], ["IMPROVEMENT", "Improvement"], ["CLONE", "Clone"]] as [TypeFilter, string][]).map(([k, l]) => ({
              key: k, l, check: type === k, pressed: type === k, onTap: () => { setType(k); setSortOpen(false); },
            })),
          },
        ]}
      />
      {life.node}
      <FormStack frames={frames} ctx={ctx} />
      {toast.node}
    </>
  );
}

// ---- project / draft card ------------------------------------------------------------------
function ProjectCard({ p, today, current, onOpen, onStart }: { p: Project; today: string; current: boolean; onOpen: () => void; onStart?: () => void }) {
  const L = stageLabels(p.projectType);
  const draft = p.status === "DRAFT";
  const done = p.status === "COMPLETED";
  const pct = budgetPct(p);
  const bar = TONE[barTone(pct)][0];
  const chips = healthChips(p, today);
  const [rail] = TONE[STATUS_TONE[p.status]];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${p.code} ${p.name}, ${STATUS_LABEL[p.status]}`}
      aria-current={current ? "true" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        position: "relative", overflow: "hidden", borderRadius: 18, padding: "14px 14px 14px 18px", cursor: "pointer", minWidth: 0, color: R.ink,
        background: draft ? R.bg : R.card, boxShadow: current ? SH_CARD_ON : draft ? "none" : SH_CARD, WebkitTapHighlightColor: "transparent",
        border: draft && !current ? `1.5px dashed ${R.chev}` : "none",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
        <Thumb src={thumbOf(p)} cat={p.productCategory} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: R.br, letterSpacing: 0.2 }}>{p.code}</span>
            <ChevronRight size={17} strokeWidth={2} color={R.chev} aria-hidden />
          </div>
          <div style={{ marginTop: 2, fontSize: 16, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{p.name || "Untitled project"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            <Badge size="sm" c={{ l: STATUS_LABEL[p.status], t: STATUS_TONE[p.status] }} />
            <Badge size="sm" c={{ l: TYPE_LABEL[p.projectType], t: "br" }} />
            <Badge size="sm" c={{ l: CATEGORY_LABEL[p.productCategory], t: "neu" }} />
          </div>
        </div>
      </div>
      {draft && p.description ? <div style={{ marginTop: 10, fontSize: 12.5, color: R.sub, lineHeight: 1.45, overflowWrap: "anywhere" }}>{p.description}</div> : null}
      <div style={{ marginTop: 12 }}>
        <StageBar stage={p.currentStage} done={done} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 7, fontSize: 12, color: R.sub }}>
        <span style={{ minWidth: 0 }}>{done ? "Completed" : `Stage ${stageIndex(p.currentStage) + 1} of 6 · ${L[p.currentStage]}`}</span>
        <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{p.targetLaunchDate ? `Target ${fmtDate(p.targetLaunchDate)}` : "No target date"}</span>
      </div>
      {chips.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
          {chips.map((c) => <Badge key={c.l} size="sm" c={c} />)}
        </div>
      ) : null}
      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: R.tint }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: R.sub }}>
          <span>Budget used</span>
          <span style={{ fontWeight: 700, color: bar, fontVariantNumeric: "tabular-nums" }}>{pct1(pct)}</span>
        </div>
        <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: R.chip, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 999, background: bar }} />
        </div>
        <div style={{ marginTop: 7, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
          {rm(p.actualCost)} of {rm(p.totalBudget)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: p.assignedTeam.length ? R.sub : R.mut }}>
          <Users size={14} strokeWidth={1.9} color={R.gold} style={{ flex: "none" }} aria-hidden />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.assignedTeam.join(", ") || "No team yet"}</span>
        </span>
        {onStart ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            style={{ flex: "none", height: 40, padding: "0 14px", borderRadius: 999, border: "none", background: R.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          >
            <Play size={14} strokeWidth={2.4} />
            Start Project
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---- Pipeline (Active + On Hold) -----------------------------------------------------------
function Pipeline({ list, today, open, current }: { list: Project[]; today: string; open: (p: Project) => void; current?: string }) {
  return (
    <div className="tpl-scroll" style={{ display: "flex", gap: 10, overflowX: "auto", padding: "2px 16px 6px", scrollSnapType: "x mandatory", scrollbarWidth: "none" }}>
      {STAGES.map((s) => {
        const g = list.filter((p) => p.currentStage === s);
        return (
          <section key={s} aria-label={defaultStageLabel(s)} style={{ flex: "none", width: 236, scrollSnapAlign: "start", borderRadius: 16, background: R.tint, padding: 10, boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 2px 8px" }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: STAGE_COLOR[s] }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700 }}>{defaultStageLabel(s)}</span>
              <span style={{ minWidth: 22, height: 20, padding: "0 7px", boxSizing: "border-box", borderRadius: 999, background: R.card, fontSize: 11, fontWeight: 700, color: R.sub, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{g.length}</span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {g.length ? g.map((p) => {
                const late = scheduleChip(p, today)?.t === "bad";
                const [cc, cb] = CAT_TONE[p.productCategory];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => open(p)}
                    aria-label={`${p.code} ${p.name}`}
                    style={{ display: "flex", gap: 9, alignItems: "flex-start", width: "100%", padding: 10, borderRadius: 12, border: "none", background: R.card, boxShadow: p.id === current ? SH_CARD_ON : `0 0 0 1px ${R.ring}`, fontFamily: "inherit", textAlign: "left", color: R.ink, cursor: "pointer" }}
                  >
                    <Thumb src={thumbOf(p)} cat={p.productCategory} size={40} radius={10} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: R.br }}>{p.code}</span>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{p.name}</span>
                      <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                        <span style={{ height: 18, padding: "0 7px", borderRadius: 6, background: cb, color: cc, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, display: "inline-flex", alignItems: "center" }}>{CATEGORY_LABEL[p.productCategory].toUpperCase()}</span>
                        {p.status === "ON_HOLD" ? <Badge size="sm" c={{ l: "On Hold", t: "warn" }} /> : null}
                      </span>
                      <span style={{ display: "block", marginTop: 4, fontSize: 11, color: late ? R.bad : R.mut, fontWeight: late ? 700 : 500 }}>{p.targetLaunchDate ? fmtDate(p.targetLaunchDate) : "No target date"}</span>
                    </span>
                  </button>
                );
              }) : <div style={{ padding: "14px 4px", textAlign: "center", fontSize: 12, color: R.mut }}>No projects</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---- Summary (Active + On Hold) ------------------------------------------------------------
function SummaryTab({ all, today, open }: { all: Project[]; today: string; open: (p: Project) => void }) {
  const s = summary(all, today);
  return (
    <div style={{ padding: "12px 16px 0" }}>
      <Tiles
        tiles={[
          { l: "Overdue", v: String(s.overdue), icon: CalendarX, tone: "bad" },
          { l: "At Risk", v: String(s.atRisk), icon: TriangleAlert, tone: "warn" },
          { l: "Over Budget", v: String(s.overBudget), icon: Wallet, tone: "bad" },
          { l: "Budget Utilization", v: pct1(s.utilization), icon: Gauge, tone: "info", vc: TONE[barTone(s.utilization)][0] },
        ]}
      />
      <Label t="NEEDS ATTENTION" r={String(s.attention.length)} />
      <div style={{ display: "grid", gap: 8 }}>
        {s.attention.length ? s.attention.map(({ p, chips }) => {
          const h = projectHealth(p, today);
          return (
            <DocCard
              key={p.id}
              d={{
                code: p.code, badges: chips, title: p.name, rail: R.bad, onTap: () => open(p),
                sub: `${p.targetLaunchDate ? `Target ${fmtDate(p.targetLaunchDate)}` : "No target date"} · ${stageLabels(p.projectType)[p.currentStage]}${h.schedule === "overdue" ? ` · ${dayCount(-(h.daysToTarget ?? 0))} late` : ""}`,
              }}
            />
          );
        }) : <InlineState icon={CircleCheck} tone="ok" h="All on track" t="No project has a schedule or budget issue." />}
      </div>
      <Label t="OVERDUE MILESTONES" r={String(s.overdueMilestones.length)} />
      <div style={{ display: "grid", gap: 8 }}>
        {s.overdueMilestones.length ? s.overdueMilestones.map(({ p, m, days }) => (
          <DocCard
            key={`${p.id}-${m.stage}`}
            d={{ code: p.code, badges: [{ l: `${dayCount(days)} overdue`, t: "bad" }], title: p.name, sub: `${stageLabels(p.projectType)[m.stage]} milestone · target ${fmtDate(m.targetDate)}`, rail: R.bad, onTap: () => open(p) }}
          />
        )) : <InlineState icon={CalendarCheck} tone="ok" h="No overdue milestones" t="Every open milestone with a target date is still within it." />}
      </div>
    </div>
  );
}

// ---- Reports (non-draft projects, as desktop) ----------------------------------------------
function ReportsTab({ all, open, current }: { all: Project[]; open: (p: Project) => void; current?: string }) {
  const r = reports(all);
  const mxS = Math.max(1, ...r.byStage.map((x) => x.n));
  const mxC = Math.max(1, ...r.byCategory.map((x) => x.n));
  const bars = (rows: { l: string; n: number; c: string; mx: number }[]) => (
    <div style={{ ...CARD, padding: "12px 14px", display: "grid", gap: 10 }}>
      {rows.map((b) => (
        <div key={b.l} style={{ display: "grid", gridTemplateColumns: "minmax(92px,34%) minmax(0,1fr) 28px", alignItems: "center", gap: 10, fontSize: 12.5 }}>
          <span style={{ color: R.sub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.l}</span>
          <span style={{ height: 10, borderRadius: 999, background: R.chip, overflow: "hidden" }}>
            <span style={{ display: "block", width: `${(b.n / b.mx) * 100}%`, height: "100%", borderRadius: 999, background: b.c }} />
          </span>
          <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{b.n}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ padding: "12px 16px 0" }}>
      <Tiles
        tiles={[
          { l: "Total Projects", v: String(r.total), icon: FolderKanban, tone: "br" },
          { l: "Active Projects", v: String(r.active), icon: Activity, tone: "info" },
          { l: "Total Budget", v: rm(r.totalBudget), icon: Wallet, tone: "ok" },
          { l: "Total R&D Spend", v: rm(r.spend), icon: Receipt, tone: "warn" },
        ]}
      />
      <div style={{ marginTop: 8 }}>
        <Note>Reports exclude drafts. Total R&D Spend is the material issued to projects; labour shows on each project.</Note>
      </div>
      <Label t="PROJECTS BY STAGE" r="Excludes drafts" />
      {bars(r.byStage.map((x) => ({ l: defaultStageLabel(x.s), n: x.n, c: STAGE_COLOR[x.s], mx: mxS })))}
      <Label t="PROJECTS BY CATEGORY" r="Excludes drafts" />
      {bars(r.byCategory.map((x) => ({ l: CATEGORY_LABEL[x.c], n: x.n, c: "var(--xo-star)", mx: mxC })))}
      <Label t="ALL PROJECTS — COST & TIMELINE" r={String(r.pool.length)} />
      <div style={{ display: "grid", gap: 8 }}>
        {sortProjects(r.pool, "code").map((p) => {
          const pct = budgetPct(p);
          const tone = TONE[barTone(pct)][0];
          const n = p.prototypes.length;
          return (
            <div key={p.id} style={{ borderRadius: 16, boxShadow: p.id === current ? `0 0 0 2px ${R.pri}` : undefined }}>
              <DocCard
                d={{
                  code: p.code,
                  badges: [p.status === "COMPLETED" ? { l: "Completed", t: "ok" } : p.status === "CANCELLED" ? { l: "Cancelled", t: "bad" } : { l: stageLabels(p.projectType)[p.currentStage], t: "br" }],
                  title: p.name,
                  sub: `${CATEGORY_LABEL[p.productCategory]} · ${p.targetLaunchDate ? `target ${fmtDate(p.targetLaunchDate)}` : "no target date"} · ${plural(n, "prototype")}`,
                  amts: [{ k: "Budget", v: rm(p.totalBudget) }, { k: "Actual", v: rm(p.actualCost) }, { k: "Used", v: pct1(pct), c: tone }],
                  rail: tone,
                  onTap: () => open(p),
                }}
              />
            </div>
          );
        })}
        {!r.pool.length ? <InlineState t="No started projects yet. Drafts are not counted here." /> : null}
      </div>
    </div>
  );
}
