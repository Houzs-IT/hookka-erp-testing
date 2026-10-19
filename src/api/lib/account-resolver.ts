import type { Env } from "../worker";
import { requestMemo } from "./step-timing";

// ---------------------------------------------------------------------------
// Account-code rename aliases (migration 0157). The immutable ledger
// hash-chains accountCode into every row, so a rename can never rewrite
// history — instead old→new mappings live in account_aliases and EVERY
// read surface resolves through this (transitively, for chained renames).
// Identity fallback when the table hasn't been migrated yet.
// (Moved from routes/accounting.ts 2026-10-17 so the payment routes can
// compare a re-posted bank leg with the old one — src/lib/bank-leg-carry.ts.)
// ---------------------------------------------------------------------------
// Loaded once per read request (requestMemo — every bank account of Daily Cash
// Position and every report helper asked again); a plain load on writes.
export function loadAccountResolver(
  db: Env["Variables"]["DB"],
): Promise<(code: string) => string> {
  return requestMemo("account-resolver", () => loadAccountResolverFresh(db));
}

async function loadAccountResolverFresh(
  db: Env["Variables"]["DB"],
): Promise<(code: string) => string> {
  try {
    const res = await db
      .prepare("SELECT oldCode, newCode FROM account_aliases")
      .all<{ oldCode: string; newCode: string }>();
    const m = new Map(
      (res.results ?? []).map((r) => [r.oldCode, r.newCode] as const),
    );
    if (m.size === 0) return (c) => c;
    return (code) => {
      let c = code;
      for (let i = 0; i < 10 && m.has(c); i++) c = m.get(c)!;
      return c;
    };
  } catch {
    return (c) => c;
  }
}
