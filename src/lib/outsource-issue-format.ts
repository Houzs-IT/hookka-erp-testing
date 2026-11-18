const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MALAYSIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALAYSIA_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
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

export function formatIssueDate(iso: string | null | undefined): string {
  return isValidIso(iso) ? dateFormatter.format(new Date(iso)) : "—";
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
