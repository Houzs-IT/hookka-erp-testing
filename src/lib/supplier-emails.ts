// ---------------------------------------------------------------------------
// supplier-emails.ts — a supplier's Email / Email 2 / Email 3, one rule for
// the supplier save (server) and the PO email (browser). Cross-system review
// P6, ported from Houzs#5435.
//
// The main Email keeps its old behaviour: every address in it goes in To (some
// suppliers already hold "a@x.com, b@x.com" there). Email 2 and Email 3 hold
// ONE address each and are Cc'd — never a repeat of a To address.
// ---------------------------------------------------------------------------
import { parseAddressList } from "../api/lib/mail-threading";

const ONE_ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isOneEmailAddress(v: string | null | undefined): boolean {
  return ONE_ADDRESS.test((v ?? "").trim());
}

/** The save's check for Email 2 / Email 3: blank clears, otherwise one valid
 *  address. Returns the sentence to show, or null when fine. */
export function supplierExtraEmailError(body: Record<string, unknown>): string | null {
  for (const [key, label] of [
    ["email2", "Email 2"],
    ["email3", "Email 3"],
  ] as const) {
    const v = body[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return `${label} must be text.`;
    const t = v.trim();
    if (t && !isOneEmailAddress(t)) {
      return `${label} (${t}) is not a valid email address. Put one address per field.`;
    }
  }
  return null;
}

/** Who the PO email goes to: To = the main Email's addresses; Cc = Email 2 and
 *  Email 3 (valid ones, once each, never one already in To). With the main
 *  Email blank, the first of Email 2 / Email 3 moves up to To. */
export function poEmailRecipients(s: {
  email?: string | null;
  email2?: string | null;
  email3?: string | null;
}): { to: string[]; cc: string[] } {
  const extra = [s.email2, s.email3].map((e) => (e ?? "").trim()).filter(isOneEmailAddress);
  let to = parseAddressList(s.email ?? "");
  if (to.length === 0 && extra.length > 0) to = [extra.shift()!];
  const seen = new Set(to.map((a) => a.toLowerCase()));
  const cc: string[] = [];
  for (const a of extra) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cc.push(a);
  }
  return { to, cc };
}
