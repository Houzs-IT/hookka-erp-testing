// ---------------------------------------------------------------------------
// mcp-leak-check.ts — "what would the AI see as this person?" (owner 2026-11-25
// 「确保安全性问题，还有他们可以看到什么不会泄露吗？」).
//
// A Super Admin picks an approved account; the check runs the connector's REAL
// read path (POST /api/mcp → tools/call erp_get, the same module gate and field
// redaction a person's AI app gets) over every list endpoint of every module,
// and reports ONLY field names and outcomes — never values. A short-lived token
// is issued for the run and revoked when it ends.
// ---------------------------------------------------------------------------
import { classifyPath, PRICE_MODULE_RESOURCES, REDACTION_RULES } from "./mcp-access";

/** GET endpoints never called by the check (they may do work, or are huge exports). */
export const LEAK_CHECK_SKIP = /(run|sync|rebuild|warm|generate|export|trigger|seed|backfill|repair|recompute|refresh|download|stream|pdf|print|csv|xlsx|cron|test|debug|probe)/i;

/** Money / people words worth a human look when they survive redaction. */
export const SUSPICIOUS_KEY = /(price|cost|amount|total|sen$|_rm$|rm$|salary|wage|pay|margin|profit|revenue|value|balance|rate|bonus|commission|allowance)/i;

/** The list endpoints the check covers: GET, no path params, readable module, not side-effecty. */
export function leakCheckPaths(routes: { method: string; path: string }[]): string[] {
  const out = new Set<string>();
  for (const r of routes) {
    if (r.method !== "GET") continue;
    const p = r.path;
    if (p.includes(":") || p.includes("*")) continue;
    if (LEAK_CHECK_SKIP.test(p)) continue;
    if (!classifyPath(p).ok) continue;
    out.add(p);
  }
  return [...out].sort();
}

/** Every object key in a JSON value (first 2000 objects), de-duplicated. */
export function jsonKeys(v: unknown): Set<string> {
  const keys = new Set<string>();
  let seen = 0;
  const walk = (x: unknown, depth: number) => {
    if (depth > 30 || seen > 2000) return;
    if (Array.isArray(x)) {
      for (const y of x.slice(0, 50)) walk(y, depth + 1);
    } else if (x && typeof x === "object") {
      seen++;
      for (const [k, y] of Object.entries(x as Record<string, unknown>)) {
        keys.add(k);
        walk(y, depth + 1);
      }
    }
  };
  walk(v, 0);
  return keys;
}

export type LeakRow = {
  path: string;
  outcome: "opened" | "refused" | "error";
  status: string;
  hidden: string[];
  kept: string[];
  keptExpected: boolean;
};

/**
 * Read one erp_get tool result. `kept` = keys still in the reply that look like
 * money / people fields; in a money module (sales order, invoice …) amounts are
 * expected and flagged as such.
 */
export function analyseToolText(path: string, text: string, isError: boolean): LeakRow {
  const d = classifyPath(path);
  const moneyModule = d.ok && d.resources.some((r) => PRICE_MODULE_RESOURCES.has(r));
  if (isError) {
    const refused = /not available to your role|permission/i.test(text);
    return { path, outcome: refused ? "refused" : "error", status: text.slice(0, 120), hidden: [], kept: [], keptExpected: false };
  }
  const nl = text.indexOf("\n");
  const head = text.startsWith("Fields hidden") || text.startsWith("Reply cut") ? text.slice(0, nl) : "";
  const body = head ? text.slice(nl + 1) : text;
  const hidden = (/Fields hidden for this person: ([^.]+)\./.exec(head)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  let keys: Set<string>;
  try {
    keys = jsonKeys(JSON.parse(body));
  } catch {
    // cut reply: keys from the text
    keys = new Set([...body.matchAll(/"([A-Za-z_][A-Za-z0-9_]{0,60})":/g)].map((m) => m[1]));
  }
  const familyOf = (k: string) => REDACTION_RULES.find((r) => r.test(k))?.family;
  const kept = [...keys].filter((k) => SUSPICIOUS_KEY.test(k) && !/(id|no|code|name|date|at|count|qty|quantity|status|type|unit|uom|rateType)$/i.test(k) || familyOf(k) === "salary" || familyOf(k) === "cost").sort();
  return { path, outcome: "opened", status: "ok", hidden, kept: kept.slice(0, 40), keptExpected: moneyModule };
}
