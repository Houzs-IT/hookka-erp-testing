// Every Claude call goes through here. Anthropic refuses requests from some
// regions (Hong Kong among them), and Pages runs in whichever data centre the
// user's ISP routes to. When the CLAUDE_FORWARDER service binding is present
// the call is made by claude-forwarder-worker, which is pinned to Singapore.
// Without the binding (tests, local dev) it calls Anthropic directly.
//
// `feature` names the caller in ai_usage_events (lib/ai-usage.ts), which is
// how the IT Hub splits Hookka's AI cost by module. Keep the names stable.

import { recordAiCall } from "./ai-usage";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

let forwarder: Fetcher | undefined;

/** Called once per request from functions/api/[[route]].ts. */
export function setClaudeForwarder(f: Fetcher | undefined): void {
  forwarder = f;
}

export async function claudeFetch(init: RequestInit, feature: string): Promise<Response> {
  const res = await (forwarder ? forwarder.fetch(ANTHROPIC_URL, init) : fetch(ANTHROPIC_URL, init));
  recordAiCall(feature, init, res);
  return res;
}
