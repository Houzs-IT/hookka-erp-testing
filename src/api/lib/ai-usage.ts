// ---------------------------------------------------------------------------
// ai-usage.ts — one row per Claude call in ai_usage_events, and the daily
// summary sent to the Houzs IT Hub.
//
// The hub reads Anthropic's real cost for Hookka's workspace; it cannot see
// which feature spent it. claudeFetch() records every call here with the
// feature its caller names, and the agent heartbeat sends the last 7 UTC days,
// priced per feature, once a day. The hub uses the amounts only as SHARES of
// the real cost, so prices that drift from Anthropic's change no total there.
//
// Recording is fire-and-forget: nothing here may throw into a call site or
// change what it returns. The response body is read from a clone.
//
// The database comes from a per-request scope (aiUsageScope), set by the DB
// middleware in worker.ts, so the call sites need no new arguments. A call
// made outside any request (tests, scripts) is simply not recorded.
// ---------------------------------------------------------------------------
import { AsyncLocalStorage } from "node:async_hooks";

export interface AiUsageScope {
  db: D1Database;
  waitUntil: ((p: Promise<unknown>) => void) | null;
}

export const aiUsageScope = new AsyncLocalStorage<AiUsageScope>();

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// USD per million tokens (claude.com/pricing, 2026-10). A model missing here is
// priced as Sonnet. cacheWrite is the 5-minute price; only shares matter.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** Anthropic's input, cache-read and cache-write counts are disjoint. */
export function costUsd(model: string, t: TokenCounts): number {
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  const p = PRICES[key ?? "claude-sonnet-4-6"]!;
  return (
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.input * 0.1 +
      t.cacheWriteTokens * p.input * 1.25) /
    1_000_000
  );
}

const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

function countsOf(usage: unknown): TokenCounts {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
  };
}

/** Pure: token counts from a Messages response body, plain JSON or a stream
 *  (message_start carries input and cache counts, message_delta the output). */
export function usageFromBody(text: string): TokenCounts | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as { usage?: unknown };
      return j.usage ? countsOf(j.usage) : null;
    } catch {
      return null;
    }
  }
  let found = false;
  const t: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let ev: { type?: string; message?: { usage?: unknown }; usage?: unknown };
    try {
      ev = JSON.parse(line.slice(5));
    } catch {
      continue;
    }
    if (ev.type === "message_start" && ev.message?.usage) {
      const c = countsOf(ev.message.usage);
      t.inputTokens = c.inputTokens;
      t.cacheReadTokens = c.cacheReadTokens;
      t.cacheWriteTokens = c.cacheWriteTokens;
      found = true;
    } else if (ev.type === "message_delta" && ev.usage) {
      // Output is cumulative in each delta; the last one is the total.
      t.outputTokens = countsOf(ev.usage).outputTokens;
      found = true;
    }
  }
  return found ? t : null;
}

/** Pure: the model named in a request body, "" when it cannot be read. */
export function modelOf(body: RequestInit["body"]): string {
  if (typeof body !== "string") return "";
  try {
    const m = (JSON.parse(body) as { model?: unknown }).model;
    return typeof m === "string" ? m.slice(0, 80) : "";
  } catch {
    return "";
  }
}

let tableReady = false;
async function ensureAiUsageTable(db: D1Database): Promise<void> {
  if (tableReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ai_usage_events (
         id TEXT PRIMARY KEY,
         created_at TEXT NOT NULL,
         feature TEXT NOT NULL,
         model TEXT NOT NULL,
         input_tokens INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         cache_read_tokens INTEGER NOT NULL DEFAULT 0,
         cache_write_tokens INTEGER NOT NULL DEFAULT 0,
         ok INTEGER NOT NULL DEFAULT 1,
         http_status INTEGER
       )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created ON ai_usage_events(created_at)").run();
  tableReady = true;
}

async function writeRow(db: D1Database, feature: string, model: string, status: number, body: string): Promise<void> {
  const t = usageFromBody(body) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  await ensureAiUsageTable(db);
  await db
    .prepare(
      `INSERT INTO ai_usage_events
         (id, created_at, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ok, http_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      feature,
      model || "unknown",
      t.inputTokens,
      t.outputTokens,
      t.cacheReadTokens,
      t.cacheWriteTokens,
      status >= 200 && status < 300 ? 1 : 0,
      status || null,
    )
    .run();
}

/** Record one call from its response (read from a clone). Never throws. */
export function recordAiCall(feature: string, init: RequestInit, res: Response): void {
  const scope = aiUsageScope.getStore();
  if (!scope) return;
  let clone: Response;
  try {
    clone = res.clone();
  } catch {
    return;
  }
  const task = (async () => {
    try {
      const body = await clone.text();
      await writeRow(scope.db, feature, modelOf(init.body), res.status, body);
    } catch (err) {
      console.warn("[ai-usage] record failed:", err);
    }
  })();
  if (scope.waitUntil) scope.waitUntil(task);
}

// ── Daily summary to the IT Hub ──────────────────────────────────────────────

const DAYS = 7;
const SEND_AFTER_UTC_HOUR = 2; // after Anthropic's day closes, like the hub's own read
const SENT_KEY = "ai_usage_hub_sent";
const HUB_TIMEOUT_MS = 20_000;

export interface HubAggRow extends TokenCounts {
  day: string;
  feature: string;
  model: string;
  calls: number;
}

export interface HubUsageReport {
  vendor: "Anthropic";
  days: { day: string; rows: { company: null; module: string; usd: number; calls: number }[] }[];
}

/** The `count` UTC days ending with `now`'s, oldest first. */
export function lastUtcDays(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Pure: price each row and add models together per day and feature. Every day
 *  is sent, empty ones too, because the hub replaces each day it receives. */
export function buildHubUsageReport(days: string[], rows: HubAggRow[]): HubUsageReport {
  const byDay = new Map(days.map((d) => [d, new Map<string, { company: null; module: string; usd: number; calls: number }>()]));
  for (const r of rows) {
    const day = byDay.get(r.day);
    if (!day) continue;
    const cur = day.get(r.feature) ?? { company: null, module: r.feature, usd: 0, calls: 0 };
    cur.usd += costUsd(r.model, r);
    cur.calls += r.calls;
    day.set(r.feature, cur);
  }
  return {
    vendor: "Anthropic",
    days: days.map((day) => ({
      day,
      rows: [...byDay.get(day)!.values()].map((r) => ({ ...r, usd: Math.round(r.usd * 1e6) / 1e6 })),
    })),
  };
}

/** Pure: whether today's send is due, given the last UTC day sent. */
export function hubSendDue(now: Date, lastSent: string | null): boolean {
  return now.getUTCHours() >= SEND_AFTER_UTC_HOUR && lastSent !== now.toISOString().slice(0, 10);
}

/** Called on every agent heartbeat; sends at most once a UTC day. Returns what
 *  was sent, or null when nothing was due or this deploy has no hub set up. */
export async function sendAiUsageToHubIfDue(
  db: D1Database,
  env: { IT_HUB_URL?: string; IT_HUB_API_KEY?: string },
  now: Date,
): Promise<{ days: number; rows: number } | null> {
  const base = (env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.IT_HUB_API_KEY ?? "").trim();
  if (!base || !key) return null;
  const sent = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(SENT_KEY).first<{ value: string }>();
  if (!hubSendDue(now, sent?.value ?? null)) return null;

  await ensureAiUsageTable(db);
  const days = lastUtcDays(now, DAYS);
  const res = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, feature, model, COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens
         FROM ai_usage_events
        WHERE created_at >= ?
        GROUP BY substr(created_at, 1, 10), feature, model`,
    )
    .bind(`${days[0]}T00:00:00.000Z`)
    .all<Record<string, unknown>>();
  const rows: HubAggRow[] = (res.results ?? []).map((r) => ({
    day: String(r.day),
    feature: String(r.feature),
    model: String(r.model),
    calls: n(r.calls),
    inputTokens: n(r.input_tokens ?? r.inputTokens),
    outputTokens: n(r.output_tokens ?? r.outputTokens),
    cacheReadTokens: n(r.cache_read_tokens ?? r.cacheReadTokens),
    cacheWriteTokens: n(r.cache_write_tokens ?? r.cacheWriteTokens),
  }));
  const report = buildHubUsageReport(days, rows);

  const resp = await fetch(`${base}/api/v1/sys/ai-usage`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`IT Hub ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  await db
    .prepare(
      `INSERT INTO kv_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(SENT_KEY, now.toISOString().slice(0, 10), now.toISOString())
    .run();
  return { days: days.length, rows: report.days.reduce((a, d) => a + d.rows.length, 0) };
}
