// ===========================================================================
// Planning v2 — the ⋯ "More" sheet (CHANGES.md §Navigation, §6, §7): Lead Times
// and Schedule Proposals (both view only) and the two existing server-rendered
// reports. The reports only show for production-orders:read — the API answers
// raw JSON 401/403 to anyone else.
// ===========================================================================
import { ChevronRight, Clock, CalendarClock, FileWarning, Printer, X, type LucideIcon } from "lucide-react";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { DL, SHADOW_MENU } from "../delivery/ui-tokens";

type Item = { key: string; label: string; sub: string; tag: string; icon: LucideIcon; chevron: boolean; onClick: () => void };

export function MoreSheet({
  open,
  onClose,
  canRead,
  pendingCount,
  onLeadTimes,
  onProposals,
  onReport,
}: {
  open: boolean;
  onClose: () => void;
  canRead: boolean;
  pendingCount: number;
  onLeadTimes: () => void;
  onProposals: () => void;
  onReport: (which: "schedule" | "overdue") => void;
}) {
  const items: Item[] = [
    { key: "lead", label: "Lead Times", sub: "Department lead days, DD buffer and history", tag: "View only", icon: Clock, chevron: true, onClick: onLeadTimes },
    ...(canRead
      ? [
          {
            key: "props",
            label: "Schedule Proposals",
            sub: pendingCount > 0 ? `${pendingCount} pending · approve on desktop` : "No pending proposals",
            tag: "View only",
            icon: CalendarClock,
            chevron: true,
            onClick: onProposals,
          },
          { key: "sched", label: "Today’s Production Schedule", sub: "Jobs due today by department", tag: "Report", icon: Printer, chevron: true, onClick: () => onReport("schedule") },
          { key: "over", label: "Customer Overdue Report", sub: "Sales orders past Customer DD", tag: "Report", icon: FileWarning, chevron: true, onClick: () => onReport("overdue") },
        ]
      : []),
  ];
  return (
    <Sheet open={open} onClose={onClose} title="More" bare>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px 4px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>More</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ flex: "none", background: "none", border: "none", width: 44, height: 44, marginRight: -10, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.ink }}>
          <X size={20} strokeWidth={1.75} />
        </button>
      </div>
      <div style={{ padding: "4px 16px 34px" }}>
        <div style={{ background: M.card, borderRadius: 16, overflow: "hidden", boxShadow: SHADOW_MENU }}>
          {items.map((m, i) => (
            <button
              key={m.key}
              type="button"
              onClick={m.onClick}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 15px", background: "none", border: "none", boxShadow: i ? `inset 0 1px 0 ${DL.track}` : "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: DL.tile, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <m.icon size={17} strokeWidth={1.9} color={M.taupe} aria-hidden />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin }}>{m.label}</span>
                <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{m.sub}</span>
              </span>
              <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: DL.track, color: M.ink, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{m.tag}</span>
              {m.chevron ? <ChevronRight size={18} strokeWidth={1.9} color={DL.icon} aria-hidden /> : null}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
