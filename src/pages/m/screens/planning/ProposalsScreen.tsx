// ===========================================================================
// Planning v2 — Schedule Proposals (CHANGES.md §5, VIEW ONLY). Generate /
// Approve / Reject stay on desktop (approving is what updates dept due dates).
// Reads GET /api/planning/proposals?status=… — one status per request, so "All"
// is the three lists together. Needs production-orders:read, like the API.
// ===========================================================================
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { M } from "../../theme";
import { CHIP_COUNT, CHIP_ROW, CHIP_ROW_CLASS, chip as chipStyle, chipDot } from "../../lib/control-styles";
import { PROPOSAL_STATUSES, generatedLabel, proposalDeptName, useProposals, type ProposalRow } from "../../lib/planning-data";
import { LANE_LABEL, diffDays, shortDate, laneOf } from "../../lib/planning-schedule";
import { sem, type Tone } from "../delivery/ui-tokens";
import { CardTitleRow, EmptyState, ErrorState, NoAccessState, Pill, ProductLine, RailCard, RefChip, RefRow, SectionRow, SkeletonCards } from "./ui";
import { ViewOnlyNote } from "./LeadTimesScreen";

export type ProposalFilter = "ALL" | (typeof PROPOSAL_STATUSES)[number];
const CHIPS: { key: ProposalFilter; label: string; dot?: Tone }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending", dot: "warning" },
  { key: "APPROVED", label: "Approved", dot: "success" },
  { key: "REJECTED", label: "Rejected", dot: "neutral" },
];
const TONE: Record<string, Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "neutral" };
const LABEL: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };

export function ProposalsScreen({ canRead, filter, onFilter }: { canRead: boolean; filter: ProposalFilter; onFilter: (f: ProposalFilter) => void }) {
  const { rows, loading, error, refresh } = useProposals(canRead);
  const shown = useMemo(() => rows.filter((p) => filter === "ALL" || p.status === filter), [rows, filter]);
  const count = (k: ProposalFilter) => rows.filter((p) => k === "ALL" || p.status === k).length;
  const latest = rows.reduce((m, p) => (p.generatedAt > m ? p.generatedAt : m), "");

  if (!canRead) {
    return (
      <div style={{ padding: "2px 18px 24px" }}>
        <NoAccessState text="Schedule proposals need the production orders read permission." />
      </div>
    );
  }
  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ margin: "2px 18px 0" }}>
        <ViewOnlyNote>View only. Generating, approving and rejecting proposals stays on desktop. Approving is what updates department due dates.</ViewOnlyNote>
      </div>
      <div className={CHIP_ROW_CLASS} style={CHIP_ROW} role="group" aria-label="Proposal status">
        {CHIPS.map((c) => {
          const on = filter === c.key;
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => onFilter(c.key)} style={chipStyle(on)}>
              {c.dot ? <span aria-hidden="true" style={chipDot(sem(c.dot))} /> : null}
              {c.label}
              <span style={CHIP_COUNT}>{count(c.key)}</span>
            </button>
          );
        })}
      </div>
      <SectionRow left={`${shown.length} PROPOSAL${shown.length === 1 ? "" : "S"}`} right={generatedLabel(latest)} />
      <div style={{ padding: "0 18px" }}>
        {loading && rows.length === 0 ? (
          <SkeletonCards n={3} h={200} />
        ) : error && rows.length === 0 ? (
          <ErrorState title="Could not load proposals" text={error} onRetry={refresh} />
        ) : shown.length === 0 ? (
          <EmptyState title={filter === "PENDING" ? "No pending proposals" : "No proposals in this status."} />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {shown.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalCard({ p }: { p: ProposalRow }) {
  const tone = TONE[p.status] ?? "neutral";
  const shift = p.currentDue ? diffDays(p.proposedDue.slice(0, 10), p.currentDue.slice(0, 10)) : null;
  const shiftText = shift === null ? "" : shift > 0 ? ` · +${shift}d` : shift < 0 ? ` · ${shift}d` : "";
  const lane = laneOf(p.lane);
  return (
    <RailCard tone={tone}>
      <CardTitleRow code={p.soRef || "—"} pill={<Pill tone={tone} label={LABEL[p.status] ?? p.status} />} chevron={false} />
      <ProductLine>{proposalDeptName(p.dept)}</ProductLine>
      <RefRow>
        {lane ? <RefChip k="Lane" v={LANE_LABEL[lane]} /> : null}
        {p.fabric ? <RefChip k="Fabric" v={p.fabric} /> : null}
      </RefRow>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "9px 11px", borderRadius: 12, background: M.paper }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>CURRENT DUE</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: M.ink, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{p.currentDue ? shortDate(p.currentDue) : "Not set"}</div>
        </div>
        <ArrowRight size={16} strokeWidth={2} color="var(--dl-icon)" aria-hidden />
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>PROPOSED DUE</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {shortDate(p.proposedDue)}
            <span style={{ color: sem(shift !== null && shift > 0 ? "warning" : "info") }}>{shiftText}</span>
          </div>
        </div>
      </div>
      {p.reason ? <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--dl-body)", marginTop: 9 }}>{p.reason}</div> : null}
    </RailCard>
  );
}

