// ---------------------------------------------------------------------------
// The month's rate from Setup › Currency & FX, for a page that asks for a rate
// in a prompt (GRN → purchase invoice, Mark Paid). Only a DEFAULT (owner
// 2026-10-20): the prompt opens on it and the document keeps whatever is
// typed. null when the currency has no rate for that month or the settings
// cannot be read — the caller falls back to what it did before.
// ---------------------------------------------------------------------------
import { fxRateFor, type FxSettings } from "./fx";

export async function fetchFxRate(code: string | null | undefined, date: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/fx?x=${Date.now()}`, { cache: "no-store" });
    const j = (await res.json()) as { success?: boolean; data?: FxSettings };
    return j?.success && j.data ? fxRateFor(j.data, code, date) : null;
  } catch {
    return null;
  }
}
