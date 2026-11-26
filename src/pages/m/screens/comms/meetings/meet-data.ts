// Meetings v3 — reads from /api/meetings/* through the desktop page's own client
// (src/pages/meetings/kit-api.ts: a refusal throws MeetingsApiError with the status
// and the raw body, so a 409 can be read as a booking conflict by readConflict).
// A failed read is kept as an error with the server's sentence ("Meetings is not
// connected yet. Please tell IT."), never shown as an empty calendar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useInterval } from "@/lib/scheduler";
import { api } from "@/pages/meetings/kit-api";
import type { Meeting } from "@/lib/meetings";

export { api, openLoadedTab, MeetingsApiError } from "@/pages/meetings/kit-api";

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");

/** GET `path` (null = don't), again whenever `tick` or the path changes. Keeps the last good data while reloading. */
export function useGet<T>(path: string | null, tick: number): { data: T | null; error: string; loading: boolean } {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string }>({ path: null, data: null, error: "" });
  const live = useRef(0);
  useEffect(() => {
    if (!path) return;
    const id = ++live.current;
    api.get<T>(path).then(
      (data) => { if (id === live.current) setState({ path, data, error: "" }); },
      (e) => { if (id === live.current) setState((s) => ({ path, data: s.path === path ? s.data : null, error: errText(e) })); },
    );
  }, [path, tick]);
  const same = state.path === path;
  return { data: same ? state.data : null, error: same ? state.error : "", loading: !!path && (!same || (state.data === null && !state.error)) };
}

export const calendarPath = (from: number, to: number) =>
  `/api/meetings/calendar?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;

/** Meetings between two instants (the editor's room availability, Find a time, the Rooms page). */
export function useMeetingsBetween(from: number | null, to: number | null, tick: number): { meetings: Meeting[]; error: string; loading: boolean } {
  const r = useGet<{ meetings: Meeting[] }>(from !== null && to !== null ? calendarPath(from, to) : null, tick);
  return { meetings: r.data?.meetings ?? [], error: r.error, loading: r.loading };
}

/** A tick that moves every minute while the tab is visible (desktop polls the calendar each minute). */
export function useMinuteTick(): [number, () => void, number] {
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const bump = useCallback(() => {
    setNow(Date.now());
    setTick((n) => n + 1);
  }, []);
  useInterval(bump, 60_000);
  return [tick, bump, now];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
