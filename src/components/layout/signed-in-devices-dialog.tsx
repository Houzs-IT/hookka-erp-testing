// ---------------------------------------------------------------------------
// SignedInDevicesDialog — "Signed-in devices" from the top-bar user menu.
//
// Hardening batch (owner-approved 2026-11-08). Lists the caller's own live
// sessions from GET /api/auth/sessions and lets them sign out any other device
// (DELETE /api/auth/sessions/:id) or all of them at once
// (POST /api/auth/sessions/revoke-others). The current session is marked and
// cannot be ended here — Sign Out does that. CSRF is injected by the global
// fetch patch in src/lib/api-client.ts.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Laptop, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { pushEscape } from "@/lib/escape-stack";
import { formatDateTime } from "@/lib/utils";

type SessionView = {
  id: string;
  current: boolean;
  device: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
};

async function fetchSessions(): Promise<SessionView[]> {
  const res = await fetch("/api/auth/sessions");
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: SessionView[];
    error?: string;
  };
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Could not load your devices (HTTP ${res.status}).`);
  }
  return body.data ?? [];
}

function isPhone(device: string): boolean {
  return /iPhone|Android|iPad/.test(device);
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : formatDateTime(d);
}

export function SignedInDevicesDialog({ onClose }: { onClose: () => void }) {
  const { confirm } = useConfirm();
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // setState only ever runs in the promise callback, never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      fetchSessions().then(
        (data) => {
          setError(null);
          setSessions(data);
        },
        (e: unknown) => {
          setSessions(null);
          setError(e instanceof Error ? e.message : "Could not load your devices.");
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Esc closes, through the shared Esc stack, so an open confirm dialog on top
  // of this one is closed first. The top bar passes a stable onClose.
  useEffect(() => pushEscape(onClose), [onClose]);

  async function signOutOne(s: SessionView) {
    const ok = await confirm({
      title: "Sign out this device?",
      message: `${s.device} will be signed out and must log in again.`,
      confirmLabel: "Sign Out Device",
      danger: true,
    });
    if (!ok) return;
    setBusy(s.id);
    setError(null);
    try {
      const res = await fetch(`/api/auth/sessions/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) throw new Error(body.error || `Sign out failed (HTTP ${res.status}).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed.");
    } finally {
      setBusy(null);
    }
  }

  async function signOutOthers() {
    const ok = await confirm({
      title: "Sign out all other devices?",
      message: "Every device except this one will be signed out and must log in again.",
      confirmLabel: "Sign Out Others",
      danger: true,
    });
    if (!ok) return;
    setBusy("others");
    setError(null);
    try {
      const res = await fetch("/api/auth/sessions/revoke-others", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) throw new Error(body.error || `Sign out failed (HTTP ${res.status}).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed.");
    } finally {
      setBusy(null);
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  // Portalled to <body>: the top bar is a sticky, z-indexed element, so a
  // fixed overlay rendered inside it would be trapped in its stacking context
  // and the sidebar would sit on top of the backdrop.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Signed-in devices"
        className="relative mx-4 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-[#E2DDD8] bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E2DDD8] p-5">
          <div>
            <h3 className="text-base font-semibold text-[#1F1D1B]">Signed-in devices</h3>
            <p className="mt-1 text-xs text-[#6B7280]">
              Where your account is signed in right now. If you do not recognise a device, sign it out
              and change your password.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-[#9CA3AF] hover:bg-[#F0ECE9] hover:text-[#1F1D1B]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {sessions === null && !error && <p className="text-sm text-[#6B7280]">Loading…</p>}
          {sessions !== null && sessions.length === 0 && (
            <p className="text-sm text-[#6B7280]">No active sessions found.</p>
          )}
          <ul className="space-y-2">
            {(sessions ?? []).map((s) => {
              const Icon = isPhone(s.device) ? Smartphone : Laptop;
              return (
                <li
                  key={s.id}
                  className="flex items-start gap-3 rounded-lg border border-[#E2DDD8] p-3"
                  title={s.userAgent ?? undefined}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#6B5C32]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#1F1D1B]">{s.device}</span>
                      {s.current && (
                        <span className="rounded-full bg-[#EEF3E4] px-2 py-0.5 text-[11px] font-medium text-[#4F7C3A]">
                          This device
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-[#6B7280]">
                      {s.ipAddress && <div>IP address: {s.ipAddress}</div>}
                      <div>Signed in: {when(s.createdAt)}</div>
                      <div>Last active: {when(s.lastSeenAt)}</div>
                    </div>
                  </div>
                  {!s.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void signOutOne(s)}
                      className="shrink-0"
                    >
                      {busy === s.id ? "Signing out…" : "Sign Out"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#E2DDD8] bg-[#FAF9F7] p-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || others.length === 0}
            onClick={() => void signOutOthers()}
            className="bg-[#9A3A2D] text-white hover:bg-[#7A2E24]"
          >
            {busy === "others" ? "Signing out…" : "Sign Out All Other Devices"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
