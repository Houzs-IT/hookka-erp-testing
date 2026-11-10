// ---------------------------------------------------------------------------
// nav-guard-rules — the pure rules behind useNavGuard / useFormDirty
// (src/lib/use-nav-guard.ts), kept free of React and the router so they can be
// tested directly. Review pass 2 H3-1 / C2-2 / C2-1.
// ---------------------------------------------------------------------------

export const DEFAULT_NAV_GUARD_MESSAGE =
  "You have unsaved changes. Leave without saving?";

/** Should this in-app navigation stop and ask? Pure; see useNavGuard. */
export function shouldBlockNav(args: {
  isDirty: boolean;
  bypass: boolean;
  fromPath: string;
  toPath: string;
}): boolean {
  if (args.bypass || !args.isDirty) return false;
  return args.fromPath !== args.toPath;
}

/** The message of the first dirty form, or null when every form is clean. */
export function firstDirtyMessage(entries: Iterable<{ dirty: boolean; message: string }>): string | null {
  for (const e of entries) if (e.dirty) return e.message;
  return null;
}

/** Same form? Compared as JSON, so key order inside a snapshot must be stable
 *  (build the snapshot the same way every render). */
export function formSnapshotKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
