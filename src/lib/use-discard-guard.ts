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
