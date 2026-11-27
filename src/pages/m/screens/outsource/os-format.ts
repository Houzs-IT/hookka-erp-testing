// ---------------------------------------------------------------------------
// Outsource Work (mobile, Batch 4): pure display helpers. Nothing here reads
// or writes the server; every value shown comes from the use-outsource-issue
// hook. Status / department colours are the approved prototype's.
// ---------------------------------------------------------------------------
import type { FeedbackTone, IssueFeedback, OutsourceIssue, StatusFilter, TrackingFilters } from "@/pages/production/use-outsource-issue";
import { formatPiece } from "@/lib/outsource-issue-format";

export type IssueStatus = OutsourceIssue["status"];

/** Prototype `ST`: label, colour, tint. */
export const STATUS_STYLE: Record<IssueStatus, { l: string; c: string; b: string }> = {
  INCOMPLETE: { l: "Incomplete", c: "var(--xo-info)", b: "var(--xo-infob)" },
  PENDING_APPROVAL: { l: "Pending approval", c: "var(--xo-warn)", b: "var(--xo-warnb)" },
  COMPLETED: { l: "Completed", c: "var(--xo-ok)", b: "var(--xo-okb)" },
};

export const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "PENDING_APPROVAL", label: "Pending approval" },
  { key: "INCOMPLETE", label: "Incomplete" },
  { key: "COMPLETED", label: "Completed" },
  { key: "ALL", label: "All" },
];

/** Prototype `DC` (dot, text), keyed by the department CODE the server sends. */
const DEPT_COLOURS: Record<string, [string, string]> = {
  FAB_CUT: ["#3B82F6", "#1D4ED8"],
  FAB_SEW: ["#6366F1", "#4338CA"],
  WOOD_CUT: ["#F59E0B", "#B45309"],
  FOAM: ["#8B5CF6", "#6D28D9"],
  FRAMING: ["#F97316", "#C2410C"],
  WEBBING: ["#10B981", "#047857"],
  UPHOLSTERY: ["#F43F5E", "#BE123C"],
  PACKING: ["#06B6D4", "#0E7490"],
};

export type DeptChip = { key: string; l: string; dot: string; c: string; bg: string };

export function deptChips(codes: readonly string[], names: readonly string[]): DeptChip[] {
  return codes.map((code, i) => {
    const [dot, c] = DEPT_COLOURS[code] ?? ["#9A9082", "#6B6358"];
    return { key: `${code}-${i}`, l: names[i] || code, dot, c, bg: `${dot}1A` };
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** "Headboard · piece 1/2", or just the item when the issue covers the whole card. */
export function itemWithPiece(issue: Pick<OutsourceIssue, "itemLabel" | "pieceNo" | "totalPieces">): string {
  return issue.pieceNo === null ? issue.itemLabel : `${issue.itemLabel} · piece ${formatPiece(issue)}`;
}

export function productLine(issue: Pick<OutsourceIssue, "productName" | "productCode">): string {
  return [issue.productName, issue.productCode].filter(Boolean).join(" · ");
}

/** Short titles for the server's error codes. The server's own message is always shown under it. */
const CODE_TITLES: Record<string, string> = {
  ALREADY_ISSUED: "Already issued",
  ALREADY_DONE: "Already done",
  NOT_A_STICKER: "Not a production sticker",
  ORDER_NOT_FOUND: "Order not found",
  NO_CARD_FOR_DEPARTMENT: "No job card for this department",
  AMBIGUOUS_DEPARTMENT: "Worker's department is unclear",
  NOT_OUTSOURCE_WORKER: "Worker can't take work",
  NO_WORKER_DEPARTMENT: "Worker has no department",
  ALREADY_COMPLETED: "Already completed",
  NOT_PENDING: "Not waiting for approval",
  PO_ON_HOLD: "Order on hold",
  PO_CANCELLED: "Order cancelled",
  PIC_FULL: "Piece already has 2 PICs",
};

export const NETWORK_TITLE = "No connection";

export type BannerView = { tone: FeedbackTone; t: string; s: string };

/** Title + subtitle for the hook's feedback. `fallback` titles a failure that has no code. */
export function feedbackView(feedback: IssueFeedback, fallback: string): BannerView {
  if (feedback.tone === "success") {
    return { tone: "success", t: feedback.message.startsWith("Undone") ? "Undone" : "Issued", s: feedback.message };
  }
  const byCode = feedback.code ? CODE_TITLES[feedback.code] : undefined;
  const isNetwork = !feedback.code && feedback.message.startsWith("Network problem");
  return { tone: feedback.tone, t: byCode ?? (isNetwork ? NETWORK_TITLE : fallback), s: feedback.message };
}

/** Worker, date or search narrows the list (the status chip does not). */
export function hasNarrowingFilters(f: TrackingFilters): boolean {
  return !!(f.query.trim() || f.workerId || f.from || f.to);
}

export function isoDayToLabel(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(day.slice(8, 10))} ${months[Number(day.slice(5, 7)) - 1]}`;
}
