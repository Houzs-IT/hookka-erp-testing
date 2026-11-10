// ---------------------------------------------------------------------------
// pdf-cjk-font.ts — Chinese (CJK) text on the pdf-lib documents (review H1-1).
//
// pdf-lib's built-in Helvetica can only draw WinAnsi (Latin-1), so a supplier,
// customer or item name in Chinese printed as "???" on the DO / Invoice / SO /
// CO PDFs (src/api/lib/unified-do-invoice-pdf.ts). This file holds the pure
// pieces of the fix, shared by the browser and the Worker:
//
//   · needsCjkFont(s)    — does this string carry a CJK character?
//   · documentNeedsCjk() — does ANY string in the document? Only then is the
//                          font fetched and embedded, so an ordinary all-Latin
//                          PDF stays exactly the size it was (Helvetica only).
//   · cjkSafe(s, set)    — replace the few characters the font lacks with "?"
//                          so a stray glyph never prints as an empty box.
//   · loadCjkFontBytes() — fetch the font once per page load / Worker isolate
//                          and keep the bytes; a failed fetch returns null and
//                          the document falls back to the old "?" output — a
//                          font problem can never stop a PDF from rendering.
//
// The font: Noto Sans SC Regular (Google Fonts static TTF, SIL OFL 1.1 — see
// public/fonts/OFL.txt), the 400Regular file of the pinned npm package
// @expo-google-fonts/noto-sans-sc@0.4.4, served from the app's own
// /fonts/NotoSansSC-Regular.ttf. It is ~10 MB, so it is NOT bundled into the
// Worker or the JS chunks; it is fetched only when a document has Chinese in
// it, and pdf-lib embeds a SUBSET (embedFont(bytes, { subset: true })), so a
// PDF carries only the glyphs it actually uses (a few KB). It covers Simplified
// and most Traditional characters, plus Latin, so a mixed string such as
// "KAYU JATI 柚木" prints in one font.
// ---------------------------------------------------------------------------

/** Public path of the font (public/fonts/ → dist/fonts/). */
export const CJK_FONT_PATH = "/fonts/NotoSansSC-Regular.ttf";

// CJK radicals / symbols & punctuation / kana / bopomofo / Hangul jamo &
// syllables / CJK Unified (+ Ext A) / compatibility ideographs / vertical &
// small forms / fullwidth forms, and the supplementary ideograph planes.
const CJK_RE =
  /[\u2E80-\u2FDF\u3001-\u303F\u3040-\u31FF\u3200-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE10-\uFE1F\uFE30-\uFE6F\uFF01-\uFFEF]|[\u{20000}-\u{3134F}]/u;

/** True when the string carries a character Helvetica cannot draw but the CJK font can. */
export function needsCjkFont(s: unknown): boolean {
  return typeof s === "string" && s.length > 0 && CJK_RE.test(s);
}

/** True when any string anywhere in `value` (deep: arrays / plain objects) needs the CJK font. */
export function documentNeedsCjk(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null) return false;
  if (typeof value === "string") return needsCjkFont(value);
  if (Array.isArray(value)) return value.some((v) => documentNeedsCjk(v, depth + 1));
  if (typeof value === "object") {
    // The logo is a long base64 string — never CJK, skip the scan.
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "logoPngBase64") continue;
      if (documentNeedsCjk(v, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * Keep every character the font can draw; anything else becomes "?" (the same
 * fallback Helvetica text uses). Odd spaces fold to a plain space. Works on
 * code points, so a supplementary-plane ideograph is one character.
 */
export function cjkSafe(s: string, charset: ReadonlySet<number>): string {
  if (!s) return s;
  let out = "";
  for (const ch of s.replace(/[\u00A0\u2000-\u200B\u202F\u205F]/g, " ")) {
    const cp = ch.codePointAt(0) ?? 0;
    out += ch === "\n" || charset.has(cp) ? ch : "?";
  }
  return out;
}

export type CjkFontLoader = () => Promise<Uint8Array | null>;

// ── @pdf-lib/fontkit odd-length glyph fix ────────────────────────────────
// @pdf-lib/fontkit 1.1.1's TrueType subsetter copies each glyph's bytes as
// they are and, for a small subset, writes the SHORT loca format (offset / 2).
// Noto Sans SC has 15,284 of its 30,898 glyphs at an odd byte length, so every
// glyph after the first odd one pointed half a byte off and printed blank
// (measured: "顺发家具有限公司" drew only 顺发家具). Upstream fontkit 2 pads each
// glyph to an even length; this does the same by wrapping the subset's
// _addGlyph: after the original copies a glyph, an odd buffer gets one zero
// byte and the running offset moves with it. Patched once per subset class.
type FontkitLike = { create: (...args: never[]) => unknown };
type SubsetProto = {
  _addGlyph?: (this: SubsetThis, gid: number) => number;
  __evenGlyphPad?: boolean;
};
type SubsetThis = { glyf: Uint8Array[]; offset: number };

export function padOddGlyphs(proto: SubsetProto | null | undefined): void {
  if (!proto || proto.__evenGlyphPad || typeof proto._addGlyph !== "function") return;
  const original = proto._addGlyph;
  proto._addGlyph = function (this: SubsetThis, gid: number): number {
    const idx = original.call(this, gid);
    const buf = this.glyf?.[idx];
    if (buf && buf.length % 2 === 1) {
      // Same class as the original (fontkit's stream only accepts its own
      // Buffer type); typed arrays are zero-filled, so the pad byte is 0.
      const Ctor = buf.constructor as {
        alloc?: (n: number) => Uint8Array;
        new (n: number): Uint8Array;
      };
      const padded = typeof Ctor.alloc === "function" ? Ctor.alloc(buf.length + 1) : new Ctor(buf.length + 1);
      padded.set(buf);
      this.glyf[idx] = padded;
      this.offset += 1;
    }
    return idx;
  };
  proto.__evenGlyphPad = true;
}

/** A fontkit whose fonts' TrueType subsets are padded (see above). Pass to pdf.registerFontkit. */
export function withEvenGlyphPadding<T extends FontkitLike>(fontkit: T): T {
  const create = fontkit.create.bind(fontkit) as (...args: unknown[]) => unknown;
  return {
    ...fontkit,
    create: (...args: unknown[]) => {
      const font = create(...args) as { createSubset?: () => unknown } | null;
      if (font && typeof font.createSubset === "function") {
        padOddGlyphs(Object.getPrototypeOf(font.createSubset()) as SubsetProto);
      }
      return font;
    },
  } as T;
}

let cached: Promise<Uint8Array | null> | null = null;

/**
 * Fetch the font bytes once and keep them (per browser tab / Worker isolate).
 * `fetchFont` returns the Response for CJK_FONT_PATH; a non-OK response or a
 * throw resolves to null and is NOT cached, so the next document retries.
 */
export function loadCjkFontBytes(fetchFont: () => Promise<Response>): Promise<Uint8Array | null> {
  if (cached) return cached;
  const p = (async () => {
    try {
      const res = await fetchFont();
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      // A TrueType / OpenType file starts 00 01 00 00 or "OTTO"; the SPA
      // fallback would hand back index.html with a 200 for a missing file.
      const sig = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
      if (buf.length < 1024 || (sig !== 0x00010000 && sig !== 0x4f54544f)) return null;
      return buf;
    } catch {
      return null;
    }
  })();
  cached = p;
  void p.then((b) => {
    if (!b && cached === p) cached = null;
  });
  return p;
}

/** Browser default: the font from this site's own origin. Null outside a browser. */
export const browserCjkFontLoader: CjkFontLoader = () => {
  if (typeof window === "undefined" || typeof fetch !== "function") return Promise.resolve(null);
  return loadCjkFontBytes(() => fetch(CJK_FONT_PATH, { credentials: "same-origin" }));
};

/** Test hook — forget the cached bytes. */
export function resetCjkFontCacheForTests(): void {
  cached = null;
}
