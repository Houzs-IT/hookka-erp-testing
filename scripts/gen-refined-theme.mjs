#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-refined-theme.mjs — writes src/styles/refined-theme.generated.css
//
// The refined look (owner 2026-11-12: "比 Houzs ERP 更好看", palette "B-lite",
// design canvas https://claude.ai/artifact/Roh88iBS5bxpxjVQEkpYvq) WITHOUT
// touching page code. Same technique as dark mode (scripts/gen-dark-theme.mjs):
// pages colour themselves with ~19,000 hard-coded Tailwind arbitrary classes
// (`text-[#6B7280]`, `bg-[#F0ECE9]`, …) and other sessions edit those files all
// day, so a codemod would conflict with every open PR. This script scans src/
// for every colour class in use and SNAPS each hex to the nearest token of the
// refined palette (src/styles/refined-tokens.css), by role:
//
//   html.refined:not(.dark) .text-\[\#6B7280\] { color: var(--hk-ink-muted) }
//
// • Opt-in: only under `html.refined` (Topbar › Look › Refined). Classic is
//   untouched; dark mode keeps its own layer (refined rules skip `.dark`).
// • Screen only — print / PDF stay as they are.
// • Paper pages opt out with data-theme="light" wrappers, like dark mode — but
//   NOT the phone app, whose <body data-theme="light"> is the shell, not paper.
// • 920 distinct colours collapse onto ~41 (+6 B-lite tints) → one palette.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "src/styles/refined-theme.generated.css");

const EXCLUDE = [
  /^api\//,
  /^lib\/generate-[^/]+\.ts$/,
  /^lib\/[^/]*pdf[^/]*\.ts$/,
  /^lib\/print-[^/]+\.ts$/,
  /^pages\/board-report\//,
];

// ── refined palette by role (values mirror src/styles/refined-tokens.css) ──
const T = {
  bg: "#F3EFE8", surface: "#FDFBF7", "surface-2": "#F8F5EF", "surface-dim": "#ECE6DC",
  border: "#E4DDD1", "border-subtle": "#EDE8DF", "border-strong": "#D3CABB",
  ink: "#24201B", "ink-2": "#4F483F", "ink-muted": "#6B6358", "ink-faint": "#938A7D",
  primary: "#6B5C32", "primary-hover": "#54482A", "primary-soft": "#F2EAD3", "primary-ink": "#3E3520",
  gold: "#C0A35A", focus: "#A88B43",
  success: "#3D6030", "success-fill": "#E9F0DF", "success-line": "#6A9A4E",
  warning: "#7A5718", "warning-fill": "#FAF0D2", "warning-line": "#C18F2C",
  danger: "#9A3A2D", "danger-fill": "#FBEDE8", "danger-line": "#C0533F",
  info: "#31505A", "info-fill": "#E3EEF0", "info-line": "#4D828E",
  "sage-100": "#E4EBE0", "sage-600": "#5A7353",
  "slate-100": "#E1E8EF", "slate-600": "#51677D",
  "clay-100": "#F5E3DA", "clay-600": "#985A40",
  "chart-1": "#8A7238", "chart-2": "#4D828E", "chart-3": "#8C6A8E",
  "chart-4": "#6F8F4E", "chart-5": "#C2A36B", "chart-6": "#8F877B",
};
const ROLE = {
  // backgrounds: surfaces, soft fills, solid fills (buttons, dark bars)
  b: ["bg", "surface", "surface-2", "surface-dim", "border", "border-strong", "primary", "primary-hover", "primary-soft",
      "success", "success-fill", "warning", "warning-fill", "danger", "danger-fill", "info", "info-fill", "ink", "ink-2",
      "sage-100", "slate-100", "clay-100", "sage-600", "slate-600", "clay-600", "gold"],
  // text / icons
  t: ["ink", "ink-2", "ink-muted", "ink-faint", "primary", "primary-ink", "gold", "success", "warning", "danger", "info",
      "sage-600", "slate-600", "clay-600", "border-strong", "surface"],
  // chart marks (SVG fill / stroke / stop-color written by recharts from JS
  // constants): the chart set, the B-lite series shades, status lines, neutrals
  c: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "slate-600", "sage-600", "clay-600",
      "primary", "gold", "success-line", "warning-line", "danger-line", "info-line", "danger",
      "ink", "ink-2", "ink-muted", "ink-faint", "border", "border-strong", "surface", "surface-2", "primary-soft"],
  // lines
  l: ["border", "border-subtle", "border-strong", "ink-faint", "primary", "focus", "success-line", "warning-line",
      "danger-line", "info-line", "ink"],
};

// ── colour maths (sRGB ↔ OKLab) ───────────────────────────────────────────
const hexToRgb = (h) => {
  let s = h.replace("#", "");
  if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s.slice(0, 6), 16);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab([r, g, b]) {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const LAB = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, oklab(hexToRgb(v))]));

/** Nearest token for this hex in this role. Chroma weighs extra so a coloured
 *  chip never snaps to a grey, and a grey never picks up a tint. */
export function snap(kind, hex) {
  const [r, g, b] = hexToRgb(hex);
  const [L, A, B] = oklab([r, g, b]);
  const C = Math.hypot(A, B);
  let best = null;
  let bestD = Infinity;
  for (const name of ROLE[kind]) {
    const [L2, A2, B2] = LAB[name];
    const C2 = Math.hypot(A2, B2);
    // Chart marks: a coloured series stays a coloured series (never a grey),
    // and hue outweighs lightness — a navy line wants slate, a teal bar teal.
    if (kind === "c" && C > 0.04 && C2 < 0.03) continue;
    const wL = kind === "c" ? 0.35 : 1;
    const d = wL * (L - L2) ** 2 + (A - A2) ** 2 + (B - B2) ** 2 + 2 * (C - C2) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

// Hand-pinned: Hookka's structural colours and their refined roles.
const PINNED = {
  b: { "#FFFFFF": "surface", WHITE: "surface", "#F0ECE9": "bg", "#FAF9F7": "surface-2", "#FAF8F4": "surface-2",
       "#1F1D1B": "ink", "#6B5C32": "primary", "#E2DDD8": "border" },
  t: { "#1F1D1B": "ink", "#111827": "ink", "#374151": "ink-2", "#4B5563": "ink-2", "#5A5550": "ink-2",
       "#6B7280": "ink-muted", "#8A8680": "ink-faint", "#8A8580": "ink-faint", "#9CA3AF": "ink-faint",
       "#6B5C32": "primary", "#9A3A2D": "danger", "#DC2626": "danger", "#7A2E24": "danger",
       "#4F7C3A": "success", "#16A34A": "success", "#9C6F1E": "warning", "#D97706": "warning", "#3E6570": "info" },
  l: { "#E2DDD8": "border", "#E5E0DB": "border", "#D8D2CC": "border-strong", "#D1D5DB": "border-strong",
       "#E5E7EB": "border", "#6B5C32": "primary" },
};
function tokenFor(kind, hex) {
  const key = hex.toUpperCase();
  const [, , , a] = hexToRgb(key);
  const name = PINNED[kind][key] ?? snap(kind, key);
  const v = `var(--hk-${name})`;
  return a < 1 ? `color-mix(in oklab, ${v} ${Math.round(a * 100)}%, transparent)` : v;
}

// ── scan (same class grammar as gen-dark-theme.mjs) ───────────────────────
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

const found = new Map();
let skipped = 0;
const snapStats = new Map(); // "#HEX" -> token, for the report line
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(TOKEN)) {
    const [cls, variantStr, bang, util, valueTok, hex, alpha] = m;
    if (valueTok === "white" && util !== "bg") continue;
    if (valueTok === "white" && alpha && Number(alpha) < 50) continue;
    const spec = UTIL[util];
    if (!spec) continue;
    // White-ish text on dark/coloured fills stays white.
    if (spec[0] === "t" && hex && oklab(hexToRgb(hex))[0] > 0.95) continue;
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
      else ok = false;
    }
    if (!ok) { skipped++; continue; }
    if (found.has(cls)) continue;
    const kind = spec[0];
    let val = valueTok === "white" ? tokenFor("b", "WHITE") : tokenFor(kind, `#${hex}`);
    if (hex) snapStats.set(`${kind}#${hex.toUpperCase()}`, val);
    if (alpha) val = `color-mix(in oklab, ${val} ${alpha}%, transparent)`;
    const imp = bang ? " !important" : "";
    const decl = spec[1](val).split(";").map((d) => d + imp).join(";");
    const esc = cls.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
    let target = `.${esc}${pseudo}${pe}`;
    if (spec[2] === "divide") target = `.${esc} > :not(:last-child)`;
    if (spec[2] === "placeholder") target = `.${esc}::placeholder`;
    const sel = `:root.refined:not(.dark) ${group}${target}:not(:where([data-theme="light"]:not(body) *))`;
    if (hoverMedia) media.push("(hover: hover)");
    found.set(cls, { sel, decl, media: media.join(" and ") });
  }
}

// ── chart marks: hex string literals rendered as SVG presentation attributes ──
// recharts writes `fill="#2A9D8F"` / `stroke="#1F3B63"` / `stop-color` straight
// from JS constants (owner screenshot 2026-11-12: bright teal + navy on the
// Accounting overview). CSS can override presentation attributes, so every
// hex literal in the app becomes an attribute rule scoped to <svg>, snapped
// onto the chart set. Near-white stays (labels on bars).
const HEXLIT = /["'`](#[0-9a-fA-F]{6})["'`]/g;
const chartHex = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(HEXLIT)) chartHex.add(m[1].toUpperCase());
}
const chartLines = [];
for (const hex of [...chartHex].sort()) {
  if (oklab(hexToRgb(hex))[0] > 0.97) continue;
  const v = `var(--hk-${snap("c", hex)})`;
  for (const attr of ["fill", "stroke", "stop-color"]) {
    const prop = attr === "stop-color" ? "stop-color" : attr;
    chartLines.push(`  :root.refined:not(.dark) svg [${attr}="${hex}" i]:not(:where([data-theme="light"]:not(body) *)) { ${prop}:${v}; }`);
  }
}

// Tailwind's grey families → the warm neutral ramp under .refined.
const NEUTRAL = {
  50: "#FDFBF7", 100: "#F8F5EF", 200: "#EDE8DF", 300: "#E4DDD1", 400: "#D3CABB", 500: "#938A7D",
  600: "#6B6358", 700: "#4F483F", 800: "#3A342D", 900: "#24201B", 950: "#1A1815",
};
const paletteLines = [];
for (const fam of ["gray", "slate", "zinc", "neutral", "stone"]) {
  for (const [step, hex] of Object.entries(NEUTRAL)) paletteLines.push(`    --color-${fam}-${step}: ${hex};`);
}

const byMedia = new Map();
for (const { sel, decl, media } of found.values()) {
  const k = media || "";
  if (!byMedia.has(k)) byMedia.set(k, []);
  byMedia.get(k).push(`  ${sel} { ${decl}; }`);
}
const tokens = new Set([...snapStats.values()].map((v) => v.replace(/^color-mix\(in oklab, /, "").replace(/ \d+%, transparent\)$/, "")));
let out = `/* GENERATED by scripts/gen-refined-theme.mjs — do not edit. Re-run: node scripts/gen-refined-theme.mjs
   ${found.size} colour classes from ${files.length} files (${skipped} with unsupported variants skipped);
   ${new Set([...snapStats.keys()].map((k) => k.slice(1))).size} distinct hex values → ${tokens.size} refined tokens. */
@media screen {
  :root.refined:not(.dark) {
${paletteLines.join("\n")}
  }
`;
out += `  /* chart marks: ${chartLines.length / 3} hex literals */\n` + chartLines.join("\n") + "\n";
for (const [media, rules] of byMedia) {
  if (!media) out += rules.join("\n") + "\n";
  else out += `  @media ${media} {\n${rules.map((r) => "  " + r).join("\n")}\n  }\n`;
}
out += "}\n";
writeFileSync(OUT, out);
console.log(`refined theme: ${found.size} classes → ${tokens.size} tokens (${OUT.replace(ROOT, "")})`);
