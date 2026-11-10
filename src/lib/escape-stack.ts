// ---------------------------------------------------------------------------
// escape-stack.ts — Esc closes the popup on TOP (owner 2026-10-02 「点开后无法
// 用 esc 关闭，create new pv 时也是这样」).
//
// One window keydown listener for every popup that opts in: an open popup
// pushes its close, a closed one pops it, and Esc runs only the newest — a
// confirm over a form answers the confirm, the next Esc reaches the form. A
// key an inner control already used (a dropdown closing itself calls
// preventDefault) or one typed mid-IME composition is left alone.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";

const stack: { run: () => void }[] = [];

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.run();
}

/** Put a close handler on top of the stack; the returned function takes it off. */
export function pushEscape(run: () => void): () => void {
  if (stack.length === 0) window.addEventListener("keydown", onKeyDown);
  const entry = { run };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener("keydown", onKeyDown);
  };
}

/** Esc runs `onClose` while `active` and this popup is the newest one open. */
export function useEscapeClose(onClose: () => void, active = true): void {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => latest.current());
  }, [active]);
}

// ---------------------------------------------------------------------------
// Guarded close (review pass 2 C2-1, 2026-11-10): a half-filled form popup
// closed by Esc or a click on its dimmed backdrop first asks "Discard your
// changes?" — a stray key or click no longer throws the typing away. Its own
// Cancel / ✕ still close at once (an explicit choice). The React side is
// `useDiscardGuard` (src/lib/use-discard-guard.ts); this is the pure rule.
// ---------------------------------------------------------------------------

/** Close unless the operator keeps the form: busy → nothing; dirty → ask
 *  first; resolves true when it closed. */
export async function closeUnlessKept(opts: {
  dirty: boolean;
  busy?: boolean;
  ask: () => Promise<boolean>;
  close: () => void;
}): Promise<boolean> {
  if (opts.busy) return false;
  if (opts.dirty && !(await opts.ask())) return false;
  opts.close();
  return true;
}

/** A backdrop click is one that starts AND lands on the backdrop itself — a
 *  text selection dragged out of the form and released outside is not. */
export function isBackdropClick(e: { target: unknown; currentTarget: unknown }): boolean {
  return e.target === e.currentTarget;
}
