// Chinese characters on the pdf-lib documents (review H1-1, WORK-TRACKER 129).
// The unified DO / Invoice / SO / CO renderer embeds a SUBSET of Noto Sans SC
// only when the document has CJK text; Helvetica otherwise. Pure helpers are
// exercised directly, the renderer end to end, and the wiring by source
// pattern (house style, see tests/fe-quality-batch-a.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

import {
  CJK_FONT_PATH,
  cjkSafe,
  documentNeedsCjk,
  loadCjkFontBytes,
  needsCjkFont,
  padOddGlyphs,
  resetCjkFontCacheForTests,
  withEvenGlyphPadding,
} from "../src/lib/pdf-cjk-font.ts";
import { buildUnifiedDocPdf } from "../src/api/lib/unified-do-invoice-pdf.ts";
import { workerCjkFontLoader } from "../src/api/lib/worker-cjk-font.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const FONT_FILE = "public" + CJK_FONT_PATH;
const fontBytes = () => new Uint8Array(readFileSync(FONT_FILE));
// BaseFont names of every font dict in the PDF (pdf-lib writes object streams,
// so a byte search would not see them).
async function fontNames(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const out = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Font")) {
      out.push(String(obj.get(PDFName.of("BaseFont")) ?? ""));
    }
  }
  return out.join(" ");
}

// ── Detection ─────────────────────────────────────────────────────────────
test("needsCjkFont: Chinese / Japanese / Korean / fullwidth yes; Latin, accents, typography no", () => {
  for (const s of ["顺发家具", "臺灣", "KAYU JATI 柚木", "カタカナ", "한국", "（括号）", "家具，"]) {
    assert.equal(needsCjkFont(s), true, s);
  }
  for (const s of ["ACME SDN BHD", "Café Noël", "“quoted” — dash…", "KŌRI", "", "　"]) {
    assert.equal(needsCjkFont(s), false, s);
  }
  assert.equal(needsCjkFont(null), false);
  assert.equal(needsCjkFont(42), false);
});

test("documentNeedsCjk scans nested fields but never the logo", () => {
  assert.equal(documentNeedsCjk({ leftFields: [["Customer", "ACME"]], groups: [{ items: [{ name: "Sofa" }] }] }), false);
  assert.equal(documentNeedsCjk({ leftFields: [["Customer", "顺发"]] }), true);
  assert.equal(documentNeedsCjk({ groups: [{ items: [{ specLines: ["Fabric", "皮"] }] }] }), true);
  assert.equal(documentNeedsCjk({ logoPngBase64: "柚木" }), false);
});

test("cjkSafe keeps what the font has, turns the rest into ?", () => {
  const set = new Set([..."顺发 AB"].map((c) => c.codePointAt(0)));
  assert.equal(cjkSafe("顺发 AB", set), "顺发 AB");
  assert.equal(cjkSafe("顺X发", set), "顺?发");
  // A supplementary-plane ideograph is one character, not two "?".
  assert.equal(cjkSafe("顺\u{20000}", set), "顺?");
  // Odd spaces fold to a plain space.
  assert.equal(cjkSafe("顺 发", set), "顺 发");
});

// ── Font loading ──────────────────────────────────────────────────────────
const ttfHead = () => {
  const b = new Uint8Array(2048);
  b.set([0x00, 0x01, 0x00, 0x00]);
  return b;
};

test("loadCjkFontBytes fetches once, keeps the bytes, and retries after a failure", async () => {
  resetCjkFontCacheForTests();
  let calls = 0;
  const bad = await loadCjkFontBytes(async () => { calls++; return new Response("nope", { status: 404 }); });
  assert.equal(bad, null);
  await new Promise((r) => setTimeout(r, 0));
  const ok = await loadCjkFontBytes(async () => { calls++; return new Response(ttfHead()); });
  assert.ok(ok instanceof Uint8Array);
  const again = await loadCjkFontBytes(async () => { calls++; throw new Error("should be cached"); });
  assert.equal(again, ok);
  assert.equal(calls, 2);
  resetCjkFontCacheForTests();
});

test("loadCjkFontBytes rejects the SPA's index.html served with a 200", async () => {
  resetCjkFontCacheForTests();
  const html = "<!doctype html><html>" + " ".repeat(4000) + "</html>";
  assert.equal(await loadCjkFontBytes(async () => new Response(html, { status: 200 })), null);
  resetCjkFontCacheForTests();
});

test("workerCjkFontLoader reads the font from env.ASSETS at the request origin", async () => {
  resetCjkFontCacheForTests();
  const seen = [];
  const env = { ASSETS: { fetch: async (req) => { seen.push(req.url); return new Response(ttfHead()); } } };
  const bytes = await workerCjkFontLoader(env, "https://erp.example.test/api/delivery-orders/x/notify")();
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(seen, ["https://erp.example.test/fonts/NotoSansSC-Regular.ttf"]);
  resetCjkFontCacheForTests();
});

// ── The @pdf-lib/fontkit odd-length glyph fix ─────────────────────────────
test("padOddGlyphs pads an odd glyph buffer to even length and moves the offset", () => {
  const proto = {
    _addGlyph(gid) {
      const buf = new Uint8Array(gid); // gid doubles as length here
      this.glyf.push(buf);
      this.offset += buf.length;
      return this.glyf.length - 1;
    },
  };
  padOddGlyphs(proto);
  padOddGlyphs(proto); // idempotent
  const sub = Object.assign(Object.create(proto), { glyf: [], offset: 0 });
  sub._addGlyph(169);
  sub._addGlyph(218);
  assert.deepEqual(sub.glyf.map((b) => b.length), [170, 218]);
  assert.equal(sub.offset, 388);
});

test("Noto Sans SC subset keeps every glyph outline (was blank after the first odd-length glyph)", async () => {
  const font = withEvenGlyphPadding(fontkit).create(Buffer.from(fontBytes()));
  const run = font.layout("顺发家具有限公司 SOON FATT");
  const subset = font.createSubset();
  for (const g of run.glyphs) subset.includeGlyph(g);
  const chunks = [];
  await new Promise((resolve, reject) => {
    const st = subset.encodeStream();
    st.on("data", (d) => chunks.push(Buffer.from(d)));
    st.on("end", resolve);
    st.on("error", reject);
  });
  const sub = fontkit.create(Buffer.concat(chunks));
  for (let i = 1; i < sub.numGlyphs; i++) {
    const g = sub.getGlyph(i);
    const isSpace = g.advanceWidth > 0 && g.path.commands.length === 0;
    if (!isSpace) assert.ok(g.path.commands.length > 0, `glyph ${i} has an outline`);
  }
});

// ── The renderer ──────────────────────────────────────────────────────────
const doc = (customer, name) => ({
  kind: "INVOICE",
  docNo: "INV-2611-001",
  docDate: "10/11/2026",
  statusText: "NET 30",
  leftFields: [["Customer", customer]],
  rightFields: [["DO No", "DO-2611-001"]],
  groups: [{ category: "SOFA", items: [{ orderRefs: ["SO-1"], code: "SF-1", name, specLines: [], set: 1, priceSen: 150000, lineTotalSen: 150000 }] }],
  totalSets: 1,
  subtotalSen: 150000,
  totalSen: 150000,
});

test("an all-Latin document never loads the font and stays Helvetica-only", async () => {
  let loads = 0;
  const bytes = await buildUnifiedDocPdf(doc("ACME SDN BHD", "Sofa"), { loadCjkFont: async () => { loads++; return fontBytes(); } });
  assert.equal(loads, 0);
  const names = await fontNames(bytes);
  assert.match(names, /Helvetica/);
  assert.doesNotMatch(names, /NotoSansSC/);
});

test("a Chinese name embeds a SUBSET of Noto Sans SC (a few KB, not the 10 MB file)", async () => {
  const withFont = await buildUnifiedDocPdf(doc("顺发家具有限公司", "三人座沙发"), { loadCjkFont: async () => fontBytes() });
  assert.match(await fontNames(withFont), /NotoSansSC/);
  assert.ok(withFont.length < 40_000, `subset, got ${withFont.length} bytes`);
  // Without a font source it still renders (the old "?" output), never throws.
  const noFont = await buildUnifiedDocPdf(doc("顺发家具有限公司", "三人座沙发"), { loadCjkFont: null });
  assert.doesNotMatch(await fontNames(noFont), /NotoSansSC/);
  const failing = await buildUnifiedDocPdf(doc("顺发", "沙发"), { loadCjkFont: async () => { throw new Error("offline"); } });
  assert.ok(failing.length > 1000);
});

// ── Wiring ────────────────────────────────────────────────────────────────
test("the font ships in public/fonts with its OFL licence and a year of caching", () => {
  assert.ok(statSync(FONT_FILE).size > 5_000_000);
  assert.match(read("public/fonts/OFL.txt"), /SIL Open Font License/);
  assert.match(read("public/_headers"), /\/fonts\/\*\n  ! Cache-Control\n  ! Pragma\n  ! Expires\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.match(read("public/sw.js"), /url\.pathname\.startsWith\('\/fonts\/'\)\) return;/);
  assert.match(read("package.json"), /"@pdf-lib\/fontkit":/);
});

test("the renderer picks the font per string and the Worker e-mail path passes its loader", () => {
  const src = read("src/api/lib/unified-do-invoice-pdf.ts");
  assert.match(src, /embedFont\(bytes, \{ subset: true \}\)/);
  assert.match(src, /withEvenGlyphPadding\(/);
  assert.match(src, /opts\.loadCjkFont === undefined \? browserCjkFontLoader : opts\.loadCjkFont/);
  // Every wrapped data string can switch to the CJK font.
  assert.equal((src.match(/wrapHard\([^)]*fonts\.cjk\)/g) ?? []).length, 6);
  assert.match(src, /wrap\(fonts\.bold, v \|\| "-", maxW - labelW, 8\.5, 3, fonts\.cjk\)/);
  const helpers = read("src/api/routes/delivery-orders/_helpers.ts");
  assert.equal((helpers.match(/loadCjkFont: workerCjkFontLoader\(c\.env, safeRequestUrl\(c\)\)/g) ?? []).length, 2);
});
