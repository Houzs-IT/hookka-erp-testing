// ---------------------------------------------------------------------------
// Mail Center (Batch 2 v3) — data and mutations. The thread PATCH / label
// helpers are the desktop's own (src/pages/mail-center/mail-actions.ts, which
// also invalidate the same caches); compose / reply / acknowledge post the
// exact bodies desktop posts (compose.tsx, detail.tsx).
// ---------------------------------------------------------------------------
import { useMemo, useSyncExternalStore } from "react";
import { invalidateCache, invalidateCachePrefix, useCachedJson } from "@/lib/cached-fetch";
import { csrfHeaders } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/auth";
import { usePermissions } from "@/lib/use-permission";
import { pickDefaultFromAddress } from "@/pages/mail-center/mail-from-default";
import { getSnapshot as getDraftsSnapshot, subscribe as subscribeDrafts } from "@/pages/mail-center/mail-local";
import { getPrefsSnapshot, subscribePrefs } from "@/pages/mail-center/mail-prefs";
import type { MailAddress, MailLabel, MailThread } from "./mail-lib";

export {
  patchThreadStarred, patchThreadLabels, patchThreadUnread, patchThreadTrashed, patchThreadStatus, patchThreadAssignment,
  patchManyStatus, patchManyUnread, patchManyTrashed, patchManyAddLabel, createLabel, updateLabel, deleteLabel, createDeptMailbox,
} from "@/pages/mail-center/mail-actions";
export { saveDraft, deleteDraft, type MailDraft } from "@/pages/mail-center/mail-local";
export { setDensity, setCategoryTabs } from "@/pages/mail-center/mail-prefs";
export { useReplyingHeartbeat } from "@/pages/mail-center/use-replying-heartbeat";
export { alreadyRepliedFrom, agoLabel, joinNames, type AlreadyReplied } from "@/pages/mail-center/mail-reply-rules";
export { sentToast } from "@/pages/mail-center/mail-delivery";
export { validateMailAttachments, decodedBase64Bytes, isAllowedMailAttachment, MAIL_ATTACH_MAX_COUNT, MAIL_ATTACH_MAX_TOTAL_BYTES } from "@/api/lib/mail-attachments";
export { replyRecipients, recipientsValid, type ReplyMode } from "@/api/lib/mail-threading";

/** Who I am, what I may do, which mailboxes I have (shared by every Mail Center view). */
export function useMailCtx() {
  const { hasPermission, loading: permsLoading } = usePermissions();
  const addrQ = useCachedJson<MailAddress[]>("/api/mail-center/addresses", 300);
  const labelsQ = useCachedJson<MailLabel[]>("/api/mail-center/labels", 60);
  const user = getCurrentUser();
  const isSuperAdmin = (user?.role ?? "").toUpperCase() === "SUPER_ADMIN";
  const allQ = useCachedJson<MailAddress[]>(isSuperAdmin ? "/api/mail-center/addresses?all=1" : null, 300);
  const active = useMemo(() => (addrQ.data ?? []).filter((a) => a.active), [addrQ.data]);
  const uid = user?.id ?? "";
  const uemail = user?.email ?? "";
  const myAddress = useMemo(() => pickDefaultFromAddress(active, { id: uid, email: uemail }), [active, uid, uemail]);
  const myAddresses = useMemo(() => new Set(active.map((a) => a.address.toLowerCase())), [active]);
  return {
    user,
    myId: user?.id ?? "",
    isSuperAdmin,
    permsLoading,
    canRead: hasPermission("mail-center", "read"),
    canCreate: hasPermission("mail-center", "create"),
    canUpdate: hasPermission("mail-center", "update"),
    canDelete: hasPermission("mail-center", "delete"),
    addresses: active,
    addressesLoaded: addrQ.data != null,
    addressesError: addrQ.error,
    allAddresses: allQ.data ?? null,
    myAddress,
    myAddresses,
    // No @hookka.com mailbox: nothing to read (the API returns []) and nothing to send from.
    noMailbox: addrQ.data != null && active.length === 0,
    labels: labelsQ.data ?? [],
  };
}
export type MailCtx = ReturnType<typeof useMailCtx>;

export function useDrafts() {
  return useSyncExternalStore(subscribeDrafts, getDraftsSnapshot, getDraftsSnapshot).drafts;
}
export function usePrefs() {
  return useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getPrefsSnapshot);
}

export const refreshThreads = () => invalidateCachePrefix("/api/mail-center/threads");
export const refreshThread = (id: string) => invalidateCache(`/api/mail-center/threads/${id}`);

type Res<T> = { ok: true; status: number; data: T } | { ok: false; status: number; data: T | null; error: string };
async function send<T>(url: string, method: string, body?: unknown): Promise<Res<T>> {
  try {
    const res = await fetch(url, { method, headers: csrfHeaders(), credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    return { ok: false, status: res.status, data, error: data?.error || `Request failed (${res.status})` };
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach the server. Check your connection and try again." };
  }
}

export type OutAttachment = { name: string; type: string; size: number; contentBase64: string };
const attachBody = (files: OutAttachment[]) => (files.length ? { attachments: files.map((f) => ({ filename: f.name, contentBase64: f.contentBase64 })) } : {});

/** POST /compose — a new email or a forward (compose.tsx handleSend). */
export function postCompose(p: { fromAddress: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; forwardOf?: string; ackDueHours: number | null; files: OutAttachment[] }) {
  return send<{ ok?: boolean; threadId?: string; queued?: boolean; error?: string }>("/api/mail-center/compose", "POST", {
    fromAddress: p.fromAddress,
    to: p.to,
    cc: p.cc,
    bcc: p.bcc,
    subject: p.subject.trim(),
    text: p.text,
    ...(p.forwardOf ? { forwardOf: p.forwardOf } : {}),
    ...(p.ackDueHours ? { ackRequired: true, ackDueHours: p.ackDueHours } : {}),
    ...attachBody(p.files),
  });
}

/** POST /threads/:id/reply (detail.tsx handleSend) — `force` = "Send mine too". */
export function postReply(threadId: string, p: { text: string; afterMessageId: string | null; force: boolean; mode: "reply" | "reply_all"; to: string[]; cc: string[]; bcc: string[]; ackDueHours: number | null; fromAddress: string; files: OutAttachment[] }) {
  return send<{ ok?: boolean; queued?: boolean; error?: string; code?: string; by?: string; at?: string }>(`/api/mail-center/threads/${encodeURIComponent(threadId)}/reply`, "POST", {
    text: p.text,
    afterMessageId: p.afterMessageId,
    ...(p.force ? { force: true } : {}),
    mode: p.mode,
    to: p.to,
    cc: p.cc,
    bcc: p.bcc,
    ...(p.ackDueHours ? { ackRequired: true, ackDueHours: p.ackDueHours } : {}),
    ...(p.fromAddress ? { fromAddress: p.fromAddress } : {}),
    ...attachBody(p.files),
  });
}

export function postAcknowledge(threadId: string, messageId: string) {
  return send<{ ok?: boolean }>(`/api/mail-center/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/acknowledge`, "POST");
}

/** SUPER_ADMIN: drop a sample inbound email into the first mailbox (desktop injectTest). */
export function postTestInject() {
  return send<unknown>("/api/mail-center/test-inject", "POST");
}

/** GET a further page of threads (desktop loadMore). */
export async function fetchThreadsPage(url: string, offset: number): Promise<MailThread[] | null> {
  try {
    const res = await fetch(`${url}&offset=${offset}`, { credentials: "include" });
    return res.ok ? ((await res.json()) as MailThread[]) : null;
  } catch {
    return null;
  }
}

/** Read a picked file as raw base64 (compose.tsx readFileAsBase64). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = typeof reader.result === "string" ? reader.result : "";
      const comma = r.indexOf(",");
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
