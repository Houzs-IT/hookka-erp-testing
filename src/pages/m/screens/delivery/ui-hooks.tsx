// ===========================================================================
// Promise-based sheets + toast for the phone Delivery screens (the /m shell has
// no ToastProvider / ConfirmProvider; screens keep their own).
//   useMobileToast    — one message at a time, auto-dismiss (scheduler.useTimeout)
//   useConfirmSheet   — `await confirm(spec)` → true / false
//   useCreditOverride — `await ask(body)` → override reason, or null
// ===========================================================================
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { CreditBlockBody } from "@/pages/delivery/credit-override";
import { ConfirmView, CreditView, ToastView, type ConfirmSpec, type ToastTone } from "./ui";

export function useMobileToast(): { show: (text: string, tone?: ToastTone) => void; node: ReactNode } {
  const [toast, setToast] = useState<{ id: number; text: string; tone: ToastTone } | null>(null);
  const seq = useRef(0);
  const show = useCallback((text: string, tone: ToastTone = "info") => {
    seq.current += 1;
    setToast({ id: seq.current, text, tone });
  }, []);
  const hide = useCallback(() => setToast(null), []);
  const node = toast ? <ToastView key={toast.id} text={toast.text} tone={toast.tone} onDone={hide} /> : null;
  return { show, node };
}

export function useConfirmSheet(): { confirm: (spec: ConfirmSpec) => Promise<boolean>; node: ReactNode } {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setSpec(null);
  }, []);
  const confirm = useCallback((s: ConfirmSpec) => {
    resolver.current?.(false);
    setSpec(s);
    return new Promise<boolean>((res) => {
      resolver.current = res;
    });
  }, []);
  const onCancel = useCallback(() => close(false), [close]);
  const onConfirm = useCallback(() => close(true), [close]);
  return { confirm, node: <ConfirmView spec={spec} onCancel={onCancel} onConfirm={onConfirm} /> };
}

export function useCreditOverride(): { ask: (body: CreditBlockBody) => Promise<string | null>; node: ReactNode } {
  const [body, setBody] = useState<CreditBlockBody | null>(null);
  const resolver = useRef<((r: string | null) => void) | null>(null);
  const finish = useCallback((r: string | null) => {
    resolver.current?.(r);
    resolver.current = null;
    setBody(null);
  }, []);
  const ask = useCallback((b: CreditBlockBody) => {
    resolver.current?.(null);
    setBody(b);
    return new Promise<string | null>((res) => {
      resolver.current = res;
    });
  }, []);
  const onClose = useCallback(() => finish(null), [finish]);
  return { ask, node: <CreditView body={body} onClose={onClose} onReason={finish} /> };
}
