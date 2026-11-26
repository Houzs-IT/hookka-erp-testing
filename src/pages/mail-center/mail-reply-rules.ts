// Reply guard rules shared by the reply box (Houzs parity row 21): the 409
// "a colleague already replied" answer, and the wording around it. Pure.

export type ReplyingPerson = { name: string };
export type AlreadyReplied = { by: string; at: string };

/** The server's 409 when a colleague replied after the newest message I had seen. */
export function alreadyRepliedFrom(status: number, body: unknown): AlreadyReplied | null {
  if (status !== 409) return null;
  const b = body as { code?: string; by?: string; at?: string } | null;
  return b?.code === "already_replied" && b.by && b.at ? { by: b.by, at: b.at } : null;
}

/** "2 minutes ago" for a reply that just landed. */
export function agoLabel(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}

/** "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
