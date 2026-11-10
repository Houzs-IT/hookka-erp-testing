// ---------------------------------------------------------------------------
// key-probe.ts — does each outside key still work? (cross-system review pass
// 2, C2-11; sister Conts#740 / #749).
//
// System Health only looked at our own traffic, so a mail key someone revoked
// showed green until the first customer email bounced. The server now makes
// one harmless READ per configured key (mail provider account / domain list,
// Anthropic model list, Google token exchange) and this module turns each
// answer into a verdict:
//
//   ok         the provider accepted the key (2xx, or 429 = accepted but busy)
//   refused    the provider rejected the key (401 / 403, Google invalid_grant)
//              -> the banner turns RED, so the existing alert email fires
//   no-answer  timeout, network error, 5xx or an unexpected answer
//              -> AMBER only: the key may be fine and the provider down
//   not-set    the key is not configured — nothing to check, no tone
//
// Pure; shared by the probe runner (src/api/lib/key-probes.ts), the health
// verdict (src/lib/health-status.ts) and the System Health page.
// ---------------------------------------------------------------------------

export type KeyVerdict = "ok" | "refused" | "no-answer" | "not-set";

export interface KeyProbeResult {
  /** Stable id: "brevo", "resend", "anthropic", "google-sheets". */
  key: string;
  /** What the page shows: "Mail (Brevo)", "Anthropic", ... */
  label: string;
  verdict: KeyVerdict;
  /** HTTP status when there was one. */
  status?: number;
  /** One short plain-English line; never the key or a response body. */
  note: string;
}

/** Turn one probe's answer into a verdict. `error` = the fetch threw. */
export function classifyKeyProbe(input: {
  status?: number;
  error?: boolean;
  /** A short marker read from the body, e.g. "restricted_api_key" / "invalid_grant". */
  marker?: string;
}): { verdict: Exclude<KeyVerdict, "not-set">; note: string } {
  if (input.error || input.status == null) {
    return { verdict: "no-answer", note: "No answer from the provider (timeout or network)" };
  }
  const s = input.status;
  const m = input.marker ?? "";
  // Resend: a send-only key may not list domains — the key itself is valid.
  if (m === "restricted_api_key") return { verdict: "ok", note: "Key accepted (send-only key)" };
  if (m === "invalid_grant" || m === "invalid_client") {
    return { verdict: "refused", note: "The provider refused this key" };
  }
  if (s >= 200 && s < 300) return { verdict: "ok", note: "Key accepted" };
  if (s === 429) return { verdict: "ok", note: "Key accepted (provider busy)" };
  if (s === 401 || s === 403) return { verdict: "refused", note: "The provider refused this key" };
  if (s >= 500) return { verdict: "no-answer", note: `Provider error (HTTP ${s})` };
  return { verdict: "no-answer", note: `Unexpected answer (HTTP ${s})` };
}

/** The labels of refused / unanswered keys, for the health verdict. */
export function keyProblems(results: KeyProbeResult[] | null | undefined): {
  refused: string[];
  noAnswer: string[];
} {
  const list = results ?? [];
  return {
    refused: list.filter((r) => r.verdict === "refused").map((r) => r.label),
    noAnswer: list.filter((r) => r.verdict === "no-answer").map((r) => r.label),
  };
}
