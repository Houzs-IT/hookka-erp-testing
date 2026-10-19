// ---------------------------------------------------------------------------
// step-timing.ts — where a slow request spends its time, step by step.
//
// The Server-Timing header already carries `app` (the whole request) and `db`
// (every query added up). That says a report is slow, not WHICH part of it:
// /pl-statement measured 22 s over 90 queries on 2026-10-19 (owner
// 「优化加载速度」) and nothing said whether the ledger window, the material
// replay or the production-order stock valuation took the time.
//
// `timed(name, fn)` records how long fn took under the current request; the
// timing middleware runs each request inside `withStepTiming` and adds the
// steps to Server-Timing as `s-<name>;dur=<total ms>;desc="<n>x"` (the largest
// first, at most STEP_LIMIT of them). Outside a request — tests, cron — it
// just runs fn. Read-only, no effect on what a request returns.
// ---------------------------------------------------------------------------
import { AsyncLocalStorage } from "node:async_hooks";

export type StepMark = { name: string; ms: number };

const store = new AsyncLocalStorage<StepMark[]>();

/** Run a request's handler with a fresh list of step marks. */
export function withStepTiming<T>(marks: StepMark[], fn: () => Promise<T>): Promise<T> {
  return store.run(marks, fn);
}

/** Time one step of the current request (a no-op wrapper outside one). */
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const marks = store.getStore();
  if (!marks) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    marks.push({ name, ms: Date.now() - t0 });
  }
}

/** `fn` with every call timed as `name` — for a helper whose callers are many. */
export function timedFn<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => timed(name, () => fn(...args));
}

export const STEP_LIMIT = 12;

/**
 * The request's steps as Server-Timing entries: one per step name (its time
 * added up, how many times it ran), the slowest first. Names are reduced to
 * the token characters the header allows.
 */
export function stepTimingEntries(marks: readonly StepMark[], limit = STEP_LIMIT): string[] {
  const by = new Map<string, { ms: number; n: number }>();
  for (const m of marks) {
    const key = `s-${m.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const cur = by.get(key) ?? { ms: 0, n: 0 };
    cur.ms += m.ms;
    cur.n += 1;
    by.set(key, cur);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, limit)
    .map(([key, v]) => `${key};dur=${v.ms};desc="${v.n}x"`);
}
