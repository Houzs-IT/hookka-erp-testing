// ---------------------------------------------------------------------------
// useDiscardGuard — Esc / backdrop close for a form popup that asks
// "Discard your changes?" while the form is dirty (review pass 2 C2-1,
// Conts#593 / #623). Cancel and ✕ keep calling `onClose` directly.
//
//   const [dirty] = useFormDirty(snapshotOfTheForm, open);   // use-nav-guard
//   const guard = useDiscardGuard({ open, dirty, onClose, busy: saving });
//   <div className="fixed inset-0 …" onMouseDown={guard.onBackdrop}> … </div>
//
// A dropdown pick changes the snapshot like typing does, so it counts.
// Esc goes through the shared escape stack: a confirm over the form answers
// the confirm first, and a dropdown that closes itself on Esc keeps the key.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { closeUnlessKept, isBackdropClick, useEscapeClose } from "./escape-stack";
import { useFormDirty } from "./use-nav-guard";

export const DISCARD_TITLE = "Discard your changes?";

export function useDiscardGuard(opts: {
  open: boolean;
  dirty: boolean;
  onClose: () => void;
  busy?: boolean;
  message?: string;
}): { requestClose: () => Promise<boolean>; onBackdrop: (e: MouseEvent) => void } {
  const { confirm } = useConfirm();
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  const asking = useRef(false);

  const requestClose = useCallback(async () => {
    if (asking.current) return false;
    const o = latest.current;
    asking.current = true;
    try {
      return await closeUnlessKept({
        dirty: o.dirty,
        busy: o.busy,
        close: o.onClose,
        ask: () =>
          confirm({
            title: DISCARD_TITLE,
            message: o.message ?? "What you typed in this form will be lost.",
            confirmLabel: "Discard",
            cancelLabel: "Keep editing",
            danger: true,
          }),
      });
    } finally {
      asking.current = false;
    }
  }, [confirm]);

  useEscapeClose(() => void requestClose(), opts.open);

  const onBackdrop = useCallback(
    (e: MouseEvent) => {
      if (isBackdropClick(e)) void requestClose();
    },
    [requestClose],
  );
  return { requestClose, onBackdrop };
}

// ---------------------------------------------------------------------------
// useFormDiscardGuard — the one-liner most form popups want (C2-1 follow-up,
// 2026-11-10): dirty = "the form's snapshot differs from when it opened (or,
// for a form that loads its record, from when `ready` turned true)", then the
// same Esc / backdrop rule as useDiscardGuard. A popup that renders only while
// open passes open = true (the default).
//
//   const guard = useFormDiscardGuard({ name, phone, items }, { onClose, busy: saving });
//   <div className="fixed inset-0 …" onMouseDown={guard.onBackdrop}> … </div>
// ---------------------------------------------------------------------------
export function useFormDiscardGuard(
  snapshot: unknown,
  opts: { onClose: () => void; open?: boolean; ready?: boolean; busy?: boolean; message?: string },
): {
  dirty: boolean;
  /** Re-base on the form as it is now — after a save that keeps the popup open. */
  markClean: () => void;
  requestClose: () => Promise<boolean>;
  onBackdrop: (e: MouseEvent) => void;
} {
  const open = opts.open ?? true;
  const [dirty, markClean] = useFormDirty(snapshot, open && (opts.ready ?? true));
  const guard = useDiscardGuard({ open, dirty, onClose: opts.onClose, busy: opts.busy, message: opts.message });
  return { dirty, markClean, ...guard };
}
