
// ---------------------------------------------------------------------------
// "Today's problems" (owner 2026-10-17): management opens the dashboard every
// day to see what is wrong, so the things that need someone's action sit above
// the tabs on every tab, each one opening the tab that holds its detail. All
// read the same cached GET /api/dashboard/prototype feed the tabs already
// load — no extra request. A tile whose tab this role cannot open, or whose
// feed section is not available to it, is not shown.
// ---------------------------------------------------------------------------

import { TONE, useProblemTiles } from "./use-problem-tiles";

export function ProblemsStrip({ visibleTabs, onOpen }: { visibleTabs: readonly string[]; onOpen: (tab: string, sub?: string, anchor?: string) => void }) {
  const tiles = useProblemTiles(visibleTabs);
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Today's problems" className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B5C32]">Today's problems</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onOpen(t.tab, t.sub, t.anchor)}
            className="min-w-0 rounded-xl bg-white p-3 text-left shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B5C32]"
            style={{ borderTop: `3px solid ${TONE[t.tone].bar}` }}
          >
            <p className="truncate text-xl font-bold tabular-nums" style={{ color: TONE[t.tone].value }}>{t.value}</p>
            <p className="truncate text-xs font-medium text-[#1F1D1B]">{t.label}</p>
            {t.hint && <p className="truncate text-[11px] text-[#9CA3AF]">{t.hint}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}
