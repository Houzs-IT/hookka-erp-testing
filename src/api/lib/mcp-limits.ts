// ---------------------------------------------------------------------------
// mcp-limits.ts — AI Connector round 3 (owner 2026-11-26): per-person rate
// limit, a short answer cache, and the latency figures the admin page shows.
//
// RATE LIMIT. tools/call only (initialize / tools/list / prompts/* are free):
// RATE_PER_MINUTE in the last 60 s and RATE_PER_DAY since Malaysia midnight,
// counted from mcp_calls on the (user_id, created_at) index that ensureMcpTables
// already self-applies (mcp_calls_user_idx). Refused calls (status 429) and the
// Super Admin leak check (client mcpc_leak_check, which runs through runToolAs
// and never reaches the limit) are not counted. Over the limit the person gets
// an ordinary tool result with isError — never a 500.
//
// ANSWER CACHE. A quick answer / daily_brief that succeeded is kept for
// ANSWER_CACHE_TTL_MS per person + role + tool + arguments, in this isolate
// only. Safe because it is per person: nobody sees another person's answer,
// and the door (resolveAccessToken) still checks the token on every request,
// so a revoked connection never reaches the cache. Worst case a figure is 30 s
// old — the ERP's own list snapshots are older than that.
// ---------------------------------------------------------------------------

export const RATE_PER_MINUTE = 30;
export const RATE_PER_DAY = 600;
export const RATE_LIMIT_STATUS = 429;
/** Most JSON-RPC messages in one POST: call rows are logged after the call, so a big batch would all see the old count. */
export const MAX_BATCH = 10;
export const LEAK_CHECK_CLIENT_ID = "mcpc_leak_check";
/** Round 4d: the morning brief / test brief runs daily_brief as the person under this client. Not counted toward the person's rate limit. */
export const PROACTIVE_CLIENT_ID = "mcpc_morning_brief";

export const RATE_MINUTE_MESSAGE = "Too many requests — wait a minute. (Limit: 30 AI questions per minute per person.)";
export const RATE_DAY_MESSAGE = "Daily limit reached. (Limit: 600 AI questions per person per day; it resets at midnight Malaysia time.)";

/** Over a limit → the message to show; under → null. */
export function rateDecision(lastMinute: number, today: number, perMinute = RATE_PER_MINUTE, perDay = RATE_PER_DAY): string | null {
  if (today >= perDay) return RATE_DAY_MESSAGE;
  if (lastMinute >= perMinute) return RATE_MINUTE_MESSAGE;
  return null;
}

/** Malaysia midnight (UTC+8) of `now`, as an ISO instant. */
export function myMidnightIso(now: Date = new Date()): string {
  const day = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}

/** One indexed query: this person's counted calls in the last minute and since midnight. */
export async function countRecentCalls(db: D1Database, userId: string, now: Date = new Date()): Promise<{ lastMinute: number; today: number }> {
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const midnight = myMidnightIso(now);
  const since = minuteAgo < midnight ? minuteAgo : midnight;
  const r = await db
    .prepare(
      `SELECT SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_minute,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today
         FROM mcp_calls
        WHERE user_id = ? AND created_at >= ?
          AND COALESCE(status, 0) <> ${RATE_LIMIT_STATUS}
          AND COALESCE(client_id, '') NOT IN (?, ?)`,
    )
    .bind(minuteAgo, midnight, userId, since, LEAK_CHECK_CLIENT_ID, PROACTIVE_CLIENT_ID)
    .first<Record<string, unknown>>();
  const n = (v: unknown) => Number(v) || 0;
  return { lastMinute: n(r?.last_minute ?? r?.lastMinute), today: n(r?.today) };
}

// ── answer cache ────────────────────────────────────────────────────────────

// Round 4c P4 (owner 2026-11-26): about a minute per person for the heavy summaries.
export const ANSWER_CACHE_TTL_MS = 60_000;
export const ANSWER_CACHE_MAX = 300;

/** The tools whose successful answers may be reused for ANSWER_CACHE_TTL_MS. */
export const CACHEABLE_TOOLS = new Set([
  "sales_summary",
  "production_summary",
  "order_backlog",
  "receivables_summary",
  "material_shortages",
  "inventory_summary",
  "purchasing_summary",
  "payables_summary",
  "so_overdue",
  "deliveries_due",
  "production_late",
  "attendance_today",
  "daily_brief",
  // round 4 (2026-11-26)
  "po_overdue",
  "supplier_lateness",
  "uninvoiced_deliveries",
  "stock_check",
  "product_cost",
  "production_output",
  "worker_efficiency",
  "raw_material_summary",
  "gross_profit",
  "production_lead_time",
  "company_report",
  // round 4d
  "data_gaps",
]);

export class AnswerCache<T> {
  private m = new Map<string, { exp: number; v: T }>();
  private ttlMs: number;
  private max: number;
  constructor(ttlMs = ANSWER_CACHE_TTL_MS, max = ANSWER_CACHE_MAX) {
    this.ttlMs = ttlMs;
    this.max = max;
  }
  static key(userId: string, role: string, tool: string, args: Record<string, unknown>): string {
    const sorted = Object.keys(args)
      .sort()
      .map((k) => [k, args[k]]);
    return `${userId}|${role}|${tool}|${JSON.stringify(sorted)}`;
  }
  get(key: string, now = Date.now()): T | null {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp <= now) {
      this.m.delete(key);
      return null;
    }
    return e.v;
  }
  set(key: string, v: T, now = Date.now()): void {
    if (this.m.size >= this.max) {
      for (const [k, e] of this.m) if (e.exp <= now) this.m.delete(k);
      while (this.m.size >= this.max) {
        const first = this.m.keys().next().value;
        if (first === undefined) break;
        this.m.delete(first);
      }
    }
    this.m.set(key, { exp: now + this.ttlMs, v });
  }
  get size(): number {
    return this.m.size;
  }
}

// ── latency (admin page) ────────────────────────────────────────────────────

export type LatencyRow = { tool: string; calls: number; p50: number; p95: number; max: number; cached: number };

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** Per tool: calls, median, 95th percentile and slowest (ms), and how many were answered from the cache. Busiest first. */
export function latencyByTool(rows: { tool: string; ms: number; note?: string }[]): LatencyRow[] {
  const by = new Map<string, { ms: number[]; cached: number }>();
  for (const r of rows) {
    if (!r.tool || !Number.isFinite(r.ms)) continue;
    const e = by.get(r.tool) ?? { ms: [], cached: 0 };
    e.ms.push(r.ms);
    if ((r.note ?? "").includes("cached")) e.cached += 1;
    by.set(r.tool, e);
  }
  return [...by.entries()]
    .map(([tool, e]) => {
      const s = e.ms.slice().sort((a, b) => a - b);
      return { tool, calls: s.length, p50: percentile(s, 50), p95: percentile(s, 95), max: s[s.length - 1] ?? 0, cached: e.cached };
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
}
