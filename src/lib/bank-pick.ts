// ---------------------------------------------------------------------------
// bank-pick.ts — Cash Book matching by pick list (finance backlog item 16,
// owner 2026-10-17 「这个可以」; the design's Cash Book). Each open bank line
// shows the book entry it most likely is (the single open entry with the same
// amount), and a Pick list of the book entries it could have paid: tick one
// with the same amount (a plain match) or several that add up to it exactly
// (a split match). Ticking several BANK lines offers the entries equal to
// their sum (a combined match). Pure, so the rules are tested apart from the
// screen; the server checks every match again.
// ---------------------------------------------------------------------------

export type PickLeg = { id: string; day: string; description: string; amountSen: number };
export type PickLine = { amountSen: number };

// The split endpoint takes 2–20 book entries (POST /bank-reco/match-split).
export const PICK_MAX = 20;

export type Suggestion = { kind: "one"; leg: PickLeg } | { kind: "several"; n: number } | { kind: "none" };

// The suggested book entry: the one open entry with the same amount.
export function suggestionFor(line: PickLine, open: PickLeg[]): Suggestion {
  const same = open.filter((l) => l.amountSen === line.amountSen);
  if (same.length === 1) return { kind: "one", leg: same[0] };
  if (same.length > 1) return { kind: "several", n: same.length };
  return { kind: "none" };
}

// What the Pick list offers: open entries in the same direction, no bigger
// than the line (a bigger one can never be part of an exact pick), oldest
// first like the book list.
export function pickCandidates(line: PickLine, open: PickLeg[]): PickLeg[] {
  const sign = Math.sign(line.amountSen);
  if (sign === 0) return [];
  return open
    .filter((l) => Math.sign(l.amountSen) === sign && Math.abs(l.amountSen) <= Math.abs(line.amountSen))
    .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}

// How the ticked entries stand against the line: exact, or short / over by.
export function pickState(line: PickLine, picked: PickLeg[]): { exact: boolean; diffSen: number } {
  const sum = picked.reduce((t, l) => t + l.amountSen, 0);
  const diffSen = Math.abs(line.amountSen) - Math.abs(sum); // > 0 short, < 0 over
  return { exact: picked.length > 0 && diffSen === 0, diffSen };
}

// Which match the ticked entries make: one entry → a plain match, 2–20 → a
// split match; nothing (or more than the server takes) → none.
export function pickAction(picked: PickLeg[]): "match" | "split" | null {
  if (picked.length === 1) return "match";
  if (picked.length >= 2 && picked.length <= PICK_MAX) return "split";
  return null;
}

// Ticked bank lines (2 or more) that together paid ONE book entry: the open
// entries equal to their sum.
export function comboCandidates(ticked: PickLine[], open: PickLeg[]): PickLeg[] {
  if (ticked.length < 2) return [];
  const sum = ticked.reduce((t, l) => t + l.amountSen, 0);
  return open.filter((l) => l.amountSen === sum);
}
