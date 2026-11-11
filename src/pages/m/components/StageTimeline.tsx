// ===========================================================================
// StageTimeline — the vertical department timeline ("Stage progress") shared by
// the phone Production Order detail (screens/ProductionDetailScreen.tsx) and the
// inline per-order timeline on the Sales Order detail (screens/SalesOrderDetail.tsx).
//
// Presentational only: callers compute each row from the DESKTOP `cellFor` /
// `stageKind` (src/pages/production/utils.ts), so Done / In progress / Pending /
// Overdue / N/A mean the same thing everywhere. Lifted verbatim from
// ProductionDetailScreen so that screen's output is unchanged.
// ===========================================================================
import { Check, TriangleAlert } from "lucide-react";
import type { StageKind } from "@/pages/production/utils";
import { M } from "../theme";
import { TINT_DANGER, TINT_INFO, TINT_WARNING } from "../lib/production-ui";

export type StageRow = {
  code: string;
  name: string;
  kind: StageKind;
  doneCards: number;
  totalCards: number;
  /** Second line: "Completed 6 Nov · NAMES" / "Due 11 Nov". May be empty. */
  meta: string;
  /** Bold the department name (the order's current department). */
  current: boolean;
};

// Stage pill look per desktop stageKind. "Done" is the teal --m-po-done.
const DONE_TINT = {
  fg: "var(--m-po-done)",
  bg: "color-mix(in srgb, var(--m-po-done) 14%, transparent)",
};
const STAGE_LOOK: Record<StageKind, { label: string; bg: string; fg: string }> = {
  done: { label: "Done", ...DONE_TINT },
  inProgress: { label: "In progress", ...TINT_INFO },
  pending: { label: "Pending", ...TINT_WARNING },
  overdue: { label: "Overdue", ...TINT_DANGER },
  skipped: { label: "N/A", bg: "transparent", fg: "var(--m-inv-ref-key)" },
};
const NODE_BG: Record<StageKind, string> = {
  done: "var(--m-po-done)",
  inProgress: "var(--m-text-status-info)",
  pending: "var(--m-card)",
  overdue: "var(--m-text-status-danger)",
  skipped: "var(--m-card)",
};

export function StageTimeline({ rows }: { rows: StageRow[] }) {
  return (
    <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
      {rows.map((r, idx) => {
        const kind = r.kind;
        const look = STAGE_LOOK[kind];
        const nextKind = rows[idx + 1]?.kind;
        return (
          <li key={r.code} style={{ position: "relative", display: "flex", gap: 12, paddingBottom: 14 }}>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 12,
                top: 28,
                bottom: 2,
                width: 2,
                borderRadius: 2,
                background:
                  idx === rows.length - 1
                    ? "transparent"
                    : kind === "done" && nextKind !== "skipped"
                      ? "var(--m-po-done)"
                      : "var(--m-segment-track)",
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                flex: "none",
                width: 26,
                height: 26,
                boxSizing: "border-box",
                borderRadius: "50%",
                background: NODE_BG[kind],
                boxShadow:
                  kind === "pending" || kind === "skipped"
                    ? "inset 0 0 0 2px var(--m-inv-dot-ring)"
                    : kind === "inProgress"
                      ? "0 0 0 4px color-mix(in srgb, var(--m-text-status-info) 18%, transparent)"
                      : "none",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {kind === "done" ? <Check size={14} strokeWidth={3} /> : null}
              {kind === "overdue" ? <TriangleAlert size={13} strokeWidth={2.6} /> : null}
              {kind === "inProgress" ? (
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
              ) : null}
            </span>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13.5,
                    fontWeight: r.current ? 800 : 600,
                    color: kind === "skipped" ? "var(--m-inv-ref-key)" : M.raisin,
                  }}
                >
                  {r.name}
                </span>
                <span
                  style={{
                    flex: "none",
                    height: 22,
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 8px",
                    borderRadius: 999,
                    background: look.bg,
                    color: look.fg,
                    boxShadow: kind === "skipped" ? "inset 0 0 0 1.5px var(--m-inv-dot-ring)" : "none",
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {kind === "skipped" ? "N/A" : `${look.label} ${r.doneCards}/${r.totalCards}`}
                </span>
              </div>
              {r.meta ? (
                <div
                  style={{
                    fontSize: 12,
                    color: kind === "overdue" ? TINT_DANGER.fg : M.ink,
                    marginTop: 3,
                    wordBreak: "break-word",
                  }}
                >
                  {r.meta}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
