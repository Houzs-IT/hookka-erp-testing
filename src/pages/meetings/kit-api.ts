// JSON calls to /api/meetings for the Meetings page (see kit.tsx for why this exists).
// A refusal throws MeetingsApiError with the status and raw body: a 409 is a conflict.
export class MeetingsApiError extends Error {
  readonly status: number;
  readonly rawBody: string;
  constructor(message: string, status: number, rawBody: string) {
    super(message);
    this.status = status;
    this.rawBody = rawBody;
  }
}

async function call<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: form ? undefined : body === undefined ? undefined : { "Content-Type": "application/json" },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = "Something went wrong. Please try again.";
    try {
      const j = JSON.parse(raw) as { error?: unknown };
      if (typeof j.error === "string" && j.error !== "conflict") msg = j.error;
      else if (j.error === "conflict") msg = "That time is taken.";
    } catch {
      /* not JSON: keep the plain sentence */
    }
    throw new MeetingsApiError(msg, res.status, raw);
  }
  return (raw ? JSON.parse(raw) : {}) as T;
}

export const api = {
  get: <T,>(path: string, _opts?: { signal?: AbortSignal }) => call<T>("GET", path),
  post: <T = unknown,>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T = unknown,>(path: string, body?: unknown) => call<T>("PATCH", path, body ?? {}),
  postForm: <T = unknown,>(path: string, form: FormData) => call<T>("POST", path, undefined, form),
  async fetchBlobUrl(path: string, mime?: string): Promise<string> {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) throw new MeetingsApiError("That file could not be opened.", res.status, "");
    const blob = await res.blob();
    // A blob: URL runs as this site, so only these open in the tab; anything else (HTML, SVG...) downloads.
    const type = ["image/png", "image/jpeg", "application/pdf"].includes((mime ?? blob.type).toLowerCase()) ? (mime ?? blob.type).toLowerCase() : "application/octet-stream";
    return URL.createObjectURL(new Blob([blob], { type }));
  },
};

/** Opens a file fetched with the session in a new tab, and frees it after `keepMs`. */
export async function openLoadedTab(load: () => Promise<string>, keepMs: number): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = await load();
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    // eslint-disable-next-line no-restricted-syntax -- a plain utility called from a click, not a component
    setTimeout(() => URL.revokeObjectURL(url), keepMs);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

