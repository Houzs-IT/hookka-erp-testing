// SalesOrderActionBar — the Sales Order status actions on wider screens, in the phone
// design language (the Delivery detail's bottom bar and buttons). What each status
// offers is data (lib/so-actions.ts); every button calls the handler the legacy tablet
// screen used (lib/use-so-actions.ts), so requests and texts are unchanged.
import { type ReactNode } from "react";
import { M } from "../theme";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { SO_ACTION_LABEL, soActionPlan, type SoActionKind } from "../lib/so-actions";
import { BottomDock, PrimaryButton, SecondaryButton } from "./delivery/ui";
import { SHADOW_CONTROL, sem } from "./delivery/ui-tokens";

type Handlers = {
  onEditDraft: () => void;
  onConfirm: () => void;
  onUndoCancel: () => void;
  onIssueDo: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onBack: () => void;
};

function DangerButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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

export function SalesOrderActionBar({ status, busy, ...on }: { status: string; busy: boolean } & Handlers) {
  const layout = useResponsiveLayout();
  const plan = soActionPlan(status);

  const handler: Record<SoActionKind, () => void> = {
    "edit-draft": on.onEditDraft,
    confirm: on.onConfirm,
    "undo-cancel": on.onUndoCancel,
    "issue-do": on.onIssueDo,
    edit: on.onEdit,
    cancel: on.onCancel,
    back: on.onBack,
  };

  const button = (kind: SoActionKind, primary: boolean) => {
    const label = SO_ACTION_LABEL[kind];
    // Back and Edit never wait on a request; the rest are disabled while one is running.
    const disabled = busy && kind !== "back" && kind !== "edit" && kind !== "edit-draft" && kind !== "issue-do";
    if (kind === "cancel") return <DangerButton key={kind} onClick={handler[kind]} disabled={disabled}>{label}</DangerButton>;
    if (primary) return <PrimaryButton key={kind} onClick={handler[kind]} disabled={disabled}>{label}</PrimaryButton>;
    return <SecondaryButton key={kind} onClick={handler[kind]} disabled={disabled}>{label}</SecondaryButton>;
  };

  // Primary = the forward action of the status; the rest are secondary.
  const primaryKinds = new Set<SoActionKind>(["confirm", "undo-cancel", "issue-do"]);

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
