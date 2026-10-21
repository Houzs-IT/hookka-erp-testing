// ---------------------------------------------------------------------------
// Currency & FX settings in kv_config (owner 2026-10-20): the currencies, their
// monthly rates and the FX gain / loss accounts (src/lib/fx.ts holds the
// rules). One JSON value, like the trade-finance lines. A read never throws:
// a missing or unreadable value is the defaults (gain and loss → 530-0000,
// today's account), so a payment posts exactly as before until the page says
// otherwise.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { emptyFxSettings, parseFxSettings, type FxSettings } from "../../lib/fx";

type Db = Env["Variables"]["DB"];

export const FX_KV_KEY = "fx_settings";

export async function getFxSettings(db: Db): Promise<FxSettings> {
  try {
    const row = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(FX_KV_KEY).first<{ value: string | null }>();
    if (!row?.value) return emptyFxSettings();
    return parseFxSettings(JSON.parse(row.value));
  } catch {
    return emptyFxSettings();
  }
}

export async function saveFxSettings(db: Db, s: FxSettings): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kv_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    )
    .bind(FX_KV_KEY, JSON.stringify(s), new Date().toISOString())
    .run();
}
