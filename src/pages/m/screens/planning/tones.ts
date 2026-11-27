// Tone / band helpers shared by the Planning screens (kept out of ui.tsx so
// that file only exports components).
import type { KeyboardEvent } from "react";
import type { Lane } from "../../lib/planning-schedule";
import type { PressureBand } from "../../lib/planning-capacity";
import type { Tone } from "../delivery/ui-tokens";

export const laneTone = (lane: Lane | null): Tone => (lane === "BEDFRAME" ? "info" : lane === "SOFA" ? "warning" : lane === "ACCESSORY" ? "success" : "neutral");
export const bandTone = (b: PressureBand): Tone => (b === "high" ? "danger" : b === "busy" ? "warning" : "success");
export const BAND_LABEL: Record<PressureBand, string> = { high: "High", busy: "Busy", normal: "Normal" };

export function onKey(fn?: () => void) {
  return (e: KeyboardEvent) => {
    if (!fn) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}
