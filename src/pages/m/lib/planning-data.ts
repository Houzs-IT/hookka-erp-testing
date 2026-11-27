// ===========================================================================
// Planning (mobile) — reads. Same endpoints the desktop Planning page makes,
// nothing new on the server:
//   • production orders (job cards, "lite")  GET /api/production-orders?fields=minimal&include=jobCards-lite&excludeCompleted=true
//   • public holidays                          GET /api/kv-config/public_holidays
//   • Hookka DD per order                      GET /api/scheduling
//   • department schedule snapshot             GET /api/planning/schedule/:slug
//   • order lookup for the visible SOs         GET /api/production-orders?…&scope=<SO ids>
//   • lead times + history                     GET /api/production-leadtimes, /history
//   • schedule proposals                       GET /api/planning/proposals?status=
// ===========================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { fetchJson, passthrough } from "@/lib/fetch-json";
import type { PlanOrder } from "./planning-capacity";
import { PLAN_DEPARTMENTS } from "./planning-capacity";
import type { LeadHistory, LeadPayload } from "./planning-leadtimes";
import {
  SCHEDULE_DEPTS,
  SCHEDULE_DEPT_BY_CODE,
  longDate,
  type Snapshot,
} from "./planning-schedule";

export const PLANNING_ORDERS_URL =
  "/api/production-orders?fields=minimal&include=jobCards-lite&excludeCompleted=true";

type Envelope<T> = { success?: boolean; data?: T };

export function usePlanningOrders(enabled = true) {
  const r = useCachedJson<Envelope<PlanOrder[]>>(enabled ? PLANNING_ORDERS_URL : null);
  const orders = useMemo(() => (Array.isArray(r.data?.data) ? (r.data?.data as PlanOrder[]) : []), [r.data]);
  return { orders, loading: r.loading, error: r.data ? null : r.error, refresh: r.refresh, hasData: !!r.data };
}

export function useHolidays(enabled = true): Set<string> {
  const r = useCachedJson<Envelope<unknown>>(enabled ? "/api/kv-config/public_holidays" : null);
  return useMemo(() => {
    const s = new Set<string>();
    const arr = r.data?.data;
    if (Array.isArray(arr)) for (const d of arr) if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) s.add(d);
    return s;
  }, [r.data]);
}

/**
 * Desktop `productionDepartments` (index.tsx:507): the Capacity Loading list is the live departments
 * with isProduction, ordered by sequence, named as in the database; null until loaded (desktop then
 * falls back to the fixed list, as does mobile). The Overview cards use the fixed list on both.
 */
export function useProductionDepartments(enabled = true): { code: string; name: string }[] | null {
  const r = useCachedJson<Envelope<{ code: string; name: string; sequence: number; isProduction: boolean }[]>>(enabled ? "/api/departments" : null);
  return useMemo(() => {
    const live = r.data?.data;
    if (!live || live.length === 0) return null;
    return live.filter((d) => d.isProduction).sort((a, b) => a.sequence - b.sequence).map((d) => ({ code: d.code, name: d.name }));
  }, [r.data]);
}

/** productionOrderId → hookkaExpectedDD (the desktop Master Tracker's Hookka DD column). */
export function useHookkaDd(enabled = true): Map<string, string> {
  const r = useCachedJson<Envelope<{ productionOrderId?: string; hookkaExpectedDD?: string }[]>>(
    enabled ? "/api/scheduling" : null,
  );
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const s of r.data?.data ?? []) if (s.productionOrderId && s.hookkaExpectedDD) m.set(s.productionOrderId, s.hookkaExpectedDD);
    return m;
  }, [r.data]);
}

/** Orders for the SOs on screen — a small targeted read, never the whole list. */
export function useScopedOrders(tokens: string[]) {
  const key = tokens.join(",");
  const url = key
    ? `/api/production-orders?fields=minimal&include=jobCards-lite&scope=${tokens.map(encodeURIComponent).join(",")}`
    : null;
  const r = useCachedJson<Envelope<PlanOrder[]>>(url, 120);
  const orders = useMemo(() => (Array.isArray(r.data?.data) ? (r.data?.data as PlanOrder[]) : []), [r.data]);
  return { orders, loading: r.loading };
}

// ── Department schedule snapshots ───────────────────────────────────────────
export type SnapStatus = "idle" | "loading" | "ok" | "static" | "error";
export type SnapEntry = { status: SnapStatus; snap: Snapshot | null; error?: string };

const SNAP_TTL_MS = 120_000;
const snapCache = new Map<string, { at: number; snap: Snapshot }>();

async function loadSnapshot(slug: string): Promise<Snapshot> {
  const hit = snapCache.get(slug);
  if (hit && Date.now() - hit.at < SNAP_TTL_MS) return hit.snap;
  const data = (await fetchJson(`/api/planning/schedule/${slug}`, passthrough)) as Snapshot;
  if (!data || typeof data !== "object" || !data.sheets) throw new Error("Malformed schedule response");
  snapCache.set(slug, { at: Date.now(), snap: data });
  return data;
}

/**
 * Loads the selected department first, then the rest one at a time (every
 * request recomputes the whole planning chain on the server, so they are not
 * fired in parallel). Foam Cutting and Fibre have no live endpoint — like the
 * desktop pages they use the bundled snapshot.
 */
export function useScheduleSnapshots(selected: string) {
  const initial = useMemo(() => {
    const m: Record<string, SnapEntry> = {};
    for (const d of SCHEDULE_DEPTS) {
      m[d.code] = d.slug ? { status: "idle", snap: null } : { status: "static", snap: d.staticSnapshot ?? null };
    }
    return m;
  }, []);
  const [entries, setEntries] = useState<Record<string, SnapEntry>>(initial);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const order = [selected, ...SCHEDULE_DEPTS.map((d) => d.code).filter((c) => c !== selected)];
    void (async () => {
      for (const code of order) {
        if (cancelled) return;
        const cfg = SCHEDULE_DEPT_BY_CODE[code];
        if (!cfg?.slug) continue;
        const fresh = snapCache.get(cfg.slug);
        if (fresh && Date.now() - fresh.at < SNAP_TTL_MS) {
          setEntries((p) => ({ ...p, [code]: { status: "ok", snap: fresh.snap } }));
          continue;
        }
        setEntries((p) => ({ ...p, [code]: { status: "loading", snap: p[code]?.snap ?? null } }));
        try {
          const snap = await loadSnapshot(cfg.slug);
          if (cancelled) return;
          setEntries((p) => ({ ...p, [code]: { status: "ok", snap } }));
        } catch (e) {
          if (cancelled) return;
          const message = e instanceof Error ? e.message : "Could not load the schedule";
          setEntries((p) => ({ ...p, [code]: { status: "error", snap: p[code]?.snap ?? null, error: message } }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, nonce]);

  const reload = useCallback(() => {
    snapCache.clear();
    setNonce((n) => n + 1);
  }, []);
  return { entries, reload };
}

// ── Lead times (view only) — the view model lives in ./planning-leadtimes ───
export function useLeadTimes(enabled = true) {
  const lead = useCachedJson<Envelope<LeadPayload>>(enabled ? "/api/production-leadtimes" : null, 60);
  const hist = useCachedJson<Envelope<LeadHistory>>(enabled ? "/api/production-leadtimes/history" : null, 60);
  return {
    lead: lead.data?.data ?? null,
    history: hist.data?.data ?? null,
    loading: lead.loading || hist.loading,
    error: !lead.data ? lead.error : null,
    historyError: !hist.data ? hist.error : null,
    refresh: () => {
      lead.refresh();
      hist.refresh();
    },
  };
}

// ── Schedule proposals (view only) ──────────────────────────────────────────
export type ProposalRow = {
  id: string;
  generatedAt: string;
  jcId: string;
  poId: string;
  dept: string;
  soRef: string;
  lane: string;
  fabric: string;
  currentDue: string | null;
  proposedDue: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
};

export const PROPOSAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

/** Capacity tab's "N pending" row — the PENDING list only (shares the Proposals screen's cache entry). */
export function usePendingProposalCount(enabled: boolean): number {
  const p = useCachedJson<Envelope<ProposalRow[]>>(enabled ? "/api/planning/proposals?status=PENDING" : null, 60);
  return p.data?.data?.length ?? 0;
}

/** One status per request (the API takes a single status); `enabled` = production-orders:read. */
export function useProposals(enabled: boolean) {
  const p = useCachedJson<Envelope<ProposalRow[]>>(enabled ? "/api/planning/proposals?status=PENDING" : null, 60);
  const a = useCachedJson<Envelope<ProposalRow[]>>(enabled ? "/api/planning/proposals?status=APPROVED" : null, 60);
  const r = useCachedJson<Envelope<ProposalRow[]>>(enabled ? "/api/planning/proposals?status=REJECTED" : null, 60);
  const rows = useMemo(
    () => [...(p.data?.data ?? []), ...(a.data?.data ?? []), ...(r.data?.data ?? [])],
    [p.data, a.data, r.data],
  );
  return {
    rows,
    pendingCount: p.data?.data?.length ?? 0,
    pendingKnown: !!p.data,
    loading: p.loading || a.loading || r.loading,
    error: !p.data && p.error ? p.error : !a.data && a.error ? a.error : !r.data && r.error ? r.error : null,
    refresh: () => {
      p.refresh();
      a.refresh();
      r.refresh();
    },
  };
}

export const proposalDeptName = (code: string): string => PLAN_DEPARTMENTS.find((d) => d.code === code)?.name ?? code;
export function generatedLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return longDate(iso);
  return `Generated ${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
