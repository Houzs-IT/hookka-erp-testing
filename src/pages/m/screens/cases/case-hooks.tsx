// Tiny shared hooks for the Service Cases screens.
import { useCallback, useState, type ReactNode } from "react";
import { ToastView, type ToastTone } from "../delivery/ui";
import { usePermissions } from "@/lib/use-permission";

export function useCaseToast() {
  const [t, setT] = useState<{ text: string; tone: ToastTone; k: number } | null>(null);
  const show = useCallback((text: string, tone: ToastTone = "success") => setT({ text, tone, k: Date.now() }), []);
  const node: ReactNode = t ? <ToastView key={t.k} text={t.text} tone={t.tone} onDone={() => setT(null)} /> : null;
  return { show, node };
}

/** Client-side mirror of the server gates the desktop relies on (the desktop
 * pages themselves do no client check; the server refuses regardless). */
export function useCasePerms() {
  const { hasPermission } = usePermissions();
  return {
    create: hasPermission("service-cases", "create"),
    update: hasPermission("service-cases", "update"),
    createServiceOrder: hasPermission("service-orders", "create"),
    createSalesOrder: hasPermission("sales-orders", "create"),
    inventoryCreate: hasPermission("inventory", "create"),
    filesCreate: hasPermission("files", "create"),
  };
}
