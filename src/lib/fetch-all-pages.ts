// fetchAllPages — read EVERY row a paginated list endpoint matches (HK-0002).
//
// The list routes (sales-orders, purchase-orders, grn, delivery-orders,
// invoices) clamp `limit` to 500 and return `{ data, total }`, so a grid that
// exports only its loaded page — or a "filtered" fetch that asked for
// limit=2000 and silently got 500 — hands over a partial file that looks
// whole. This pages until `total` is reached (or a short page ends it).
import { envelope, fetchJson, passthrough } from "./fetch-json";
import { z } from "zod";

const Page = envelope(z.array(passthrough));

export async function fetchAllPages<T>(
  url: string,
  pageSize = 500,
  getPage: (u: string) => Promise<{ data: unknown[]; total?: number }> = (u) =>
    fetchJson(u, Page, { timeoutMs: 60_000 }),
): Promise<T[]> {
  const sep = url.includes("?") ? "&" : "?";
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const r = await getPage(`${url}${sep}page=${page}&limit=${pageSize}`);
    out.push(...(r.data as T[]));
    // ponytail: 200-page guard (100k rows) against a server ignoring `page`.
    if (r.data.length < pageSize || (r.total !== undefined && out.length >= r.total) || page >= 200) break;
  }
  return out;
}
