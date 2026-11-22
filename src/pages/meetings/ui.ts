// Shared class names and small helpers for the Meetings page files (kept apart from
// the component files so React fast refresh works).
import { cn } from "@/lib/utils";
import { ROOM_COLORS, type Closure, type Room } from "@/lib/meetings";

export const CONTROL =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-raisin placeholder:text-text-tertiary focus:border-taupe focus:outline-none";
export const LABEL = "flex flex-col gap-1 text-[11.5px] font-semibold uppercase tracking-wide text-text-tertiary";
export const BTN = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-white px-3.5 text-[13px] font-medium text-raisin hover:bg-stone-white disabled:opacity-50";
export const PRI = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-taupe px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50";
export const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium";
export const chip = (on: boolean) => cn(CHIP, on ? "border-taupe bg-taupe-10 text-taupe-dark" : "border-border bg-white text-raisin");

/** A small "copied" helper used by guest links; falls back to selecting the text. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type RoomForm = {
  id: number | null; name: string; location: string; floor: string; seats: number; equipment: string[]; days: number[]; openFrom: number; openTo: number;
  color: string; bufferMin: number; maxHours: number; advanceDays: number; active: boolean; closures: Closure[];
};
export const roomForm = (r: Room | null, count: number): RoomForm =>
  r
    ? { id: r.id, name: r.name, location: r.location, floor: r.floor, seats: r.seats, equipment: r.equipment, days: r.open_days, openFrom: r.open_from, openTo: r.open_to, color: r.color, bufferMin: r.buffer_min, maxHours: r.max_hours, advanceDays: r.advance_days, active: r.active, closures: r.closures }
    : { id: null, name: "", location: "Head office", floor: "", seats: 6, equipment: [], days: [1, 2, 3, 4, 5], openFrom: 9, openTo: 18, color: ROOM_COLORS[count % ROOM_COLORS.length], bufferMin: 0, maxHours: 0, advanceDays: 0, active: true, closures: [] };

