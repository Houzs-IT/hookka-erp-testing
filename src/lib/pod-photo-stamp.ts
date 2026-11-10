// ---------------------------------------------------------------------------
// pod-photo-stamp.ts — burn the DO number and the SERVER's date/time into the
// corner of every proof-of-delivery photo (review C2-3, Conts#547), so an old
// or reused photo cannot pass as proof.
//
// The time is the server's, never the phone's: the page learns the offset
// between its clock and the server's from a fresh API answer (`serverNow`)
// and stamps `Date.now() + offset`, shown in Malaysia time. A phone with its
// clock set to another day still stamps today's server time. The server also
// records when each photo reached it (delivery_pod_photos.server_at).
//
// Pure helpers first (tested directly); `stampPodPhoto` needs a browser.
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia: UTC+8, no daylight saving

/**
 * Server clock − device clock, in ms, from one round trip: the server's
 * `serverNow` is taken as the midpoint of the request. Null when unreadable.
 */
export function serverClockOffsetMs(serverNowIso: unknown, sentAtMs: number, receivedAtMs: number): number | null {
  const server = Date.parse(String(serverNowIso ?? ""));
  if (!Number.isFinite(server) || !Number.isFinite(sentAtMs) || !Number.isFinite(receivedAtMs)) return null;
  return Math.round(server - (sentAtMs + receivedAtMs) / 2);
}

/** "10 Nov 2026  16:59" in Malaysia time for an epoch-ms instant. */
export function mytStampTime(ms: number): string {
  const d = new Date(ms + MYT_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${hh}:${mi}`;
}

/** The two stamp lines: the DO number, then the server's date and time. */
export function podStampLines(doNo: string, serverMs: number): [string, string] {
  return [String(doNo || "").trim() || "DO", mytStampTime(serverMs)];
}

/** Where the stamp sits on a w × h photo: bottom-right, scaled to the photo. */
export function podStampLayout(w: number, h: number): { fontPx: number; pad: number; lineGap: number } {
  const short = Math.max(1, Math.min(w, h));
  const fontPx = Math.max(14, Math.round(short / 28));
  return { fontPx, pad: Math.round(fontPx * 0.6), lineGap: Math.round(fontPx * 0.3) };
}

/**
 * Draw the stamp onto a photo data URL and return a JPEG data URL. Browser
 * only. A photo the browser cannot decode is returned unchanged rather than
 * blocking the delivery (the server still records when it arrived).
 */
export async function stampPodPhoto(dataUrl: string, lines: [string, string], quality = 0.8): Promise<string> {
  if (typeof document === "undefined") return dataUrl;
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = dataUrl;
  });
  if (!img || !img.naturalWidth || !img.naturalHeight) return dataUrl;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  const { fontPx, pad, lineGap } = podStampLayout(w, h);
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.ceil(textW + pad * 2);
  const boxH = fontPx * 2 + lineGap + pad * 2;
  const x = w - boxW - pad;
  const y = h - boxH - pad;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, boxW, boxH);
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "top";
  ctx.fillText(lines[0], x + pad, y + pad);
  ctx.fillText(lines[1], x + pad, y + pad + fontPx + lineGap);
  try {
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

/** Ask the server for its clock (any fresh API answer carrying `serverNow`). */
export async function fetchServerClockOffset(url: string): Promise<number | null> {
  try {
    const sent = Date.now();
    const res = await fetch(url, { cache: "no-store" });
    const received = Date.now();
    const body = (await res.json().catch(() => null)) as { serverNow?: string } | null;
    const fromBody = serverClockOffsetMs(body?.serverNow, sent, received);
    if (fromBody != null) return fromBody;
    // Fall back to the HTTP Date header (second resolution).
    return serverClockOffsetMs(res.headers.get("Date"), sent, received);
  } catch {
    return null;
  }
}
