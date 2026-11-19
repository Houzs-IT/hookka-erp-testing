const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MALAYSIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALAYSIA_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const MILLISECONDS_PER_DAY = 86_400_000;

export interface PieceInfo {
  pieceNo: number | null;
  totalPieces: number | null;
}

export interface IssueDescription extends PieceInfo {
  poNo: string;
  itemLabel: string;
}

function isValidIso(iso: string | null | undefined): iso is string {
  return Boolean(iso) && !Number.isNaN(new Date(iso as string).getTime());
}

function dayNumberOf(iso: string): number {
  const [year, month, day] = dayKeyFormatter.format(new Date(iso)).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
}

export type IssueStatusName = "INCOMPLETE" | "PENDING_APPROVAL" | "COMPLETED";

const ISSUE_STATUS_LABELS: Record<IssueStatusName, string> = {
  INCOMPLETE: "Incomplete",
  PENDING_APPROVAL: "Pending approval",
  COMPLETED: "Completed",
};

export function issueStatusLabel(status: IssueStatusName): string {
  return ISSUE_STATUS_LABELS[status];
}

export function formatIssueDateTime(iso: string | null | undefined): string {
  return isValidIso(iso) ? dateTimeFormatter.format(new Date(iso)).replace(",", "") : "—";
}

export function formatPiece({ pieceNo, totalPieces }: PieceInfo): string {
  if (pieceNo === null) return "—";
  return totalPieces === null ? String(pieceNo) : `${pieceNo}/${totalPieces}`;
}

export function describeIssue(issue: IssueDescription): string {
  const piece = issue.pieceNo === null ? "" : ` ${formatPiece(issue)}`;
  return `${issue.poNo} · ${issue.itemLabel}${piece}`;
}

export function calendarDaysBetween(fromIso: string, toIso: string): number | null {
  if (!isValidIso(fromIso) || !isValidIso(toIso)) return null;
  return Math.max(0, dayNumberOf(toIso) - dayNumberOf(fromIso));
}

export function daysOut(issue: { issuedAt: string; completedAt: string | null }): number | null {
  return calendarDaysBetween(issue.issuedAt, issue.completedAt ?? new Date().toISOString());
}

export function formatDays(days: number | null): string {
  if (days === null) return "—";
  return days === 1 ? "1 day" : `${days} days`;
}

export type Translate = (key: string) => string;

interface OpenTask {
  status: IssueStatusName;
  issuedAt: string;
  completedAt: string | null;
}

export function daysHeldText(t: Translate, issue: OpenTask): string {
  const days = daysOut(issue);
  if (days === null) return "";
  if (days === 0) return t("tasks.heldToday");
  return t(days === 1 ? "tasks.dayHeld" : "tasks.daysHeld").replace("{n}", String(days));
}

export function countTasks(t: Translate, open: OpenTask[]): string {
  const waiting = open.filter((issue) => issue.status === "PENDING_APPROVAL").length;
  const toFinish = `${open.length - waiting} ${t("tasks.toFinish")}`;
  return waiting > 0 ? `${toFinish} · ${waiting} ${t("tasks.waitingForOffice")}` : toFinish;
}

export function summarizeTasks(t: Translate, open: OpenTask[]): string {
  const base = countTasks(t, open);
  const oldest = open.find((issue) => issue.status === "INCOMPLETE");
  return oldest ? `${base} · ${t("tasks.oldest")}: ${daysHeldText(t, oldest)}` : base;
}
