// ---------------------------------------------------------------------------
// worker-cjk-font.ts — the CJK font for PDFs rendered inside the Worker
// (review H1-1). The DO / Invoice auto-email renders the unified PDF on the
// server (delivery-orders/_helpers.ts → buildUnifiedDocPdf). The font is the
// same static file the browser uses, public/fonts/NotoSansSC-Regular.ttf,
// read from this Pages deployment's own assets:
//
//   1. env.ASSETS (the binding Cloudflare Pages gives every Function) — no
//      network hop, no subrequest to the public internet;
//   2. otherwise a plain fetch of <request origin>/fonts/… (wrangler dev, or a
//      host without the binding).
//
// The bytes are kept per isolate by loadCjkFontBytes, and only fetched when a
// document actually has Chinese text (embedCjkFontIfNeeded checks first).
// Any failure resolves to null → the PDF prints "?" for those characters, as
// it always did; the email is never blocked by the font.
// ---------------------------------------------------------------------------
import { CJK_FONT_PATH, loadCjkFontBytes, type CjkFontLoader } from "../../lib/pdf-cjk-font";

type AssetsBinding = { fetch: (input: Request | string) => Promise<Response> };

export function workerCjkFontLoader(
  env: unknown,
  requestUrl: string | null | undefined,
): CjkFontLoader {
  return () => {
    let url: string;
    try {
      url = new URL(CJK_FONT_PATH, requestUrl || "http://localhost").toString();
    } catch {
      return Promise.resolve(null);
    }
    const assets = (env as { ASSETS?: AssetsBinding } | null | undefined)?.ASSETS;
    return loadCjkFontBytes(() =>
      assets && typeof assets.fetch === "function"
        ? assets.fetch(new Request(url))
        : fetch(url),
    );
  };
}
