// ---------------------------------------------------------------------------
// key-probes.ts — one harmless read per configured outside key (C2-11).
//
// Nothing here sends mail, spends tokens or writes a sheet:
//   Brevo      GET https://api.brevo.com/v3/account
//   Resend     GET https://api.resend.com/domains
//   Anthropic  GET https://api.anthropic.com/v1/models   (lists models; free)
//   Google     the service-account token exchange the Sheets sync already does
// Verdicts: src/lib/key-probe.ts. Results are kept for 10 minutes per isolate
// so the 5-minute alert tick and page opens do not hammer the providers.
// A key is never logged, returned or put in a note.
// ---------------------------------------------------------------------------
import { classifyKeyProbe, type KeyProbeResult } from "../../lib/key-probe";
import { checkSheetsServiceAccount } from "./google-sheets";

const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6000;
let cache: { at: number; results: KeyProbeResult[] } | null = null;

type ProbeEnv = {
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_SHEETS_SA_KEY?: string;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A short marker from a JSON error body (never the body itself). */
async function bodyMarker(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.clone().json()) as { name?: unknown; error?: unknown };
    const v = typeof j.name === "string" ? j.name : typeof j.error === "string" ? j.error : undefined;
    return v && /^[a-z_]{3,40}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

async function httpProbe(
  key: string,
  label: string,
  url: string,
  headers: Record<string, string>,
  doFetch: FetchLike,
): Promise<KeyProbeResult> {
  try {
    const res = await doFetch(url, { method: "GET", headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const marker = res.ok ? undefined : await bodyMarker(res);
    const v = classifyKeyProbe({ status: res.status, marker });
    return { key, label, verdict: v.verdict, status: res.status, note: v.note };
  } catch {
    const v = classifyKeyProbe({ error: true });
    return { key, label, verdict: v.verdict, note: v.note };
  }
}

const notSet = (key: string, label: string): KeyProbeResult => ({
  key,
  label,
  verdict: "not-set",
  note: "Not configured",
});

/** Run every probe (or return the cached set). `fresh` skips the cache. */
export async function runKeyProbes(
  envIn: unknown,
  opts: { fresh?: boolean; fetch?: FetchLike; now?: number } = {},
): Promise<KeyProbeResult[]> {
  const now = opts.now ?? Date.now();
  if (!opts.fresh && cache && now - cache.at < CACHE_MS) return cache.results;
  const env = (envIn ?? {}) as ProbeEnv;
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));

  const jobs: Promise<KeyProbeResult>[] = [];
  jobs.push(
    env.BREVO_API_KEY
      ? httpProbe("brevo", "Mail (Brevo)", "https://api.brevo.com/v3/account", { "api-key": env.BREVO_API_KEY, accept: "application/json" }, doFetch)
      : Promise.resolve(notSet("brevo", "Mail (Brevo)")),
  );
  jobs.push(
    env.RESEND_API_KEY
      ? httpProbe("resend", "Mail (Resend)", "https://api.resend.com/domains", { Authorization: `Bearer ${env.RESEND_API_KEY}` }, doFetch)
      : Promise.resolve(notSet("resend", "Mail (Resend)")),
  );
  jobs.push(
    env.ANTHROPIC_API_KEY
      ? httpProbe("anthropic", "Anthropic (scans, assistant)", "https://api.anthropic.com/v1/models?limit=1", { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, doFetch)
      : Promise.resolve(notSet("anthropic", "Anthropic (scans, assistant)")),
  );
  jobs.push(
    env.GOOGLE_SHEETS_SA_KEY
      ? (async (): Promise<KeyProbeResult> => {
          const label = "Google Sheets";
          const r = await checkSheetsServiceAccount(env.GOOGLE_SHEETS_SA_KEY as string, doFetch, TIMEOUT_MS);
          const v = r.unreadable
            ? { verdict: "refused" as const, note: "The service-account key cannot be read" }
            : classifyKeyProbe({ status: r.status, error: r.error, marker: r.marker });
          return { key: "google-sheets", label, verdict: v.verdict, status: r.status, note: v.note };
        })()
      : Promise.resolve(notSet("google-sheets", "Google Sheets")),
  );
  const results = await Promise.all(jobs);
  cache = { at: now, results };
  return results;
}

/** Tests only. */
export function _resetKeyProbeCache(): void {
  cache = null;
}
