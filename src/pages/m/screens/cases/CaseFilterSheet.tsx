// Filter sheet for the Service Cases list. Groups follow the Phase 4 prototype (Source · Root-cause
// category · Department · Stage · Created · Age) with its footer (Reset · Show N cases). The
// prototype builds sort options but never renders a control, so one "Sort by" group (its six
// SORTS) is added at the end — reported as a deviation.
import { type ReactNode } from "react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { CASE_PIPELINE_STEPS, ROOT_CAUSE_KEYS, ROOT_CAUSE_SHORT, type SourceType } from "./case-model";
import { CC, SH_CTRL } from "./case-style";
import { Chip } from "./case-ui";
import { EMPTY_FILTERS, SORT_LABEL, toggle, type CaseFilters, type CreatedRange, type SortKey } from "./case-filters";

function Group({ title, hint, children, role }: { title: string; hint?: string; children: ReactNode; role?: string }) {
  return (
    <section aria-label={title}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 2px 10px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, textTransform: "uppercase" }}>{title}</span>
        {hint ? <span style={{ fontSize: 11.5, color: M.ink }}>{hint}</span> : null}
      </div>
      <div role={role} style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{children}</div>
    </section>
  );
}

const chip = (label: string, on: boolean, onClick: () => void, role?: string) => (
  <Chip key={label} label={label} on={on} onClick={onClick} h={36} pad={14} role={role} />
);

export function CaseFilterSheet({
  open,
  onClose,
  value,
  onChange,
  departments,
  matchCount,
}: {
  open: boolean;
  onClose: () => void;
  value: CaseFilters;
  onChange: (f: CaseFilters) => void;
  /** Distinct department names actually present on loaded cases. */
  departments: string[];
  matchCount: number;
}) {
  const set = (patch: Partial<CaseFilters>) => onChange({ ...value, ...patch });
  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      <div style={{ display: "grid", gap: 22, paddingBottom: 8 }}>
        <Group title="Source">
          {([["SO", "Sales order"], ["CO", "Consignment"], ["EXTERNAL", "External"]] as [SourceType, string][]).map(([k, l]) => chip(l, value.src.includes(k), () => set({ src: toggle(value.src, k) }), "checkbox"))}
        </Group>
        <Group title="Root-cause category" hint="Any cause matches">
          {ROOT_CAUSE_KEYS.map((k) => chip(ROOT_CAUSE_SHORT[k], value.cats.includes(k), () => set({ cats: toggle(value.cats, k) }), "checkbox"))}
        </Group>
        {departments.length > 0 ? (
          <Group title="Department" hint="First root cause">
            {departments.map((d) => chip(d, value.depts.includes(d), () => set({ depts: toggle(value.depts, d) }), "checkbox"))}
          </Group>
        ) : null}
        <Group title="Stage" hint="Derived progress">
          {CASE_PIPELINE_STEPS.map((s, i) => chip(s, value.stages.includes(i), () => set({ stages: toggle(value.stages, i) }), "checkbox"))}
        </Group>
        <Group title="Created" role="radiogroup">
          {([["all", "Any time"], ["month", "This month"], ["30", "Last 30 days"]] as [CreatedRange, string][]).map(([k, l]) => chip(l, value.created === k, () => set({ created: k }), "radio"))}
        </Group>
        <Group title="Age" hint="Active cases only">
          {chip("Open 7+ days", value.aged, () => set({ aged: !value.aged }), "checkbox")}
        </Group>
        <Group title="Sort by" role="radiogroup">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => chip(SORT_LABEL[k], value.sort === k, () => set({ sort: k }), "radio"))}
        </Group>
      </div>
      <div style={{ position: "sticky", bottom: -16, display: "flex", gap: 10, margin: "6px -16px -16px", padding: "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))", background: M.paper, boxShadow: "0 -1px 0 #E6E0D9" }}>
        <button type="button" onClick={() => onChange(EMPTY_FILTERS)} style={{ flex: "none", height: 46, padding: "0 18px", borderRadius: 12, border: "none", background: M.card, color: M.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: SH_CTRL }}>Reset</button>
        <button type="button" onClick={onClose} style={{ flex: 1, height: 46, borderRadius: 12, border: "none", background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{`Show ${matchCount} case${matchCount === 1 ? "" : "s"}`}</button>
      </div>
    </Sheet>
  );
}
