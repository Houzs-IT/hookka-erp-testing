// IT Support API calls — the desktop page's `api` helper (src/pages/it-support/index.tsx):
// one shape for success and failure, the server's own error text kept (e.g. the
// 503 "IT Support is not connected yet. Please tell IT directly.").
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function itApi<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/it-support${path}`, init);
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
    if (res.ok && body?.success && body.data !== undefined) return { ok: true, data: body.data };
    return { ok: false, error: body?.error || `Request failed (${res.status})`, status: res.status };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again.", status: 0 };
  }
}

/** A stored attachment, streamed through the API as desktop links it. */
export const attachmentUrl = (id: number) => `/api/it-support/attachments/${id}`;
