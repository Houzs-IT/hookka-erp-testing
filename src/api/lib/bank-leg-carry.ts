import type { Env } from "../worker";
import { planBankCarry, type BankRefs, type CarryLeg, type CarryMove } from "../../lib/bank-leg-carry";
import { loadAccountResolver } from "./account-resolver";

// ---------------------------------------------------------------------------
// The database half of src/lib/bank-leg-carry.ts (class C31): what on the
// bank side holds a document's live legs, and the statements that move it to
// the re-posted legs inside the edit's own batch. Every edit (restate) that
// re-posts a bank / cash leg runs `planEditBankCarry` before its batch.
// ---------------------------------------------------------------------------

type Db = Env["Variables"]["DB"];

// A side table that does not exist yet simply holds nothing.
async function idsIn(db: Db, sql: string, ids: string[], pick: (r: Record<string, unknown>) => unknown): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const marks = ids.map(() => "?").join(", ");
  const res = await db
    .prepare(sql.replace("(%IDS%)", `(${marks})`))
    .bind(...ids)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));
  for (const r of res.results ?? []) out.add(String(pick(r) ?? ""));
  return out;
}

export async function loadBankRefs(db: Db, legIds: string[]): Promise<BankRefs> {
  const [matched, split, ticked] = await Promise.all([
    idsIn(db, "SELECT matchedLegId FROM bank_statement_lines WHERE matchedLegId IN (%IDS%)", legIds, (r) => r.matchedLegId ?? r.matched_leg_id),
    idsIn(db, "SELECT leg_id FROM bank_line_leg_splits WHERE leg_id IN (%IDS%)", legIds, (r) => r.legId ?? r.leg_id),
    idsIn(db, "SELECT leg_id FROM bank_board_cleared WHERE leg_id IN (%IDS%)", legIds, (r) => r.legId ?? r.leg_id),
  ]);
  return { matched, split, ticked };
}

export function bankCarryStatements(db: Db, moves: CarryMove[], refs: BankRefs): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const { from, to } of moves) {
    if (refs.matched.has(from)) out.push(db.prepare("UPDATE bank_statement_lines SET matchedLegId = ? WHERE matchedLegId = ?").bind(to, from));
    if (refs.split.has(from)) out.push(db.prepare("UPDATE bank_line_leg_splits SET leg_id = ? WHERE leg_id = ?").bind(to, from));
    if (refs.ticked.has(from)) out.push(db.prepare("UPDATE bank_board_cleared SET leg_id = ? WHERE leg_id = ?").bind(to, from));
  }
  return out;
}

// The whole step for an edit: `live` = the document's legs the edit reverses
// (with their ids), `posted` = the legs it posts. Either the statements that
// move the bank side along, or the refusal to show the user.
export async function planEditBankCarry(
  db: Db,
  live: CarryLeg[],
  posted: CarryLeg[],
  noun: string,
): Promise<{ ok: true; statements: D1PreparedStatement[]; moved: number } | { ok: false; error: string }> {
  const refs = await loadBankRefs(db, live.map((l) => l.id));
  if (refs.matched.size === 0 && refs.split.size === 0 && refs.ticked.size === 0) return { ok: true, statements: [], moved: 0 };
  const resolve = await loadAccountResolver(db);
  const plan = planBankCarry(live, refs, posted, noun, resolve);
  if (!plan.ok) return plan;
  return { ok: true, statements: bankCarryStatements(db, plan.moves, refs), moved: plan.moves.length };
}
