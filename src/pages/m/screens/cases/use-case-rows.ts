// Loads the case list + the two bulk lists the desktop's pipeline derivation
// needs (delivery orders, production orders SCOPED to the cases' SV order ids,
// chunked at 100 — never the unscoped list, see service-cases/index.tsx) and
// returns pipeline-derived rows. Same fetches, same cache keys as desktop.
import { useEffect, useMemo, useState } from "react";
import { cachedFetchJson, useCachedJson } from "@/lib/cached-fetch";
import {
  indexBy,
  toRow,
  type CaseRow,
  type DeliveryOrderApi,
  type ProductionOrderApi,
  type ServiceCaseApi,
} from "./case-model";

export const CASES_URL = "/api/service-cases";

export function useCaseRows() {
  const { data, loading, error } = useCachedJson<{ data?: ServiceCaseApi[] }>(CASES_URL);
  const cases = useMemo(() => data?.data ?? [], [data]);
  const { data: doResp } = useCachedJson<{ data?: DeliveryOrderApi[] }>("/api/delivery-orders");

  const poUrls = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cases) for (const o of c.orders ?? []) if (o.isSv && o.id) ids.add(o.id);
    const sorted = Array.from(ids).sort();
    const urls: string[] = [];
    for (let i = 0; i < sorted.length; i += 100) {
      urls.push(
        "/api/production-orders?fields=minimal&include=jobCards&scope=" +
          sorted.slice(i, i + 100).map(encodeURIComponent).join(","),
      );
    }
    return urls;
  }, [cases]);

  const [scopedPos, setScopedPos] = useState<ProductionOrderApi[]>([]);
  const [posReady, setPosReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(poUrls.map((u) => cachedFetchJson<{ data?: ProductionOrderApi[] }>(u))).then((rs) => {
      if (cancelled) return;
      setScopedPos(rs.flatMap((r) => r?.data ?? []));
      setPosReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [poUrls]);

  const [now] = useState(() => Date.now());
  const rows = useMemo<CaseRow[]>(() => {
    const dos = indexBy(doResp?.data ?? []);
    const pos = indexBy(scopedPos);
    return cases.map((c) => toRow({ ...c, orders: c.orders ?? [], affectedProducts: c.affectedProducts ?? [] }, dos, pos, now));
  }, [cases, doResp, scopedPos, now]);

  return {
    rows,
    loading: loading && !data,
    error: error && !data ? error : null,
    // Stage / ages are provisional until the delivery + production reads land.
    stageReady: !!doResp && (poUrls.length === 0 || posReady),
    now,
  };
}
