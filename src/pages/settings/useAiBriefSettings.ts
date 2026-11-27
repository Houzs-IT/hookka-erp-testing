// The person's own morning-brief / urgent-alert settings (AI Connector round 4d),
// backed by /api/mcp-admin/proactive. Kept in its own file (react-refresh: a
// component file exports components only).
import { useCallback, useEffect, useState } from "react";

export type BriefSubscription = { briefEnabled: boolean; briefTime: string; briefDays: "weekdays" | "daily"; alertsEnabled: boolean };
export type BriefSend = { at: string; kind: string; items: number; status: string; note: string };
export type BriefSettings = {
  allowed: boolean;
  email: string;
  saved: boolean;
  subscription: BriefSubscription;
  thresholds: { label: string; value: string }[];
  schedule: string;
  recent: BriefSend[];
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const j = (await r.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!r.ok || !j || j.success === false) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data as T;
}

export function useAiBriefSettings() {
  const [data, setData] = useState<BriefSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call<BriefSettings>("/api/mcp-admin/proactive/me"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; state is set after the await
    void load();
  }, [load]);

  const save = useCallback(
    async (sub: BriefSubscription) => {
      await call("/api/mcp-admin/proactive/me", { method: "PUT", body: JSON.stringify(sub) });
      await load();
    },
    [load],
  );

  const sendTest = useCallback(async () => {
    const r = await call<{ sentTo: string; items: number }>("/api/mcp-admin/proactive/me/test", { method: "POST", body: "{}" });
    await load();
    return r;
  }, [load]);

  const preview = useCallback(() => call<{ subject: string; html: string; items: number }>("/api/mcp-admin/proactive/me/preview?gaps=1"), []);

  return { data, error, save, sendTest, preview, reload: load };
}
