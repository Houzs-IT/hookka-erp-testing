#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-dark-theme.mjs — writes src/styles/dark-theme.generated.css
//
// Dark mode for the whole office ERP WITHOUT touching page code (owner
// 2026-11-11). The pages colour themselves with ~20,000 hard-coded Tailwind
// arbitrary classes (`text-[#6B7280]`, `bg-white`, `border-[#E2DDD8]`, …)
// across ~270 files, and another session edits those files all day — a codemod
// would conflict with every open PR. Instead this script scans src/ for every
// colour class actually used and emits a matching override that applies ONLY
// under `html.dark` and only on screen:
//
//   .dark .text-\[\#6B7280\] { color: <dark counterpart> }
//
// • Light mode is untouched: every rule is scoped to `.dark`.
// • Print / PDF stay light: everything sits inside `@media screen`.
// • Paper pages (Board Report) opt out with `data-theme="light"` on a wrapper.
// • New pages are covered automatically: `npm run build` runs this first.
// • The rules are unlayered, so they beat Tailwind's `@layer utilities`.
//
// The dark counterpart of each hex is computed in OKLCH by ROLE — the same hex
// as a background, a text colour or a border needs a different dark value
// (#1F1D1B text must go light; #1F1D1B as a dark button can stay dark). A few
// brand colours are pinned by hand in PINNED below.
//
// Tailwind's own palette (`text-gray-500`, `bg-red-50`, …) is handled by
// re-pointing its variables under `.dark` (50↔950, 100↔900, … 500 stays).
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "src/styles/dark-theme.generated.css");

// Files whose colours are paper / PDF / server code — never themed.
const EXCLUDE = [
  /^api\//,
  /^lib\/generate-[^/]+\.ts$/,
  /^lib\/[^/]*pdf[^/]*\.ts$/,
  /^lib\/print-[^/]+\.ts$/,
  /^pages\/board-report\//,
];

// ── colour maths (sRGB ↔ OKLab ↔ OKLCH) ───────────────────────────────────
const hexToRgb = (h) => {
  let s = h.replace("#", "");
  if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s.slice(0, 6), 16);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLin = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
function rgbToOklch([r, g, b]) {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, Bb), Math.atan2(Bb, A)];
}
function oklchToHex([L, C, H]) {
  const A = C * Math.cos(H), Bb = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * Bb) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * Bb) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * Bb) ** 3;
  const r = fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Hand-picked counterparts for the brand / structural colours.
const PINNED = {
  b: { "#FFFFFF": "#1C1A18", WHITE: "#1C1A18", "#F0ECE9": "#141210", "#FAF9F7": "#1F1D1B", "#1F1D1B": "#2E2B28", "#6B5C32": "#7A6A3C" },
  t: { "#1F1D1B": "#ECE7E2", "#111827": "#ECE7E2", "#6B5C32": "#C8B37E", "#5A5550": "#B5ADA6", "#6B7280": "#A3A7AE", "#9CA3AF": "#8E939B", "#374151": "#D1D5DB" },
  l: { "#E2DDD8": "#3A3632", "#E5E0DB": "#3A3632", "#D8D2CC": "#46413C" },
};

function darkFor(kind, hex) {
  const key = hex.toUpperCase();
  if (PINNED[kind][key]) return PINNED[kind][key];
  const [r, g, b, a] = hexToRgb(key);
  const [L, C, H] = rgbToOklch([r, g, b]);
  let L2 = L, C2 = C;
  if (kind === "b") {
    if (L > 0.85) { L2 = 0.18 + (1 - L) * 1.1; C2 = C * 0.6; }          // light surfaces → dark surfaces
    else if (L < 0.3) { L2 = clamp(L + 0.08, 0.26, 0.34); }           // near-black fills → raised dark
    else { L2 = clamp(L * 0.92 + 0.02, 0.3, 0.75); C2 = C * 0.9; }      // accent fills: keep, a touch deeper
  } else if (kind === "t") {
    if (L < 0.62) { L2 = clamp(1.0 - L * 0.55, 0.62, 0.93); C2 = Math.min(C, 0.16); } // dark text → light text
    else if (L > 0.92) { L2 = L; }                                     // white-ish text on fills stays
    else { L2 = clamp(L * 0.9 + 0.08, 0.62, 0.9); }
  } else {
    if (L > 0.75) { L2 = 0.28 + (1 - L) * 0.7; C2 = C * 0.6; }         // light borders → subtle dark borders
    else { L2 = clamp(L + 0.08, 0.35, 0.7); }
  }
  const out = oklchToHex([L2, C2, H]);
  return a < 1 ? `color-mix(in oklab, ${out} ${Math.round(a * 100)}%, transparent)` : out;
}

// ── scan ──────────────────────────────────────────────────────────────────
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(n)) {
      const rel = relative(SRC, p).replace(/\\/g, "/");
      if (!EXCLUDE.some((re) => re.test(rel))) files.push(p);
    }
  }
})(SRC);

const UTIL = {
  bg: ["b", (v) => `background-color:${v}`],
  text: ["t", (v) => `color:${v}`],
  border: ["l", (v) => `border-color:${v}`],
  "border-t": ["l", (v) => `border-top-color:${v}`],
  "border-b": ["l", (v) => `border-bottom-color:${v}`],
  "border-l": ["l", (v) => `border-left-color:${v}`],
  "border-r": ["l", (v) => `border-right-color:${v}`],
  "border-x": ["l", (v) => `border-left-color:${v};border-right-color:${v}`],
  "border-y": ["l", (v) => `border-top-color:${v};border-bottom-color:${v}`],
  ring: ["l", (v) => `--tw-ring-color:${v}`],
  outline: ["l", (v) => `outline-color:${v}`],
  divide: ["l", (v) => `border-color:${v}`, "divide"],
  fill: ["t", (v) => `fill:${v}`],
  stroke: ["t", (v) => `stroke:${v}`],
  placeholder: ["t", (v) => `color:${v}`, "placeholder"],
  accent: ["l", (v) => `accent-color:${v}`],
  caret: ["t", (v) => `caret-color:${v}`],
  decoration: ["t", (v) => `text-decoration-color:${v}`],
  from: ["b", (v) => `--tw-gradient-from:${v}`],
  via: ["b", (v) => `--tw-gradient-via:${v}`],
  to: ["b", (v) => `--tw-gradient-to:${v}`],
};
const BP = { xs: "22.5rem", sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem", "2xl": "96rem" };
const PSEUDO = {
  hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", "focus-within": ":focus-within",
  active: ":active", disabled: ":disabled", enabled: ":enabled", visited: ":visited", checked: ":checked",
  first: ":first-child", last: ":last-child", odd: ":nth-child(odd)", even: ":nth-child(even)",
};
const GROUP = { "group-hover": ".group:hover ", "group-focus": ".group:focus ", "group-focus-within": ".group:focus-within " };

const TOKEN = /(?<![\w\-[\]#])((?:[a-z0-9\-[\]=_"'&.]+:)*)(!?)(bg|text|border(?:-[tblrxy])?|ring|outline|divide|fill|stroke|placeholder|accent|caret|decoration|from|via|to)-(\[#([0-9a-fA-F]{3,8})\]|white)(?:\/(\d{1,3}))?(?![\w\-[])/g;

const found = new Map(); // className -> rule
let skipped = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(TOKEN)) {
    const [cls, variantStr, bang, util, valueTok, hex, alpha] = m;
    if (valueTok === "white" && util !== "bg") continue; // text-white / border-white stay as they are
    if (valueTok === "white" && alpha && Number(alpha) < 50) continue; // translucent white highlights on dark fills stay
    const spec = UTIL[util];
    if (!spec) continue;
    const variants = variantStr ? variantStr.slice(0, -1).split(":") : [];
    let pseudo = "", group = "", media = [], ok = true, hoverMedia = false, pe = "";
    for (const v of variants) {
      if (v === "placeholder") pe = "::placeholder";
      else if (PSEUDO[v]) { pseudo += PSEUDO[v]; if (v === "hover") hoverMedia = true; }
      else if (GROUP[v]) group += GROUP[v];
      else if (BP[v]) media.push(`(width >= ${BP[v]})`);
      else if (v.startsWith("max-") && BP[v.slice(4)]) media.push(`(width < ${BP[v.slice(4)]})`);
      else if (/^aria-[a-z]+$/.test(v)) pseudo += `[${v}="true"]`;
      else if (/^data-\[[a-z-]+=[\w-]+\]$/.test(v)) { const [, k, val] = v.match(/^data-\[([a-z-]+)=([\w-]+)\]$/); pseudo += `[data-${k}="${val}"]`; }
      else if (v === "dark") { ok = false; }
      else { ok = false; }
    }
    if (!ok) { skipped++; continue; }
    if (found.has(cls)) continue;
    const kind = spec[0];
    let val = valueTok === "white" ? darkFor("b", "WHITE") : darkFor(kind, `#${hex}`);
    if (alpha) val = `color-mix(in oklab, ${val} ${alpha}%, transparent)`;
    const imp = bang ? " !important" : "";
    const decl = spec[1](val).split(";").map((d) => d + imp).join(";");
    const esc = cls.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
    let target = `.${esc}${pseudo}${pe}`;
    if (spec[2] === "divide") target = `.${esc} > :not(:last-child)`;
    if (spec[2] === "placeholder") target = `.${esc}::placeholder`;
    const sel = `.dark ${group}${target}:not(:where([data-theme="light"], [data-theme="light"] *))`;
    if (hoverMedia) media.push("(hover: hover)");
    found.set(cls, { sel, decl, media: media.join(" and ") });
  }
}

// Tailwind palette: 50↔950, 100↔900, 200↔800, 300↔700, 400↔600 under .dark.
const theme = readFileSync(join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8");
const palette = {};
for (const m of theme.matchAll(/--color-([a-z]+)-(\d{2,3}):\s*([^;]+);/g)) (palette[m[1]] ??= {})[m[2]] = m[3].trim();
const SWAP = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 };
const paletteLines = [];
for (const [name, shades] of Object.entries(palette)) {
  for (const [shade, target] of Object.entries(SWAP)) if (shades[shade] && shades[target]) paletteLines.push(`  --color-${name}-${shade}: ${shades[target]};`);
}

// ── emit ──────────────────────────────────────────────────────────────────
const byMedia = new Map();
for (const r of [...found.values()].sort((a, b) => a.sel.localeCompare(b.sel))) {
  const k = r.media || "";
  (byMedia.get(k) ?? byMedia.set(k, []).get(k)).push(`  ${r.sel} { ${r.decl}; }`);
}
let css = `/* GENERATED by scripts/gen-dark-theme.mjs — do not edit. Re-run: node scripts/gen-dark-theme.mjs
   ${found.size} colour classes from ${files.length} files (${skipped} with unsupported variants skipped). */
@media screen {
  :root.dark {
${paletteLines.map((l) => "  " + l).join("\n")}
  }
${(byMedia.get("") ?? []).join("\n")}
}
`;
for (const [media, rules] of byMedia) {
  if (!media) continue;
  css += `@media screen and ${media} {\n${rules.join("\n")}\n}\n`;
}
writeFileSync(OUT, css);
console.log(`dark theme: ${found.size} classes, ${skipped} skipped, ${files.length} files → ${relative(ROOT, OUT)}`);
