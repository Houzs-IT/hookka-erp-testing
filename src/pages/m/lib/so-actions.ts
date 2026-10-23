// so-actions — which Sales Order actions exist in each status. This is the
// status matrix the tablet detail has always had (SalesDetailScreen.tsx
// SalesDetailTablet); it is data, so it can be tested and rendered by one component.
// It is NOT a permission rule: it only says what the screen offers per status. Every
// action still goes through the same API calls, which enforce permissions server-side.
export type SoActionKind =
  | "edit-draft"
  | "confirm"
  | "undo-cancel"
  | "issue-do"
  | "edit"
  | "cancel"
  | "back";

export type SoActionPlan = {
  /** A line shown above the buttons (the cancelled state says so). */
  note?: string;
  /** Button rows, left to right; each row is a line of buttons. */
  rows: SoActionKind[][];
};

export function soActionPlan(status: string): SoActionPlan {
  if (status === "DRAFT") return { rows: [["edit-draft", "confirm"]] };
  if (status === "CANCELLED") return { note: "This order was cancelled.", rows: [["undo-cancel"]] };
  if (status === "CONFIRMED") return { rows: [["issue-do"], ["edit", "cancel"]] };
  return { rows: [["back", "cancel"]] };
}

export const SO_ACTION_LABEL: Record<SoActionKind, string> = {
  "edit-draft": "Edit Draft",
  confirm: "Confirm Order",
  "undo-cancel": "Undo Cancel",
  "issue-do": "Issue Delivery Order",
  edit: "Edit",
  cancel: "Cancel Order",
  back: "Back",
};
