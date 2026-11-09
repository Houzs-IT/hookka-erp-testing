// ---------------------------------------------------------------------------
// save-blockers — show EVERY blocking problem on a create/edit form at once.
//
// Owner-approved item 25 (2026-11-08). The big forms (SO create/edit, PO
// create, PI create, GRN create) used to stop at the FIRST failed check and
// toast it, so an operator with three problems fixed one, pressed Save, met
// the second, pressed Save, met the third. The forms now collect every
// blocker into a list and raise ONE toast that names them all.
//
// The RULES are unchanged — each form still runs exactly its old checks, in
// the same order, and refuses to save whenever any of them fails. Only the
// reporting changed. A single blocker is shown exactly as before (same text,
// same warning/error tone), so the common one-problem case looks identical.
// ---------------------------------------------------------------------------

export type SaveBlockerLevel = "warning" | "error";

export type SaveBlocker = { message: string; level: SaveBlockerLevel };

/** Collects blockers in check order; ignores blanks and exact duplicates. */
export class SaveBlockers {
  readonly items: SaveBlocker[] = [];

  warn(message: string): this {
    return this.add(message, "warning");
  }

  error(message: string): this {
    return this.add(message, "error");
  }

  add(message: string, level: SaveBlockerLevel): this {
    const m = String(message ?? "").trim();
    if (m && !this.items.some((b) => b.message === m)) this.items.push({ message: m, level });
    return this;
  }

  get size(): number {
    return this.items.length;
  }
}

/**
 * One toast for the whole list, or null when nothing blocks.
 * - 1 blocker  → its own message and tone (byte-identical to the old toast).
 * - 2+ blockers → "Fix N problems before saving:" + one bullet per line; tone
 *   is "error" if any blocker is an error, else "warning".
 */
export function summarizeSaveBlockers(
  blockers: readonly SaveBlocker[],
): { level: SaveBlockerLevel; message: string } | null {
  if (blockers.length === 0) return null;
  if (blockers.length === 1) return { level: blockers[0].level, message: blockers[0].message };
  const level: SaveBlockerLevel = blockers.some((b) => b.level === "error") ? "error" : "warning";
  const message =
    `Fix ${blockers.length} problems before saving:\n` + blockers.map((b) => `• ${b.message}`).join("\n");
  return { level, message };
}

type ToastLike = { warning: (m: string) => void; error: (m: string) => void };

/**
 * Raise the summary toast. Returns true when the save must STOP (any blocker),
 * so a handler reads: `if (reportSaveBlockers(toast, blockers)) return;`
 */
export function reportSaveBlockers(toast: ToastLike, blockers: SaveBlockers | readonly SaveBlocker[]): boolean {
  const list = blockers instanceof SaveBlockers ? blockers.items : blockers;
  const s = summarizeSaveBlockers(list);
  if (!s) return false;
  if (s.level === "error") toast.error(s.message);
  else toast.warning(s.message);
  return true;
}
