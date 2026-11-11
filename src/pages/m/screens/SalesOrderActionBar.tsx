// SalesOrderActionBar — the Sales Order status actions at EVERY width (phone, fold, tablet), in the
// phone design language (the Delivery detail's bottom bar and buttons). What each status offers, and
// to whom, is data (lib/so-actions.ts: the desktop rules + the user's permissions); every button calls
// a handler from lib/use-so-actions.ts. The phone's bar sits above the tab bar, like the Delivery one.
import { type ReactNode } from "react";
import { M } from "../theme";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { SO_ACTION_LABEL, type SoActionKind, type SoActionPlan } from "../lib/so-actions";
import { BottomDock, PrimaryButton, SecondaryButton } from "./delivery/ui";
import { SHADOW_CONTROL, sem } from "./delivery/ui-tokens";

export type SoHandlers = Record<SoActionKind, () => void>;

function DangerButton({ children, onClick, disabled, title }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1, minWidth: 0, height: 50, borderRadius: 14, border: "none", background: M.card, color: sem("danger"),
        fontFamily: "inherit", fontSize: "var(--m-type-button-size)", fontWeight: 700, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        boxShadow: SHADOW_CONTROL, WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/** Renders nothing for a status with no action and nothing to say. */
export function SalesOrderActionBar({ plan, busy, on }: { plan: SoActionPlan; busy: boolean; on: SoHandlers }) {
  const layout = useResponsiveLayout();
  if (plan.rows.length === 0 && !plan.note) return null;

  const button = (kind: SoActionKind, primary: boolean) => {
    const label = SO_ACTION_LABEL[kind];
    const why = plan.disabled?.[kind];
    // Edit and the override only open a sheet; every other action is a request, so it waits for the one in flight.
    const sheetOnly = kind === "edit" || kind === "edit-draft" || kind === "override-edit" || kind === "issue-do" || kind === "hold" || kind === "generate-invoice" || kind === "service-case";
    const disabled = !!why || (busy && !sheetOnly);
    if (kind === "cancel" || kind === "delete-draft") return <DangerButton key={kind} onClick={on[kind]} disabled={disabled} title={why}>{label}</DangerButton>;
    if (primary) return <PrimaryButton key={kind} onClick={on[kind]} disabled={disabled}>{label}</PrimaryButton>;
    return <SecondaryButton key={kind} onClick={on[kind]} disabled={disabled}>{label}</SecondaryButton>;
  };

  // Primary = the forward action of the status; the rest are secondary.
  const primaryKinds = new Set<SoActionKind>(["confirm", "undo-cancel", "issue-do", "resume", "generate-invoice"]);

  return (
    <BottomDock variant="detail" scope={layout.canSplitDetail ? "detail" : "content"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, width: "100%" }}>
        {plan.note ? (
          <div style={{ textAlign: "center", fontSize: 12, color: M.muted, padding: "2px 0" }}>{plan.note}</div>
        ) : null}
        {plan.rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 9 }}>
            {row.map((kind) => button(kind, primaryKinds.has(kind)))}
          </div>
        ))}
      </div>
    </BottomDock>
  );
}
