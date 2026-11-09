// ---------------------------------------------------------------------------
// edit-conflict.ts — two people editing the same document (Houzs review,
// owner 2026-11-08).
//
// A full-form save (SO edit page, PO detail edit) rewrites the header AND the
// lines. Two operators who opened the same order then both pressed Save used
// to end with the second save silently replacing the first one's work. The
// form now sends back the `updatedAt` it loaded (`expectedUpdatedAt`); when
// the row has changed since, the save is refused with 409 and the operator
// reloads to see the other change first.
//
// Opt-in: a caller that sends no `expectedUpdatedAt` (status buttons, mobile,
// scripts, cascades) is not checked, so nothing else changes behaviour. The
// row's updated_at also moves when the system touches the order (a status
// cascade), which is still a reason to look again before overwriting.
// ---------------------------------------------------------------------------
const asMs = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
};

export function editConflictMessage(
  row: { updated_at?: unknown; updatedAt?: unknown },
  expected: unknown,
  docLabel: string,
): string | null {
  if (expected == null || expected === "") return null;
  const current = row.updatedAt ?? row.updated_at;
  if (current == null || current === "") return null;
  const a = asMs(current), b = asMs(expected);
  const same = a != null && b != null ? a === b : String(current) === String(expected);
  if (same) return null;
  return `This ${docLabel} was changed by someone else (or by the system) after you opened it. Reload the page to see the latest version, then make your change again — saving now would overwrite theirs.`;
}
