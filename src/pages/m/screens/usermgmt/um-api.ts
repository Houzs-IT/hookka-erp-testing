// ===========================================================================
// User Management (mobile) — network + access hooks.
//
//   gate       usePermissions().role (server-reported; null while loading).
//              SUPER_ADMIN only, as desktop /settings/users (RequireRole) and
//              every users / user-permissions write (requireSuperAdmin). Display
//              gating only: the API still refuses everything else.
//   accounts   GET /api/users            via useCachedJson (no secrets in it)
//   invites    GET /api/users/invites    PLAIN fetch into component memory —
//              never useCachedJson / cachedFetchJson (those persist responses in
//              localStorage, and this payload carries invitation tokens).
//
// Nothing here logs, and network errors never echo the request address.
// ===========================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { getCurrentUser } from "@/lib/auth";
import { INVITES_URL, rowsOf, toInvite, USERS_URL, type Invite, type RawRow } from "../../lib/usermgmt-lib";

export type UmAccess = { loading: boolean; isSuperAdmin: boolean; myId: string };

export function useUserMgmtAccess(): UmAccess {
  const { role, loading } = usePermissions();
  const known = role != null && role !== "";
  return {
    loading: !known && loading,
    isSuperAdmin: known && role.toUpperCase() === "SUPER_ADMIN",
    myId: getCurrentUser()?.id ?? "",
  };
}

// ---- writes ---------------------------------------------------------------------
export type SendResult =
  | { ok: true; data: RawRow | null }
  | { ok: false; status: number; error: string };

/** JSON mutation. status 0 = the server was not reached (outcome unknown). */
export async function send(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "" };
  }
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: RawRow };
  if (!res.ok || json.success === false) {
    return {
      ok: false,
      status: res.status,
      error: json.error || (res.status === 403 ? "Only a Super Admin can manage user accounts." : `Request failed (HTTP ${res.status}).`),
    };
  }
  return { ok: true, data: json.data ?? null };
}

/** After any account write: every cached account read refetches. */
export function invalidateAccounts(): void {
  invalidateCachePrefix(USERS_URL);
  invalidateCachePrefix("/api/user-permissions");
}

// ---- pending invites (memory only) -------------------------------------------------
export type InvitesState = {
  list: Invite[];
  loaded: boolean;
  error: string;
  reload: () => Promise<void>;
  /** The secret for one invite key — only for building a resend / revoke fetch. */
  secretOf: (key: string) => string;
};

export function useInvites(enabled: boolean): InvitesState {
  const [list, setList] = useState<Invite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const secrets = useRef(new Map<string, string>());
  const seq = useRef(0);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    let res: Response | null = null;
    try {
      res = await fetch(INVITES_URL, { credentials: "include", cache: "no-store" });
    } catch {
      res = null;
    }
    if (!alive.current || mine !== seq.current) return;
    if (!res) {
      setError("Check your connection and try again.");
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: unknown };
    if (!alive.current || mine !== seq.current) return;
    if (!res.ok || json.success === false) {
      setError(json.error || `The server answered HTTP ${res.status}.`);
      return;
    }
    const next = new Map<string, string>();
    // Keyed by email (user_invites.email is UNIQUE), so an open sheet survives a refetch.
    const rows = rowsOf(json.data).map((r, i) => {
      const { invite, secret } = toInvite(r, `inv-${String(r.email ?? i).toLowerCase()}`);
      next.set(invite.key, secret);
      return invite;
    });
    secrets.current = next;
    setList(rows);
    setError("");
    setLoaded(true);
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload() sets state only after its fetch settles (an external system)
    if (enabled) void reload();
    return () => {
      alive.current = false;
      secrets.current = new Map();
    };
  }, [enabled, reload]);

  const secretOf = useCallback((key: string) => secrets.current.get(key) ?? "", []);
  return { list, loaded, error, reload, secretOf };
}
