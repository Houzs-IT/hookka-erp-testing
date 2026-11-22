// The few pieces the Meetings page needs from the app, kept in one file so the
// page files read the same as Houzs ERP's (the shared hub, two front ends):
//   api           — JSON calls to /api/meetings; a refusal throws MeetingsApiError
//                   carrying the status and the raw body (a 409 is a conflict the
//                   page draws a dialog from).
//   TabStrip      — Hookka's own Tabs, underline style.
//   DateField     — a plain date box in Hookka's input style.
//   openLoadedTab — open a downloaded file in a new tab.
// CSRF needs nothing here: lib/api-client.ts patches window.fetch for every /api call.
import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function TabStrip<T extends string>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return <Tabs tabs={p.options.map((o) => ({ key: o.value, label: o.label }))} value={p.value} onChange={p.onChange} className={p.className} />;
}

export function DateField(p: { value: string; onChange: (v: string) => void; fullWidth?: boolean; "aria-label"?: string }) {
  return (
    <input
      type="date"
      aria-label={p["aria-label"]}
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
      className={cn("h-10 rounded-md border border-border bg-white px-3 text-sm text-raisin focus:border-taupe focus:outline-none focus:ring-2 focus:ring-taupe-20", p.fullWidth && "w-full")}
    />
  );
}
