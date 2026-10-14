#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-finance-theme.mjs — the finance palette (owner 2026-10-14 「整体 finance
// 的颜色太暗了…参考这两个，不会太暗也不会太亮」→ palette E: navy + teal +
// gold, chosen from two references).
//
// The finance pages are written with the app's warm brown / beige utility
// colours (`text-[#6B5C32]`, `bg-[#F0ECE9]` …), as are the shared components
// they use. Rather than rewrite every class, this script finds every Tailwind
// class in src/ that names one of the old colours and writes a rule giving it
// the new colour — only inside a finance page ([data-fin-ui]).
//
// The rules sit in the `utilities` cascade layer and start with
// `:where([data-fin-ui])` (no extra specificity), so a recoloured base class
// still loses to a state variant the way Tailwind's own classes do
// (`hover:text-white` keeps working), and a recoloured variant wins over the
// original variant because it comes later. Display only.
//
// Usage: node scripts/gen-finance-theme.mjs           # writes the CSS
//        node scripts/gen-finance-theme.mjs --check   # fails if it is stale
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const OUT = join(ROOT, "src/pages/accounting/finance-theme.css");

// Old colour → palette E. Neutrals go from warm beige to cool grey; the brand
// brown becomes navy; green becomes teal; brick red becomes coral red; the
// ambers become the gold; the old teal / blue / plum settle into the blues.
export const PALETTE = {
  // text and dark bands
  "1F1D1B": "1F2A44", "2A2725": "263450", "1F2937": "1F2A44", "374151": "344054",
  "4B5563": "475467", "5A5550": "475467", "6B7280": "5F6B7A", "8A7F73": "7A8594",
  "9CA3AF": "98A2B3", "B4B2A9": "A3ACB9", "C4BDB5": "B8C0CC",
  // borders and surfaces
  "C7C1BA": "C2C9D3", "C9C2BA": "C2C9D3", "C9C2B9": "C2C9D3", "D5D0CB": "D3D9E1", "D1D5DB": "D3D9E1",
  "D8D2CC": "D9DEE5", "E0DCD7": "DDE2E8", "E2DDD8": "E3E7ED", "E6E0D9": "E3E7ED", "F0ECE9": "EEF1F5",
  "F3F0EC": "F2F4F7", "F5F3F0": "F4F6F8", "F7F4EF": "F2F4F7", "F7F4F0": "F4F6F8", "F7F4F1": "F4F6F8",
  "F7F5F2": "F5F6F8", "FAF8F4": "F7F8FA", "FAF8F5": "F7F8FA", "FAF8F6": "F7F8FA", "FAF9F7": "F8F9FB",
  "FAFAF8": "F9FAFB", "FBFAF8": "F9FAFB", "FBF9F8": "F9FAFB", "F4EFE6": "F4F6F9", "F6F1E7": "EEF2F8",
  // brand: brown → navy, its light gold → gold
  "6B5C32": "1F3B63", "4D4224": "16304F", "8B7A4E": "3A5A86", "C9B98F": "D9BE85", "C9A227": "C9A15E",
  // green → teal
  "4F7C3A": "1F7A6E", "27500A": "155E56", "3B6D11": "1F7A6E", "639922": "2A9D8F",
  "EAF3DE": "E4F4F1", "EEF3E4": "EAF6F3", "C0DD97": "A8DCD3", "C6DBA8": "B5E0D8",
  // brick red → coral red
  "9A3A2D": "C2413D", "9A3412": "C2413D", "791F1F": "9B2C2C", "7A2E24": "9B2C2C", "A32D2D": "B23B39",
  "F7E5E1": "FBEAE9", "F9E1DA": "FBEAE9", "FCEBEB": "FCEDEC", "F3E8E5": "FBEAE9", "FBEFEC": "FCEDEC",
  "F7C1C1": "F1C4C2", "E8B2A1": "F1C4C2", "D9A79C": "EBB3B0", "E8D5CE": "F3D3D1",
  // amber → gold
  "9C6F1E": "9A7124", "7A5B12": "8A6420", "7A5712": "8A6420", "B8601A": "B26B1F",
  "FBF3E4": "F8F1E1", "FAEFCB": "FAF0D7", "FAEEDA": "F8F1E1", "FBEED9": "F8F1E1",
  "E0C989": "E5CF9E", "E8D597": "E5CF9E", "FAC775": "E5C47E",
  // old teal / blue / plum → the blues
  "3E6570": "23607A", "E0EDF0": "E6F0F4", "E8F1F3": "E6F0F4", "A8CAD2": "A9C8D6",
  "2C4170": "1F3B63", "EEF2FB": "E8EEF7", "E6F1FB": "E8EEF7",
  "6B4A6D": "3D5A80", "F1E6F0": "EAF0F7", "D1B7D0": "BCCDE0",
  // the warm one-offs
  "D8D2CB": "D9DEE5", "E8E0CC": "E9EDF2", "F5F2ED": "F5F6F8", "D4C69E": "E5CF9E", "F0EAD8": "F8F1E1",
  "E8E4DF": "E5E9EE", "D0CCC7": "D3D9E1", "DDD8D2": "DDE2E8", "4A4540": "475467", "D1CBC5": "D3D9E1",
  "8C5A42": "B2533F", "F2E4DB": "FBEAE9", "D7B8A4": "EBB3B0", "3A5C29": "155E56", "3D6329": "1F7A6E",
  "B7D9A8": "A8DCD3", "FBE4CE": "F8F1E1", "E8B786": "E5C47E", "633806": "6E4F15", "2E4D57": "1F4E63",
  "3B5670": "2D4F78",
};

// Utility prefix → the property it sets.
const PROPS = {
  text: "color",
  bg: "background-color",
  border: "border-color",
  "border-t": "border-top-color",
  "border-b": "border-bottom-color",
  "border-l": "border-left-color",
  "border-r": "border-right-color",
  "border-x": "border-inline-color",
  "border-y": "border-block-color",
  ring: "--tw-ring-color",
  "ring-offset": "--tw-ring-offset-color",
  outline: "outline-color",
  fill: "fill",
  stroke: "stroke",
  accent: "accent-color",
  decoration: "text-decoration-color",
  caret: "caret-color",
  divide: "border-color",
};
// Variant → how its selector is written (Tailwind v4's own forms).
const VARIANTS = {
  hover: (sel) => `${sel}:hover`,
  focus: (sel) => `${sel}:focus`,
  "focus-visible": (sel) => `${sel}:focus-visible`,
  "focus-within": (sel) => `${sel}:focus-within`,
  active: (sel) => `${sel}:active`,
  disabled: (sel) => `${sel}:disabled`,
  "group-hover": (sel) => `${sel}:is(:where(.group):hover *)`,
  placeholder: (sel) => `${sel}::placeholder`,
  odd: (sel) => `${sel}:nth-child(odd)`,
  even: (sel) => `${sel}:nth-child(even)`,
  first: (sel) => `${sel}:first-child`,
  last: (sel) => `${sel}:last-child`,
  enabled: (sel) => `${sel}:enabled`,
};
// Breakpoint variants → the media query their rule sits in (Tailwind v4's).
const MEDIA = {
  sm: "(width >= 40rem)", md: "(width >= 48rem)", lg: "(width >= 64rem)", xl: "(width >= 80rem)",
  "max-sm": "(width < 40rem)", "max-md": "(width < 48rem)", "max-lg": "(width < 64rem)",
};

const TOKEN = /(?<![\w-])((?:[a-z-]+:)*)(text|bg|border(?:-[tblrxy])?|ring(?:-offset)?|outline|fill|stroke|accent|decoration|caret|divide)-\[#([0-9A-Fa-f]{6})\](?:\/(\d{1,3}))?(?![\w-])/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const esc = (cls) => cls.replace(/([:\[\]#/.%])/g, "\\$1");

// What can render inside a finance page: the finance pages themselves, the
// shared components and the class helpers in src/lib (design tokens …). Other
// modules' pages never sit inside [data-fin-ui], so a class added there does
// not make this layer stale.
const SOURCES = [
  "src/pages/accounting",
  "src/pages/invoices/credit-notes.tsx",
  "src/pages/invoices/debit-notes.tsx",
  "src/pages/invoices/e-invoice.tsx",
  "src/components",
  "src/lib",
];

export function buildTheme() {
  const tokens = new Map(); // class → { variants, prefix, hex, alpha }
  const skipped = new Set();
  const files = SOURCES.flatMap((p) => {
    const abs = join(ROOT, p);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(TOKEN)) {
      const [cls, variantPart, prefix, hexRaw, alpha] = m;
      const hex = hexRaw.toUpperCase();
      if (!PALETTE[hex]) continue;
      const variants = variantPart ? variantPart.slice(0, -1).split(":") : [];
      if (variants.some((v) => !VARIANTS[v] && !MEDIA[v])) { skipped.add(cls); continue; }
      tokens.set(cls, { variants, prefix, hex, alpha: alpha ? Number(alpha) : null });
    }
  }
  const lines = [];
  for (const [cls, t] of [...tokens].sort((a, b) => a[0].localeCompare(b[0]))) {
    const next = `#${PALETTE[t.hex]}`;
    const value = t.alpha === null ? next : `color-mix(in oklab, ${next} ${t.alpha}%, transparent)`;
    let sel = `.${esc(cls)}`;
    const media = t.variants.filter((v) => MEDIA[v]).map((v) => MEDIA[v]);
    for (const v of t.variants) if (VARIANTS[v]) sel = VARIANTS[v](sel);
    const prop = PROPS[t.prefix];
    const target = t.prefix === "divide" ? `:where([data-fin-ui]) ${sel} > :not(:last-child)` : `:where([data-fin-ui]) ${sel}`;
    const rule = `${target} { ${prop}: ${value}; }`;
    lines.push(media.length ? `  @media ${media.join(" and ")} { ${rule} }` : `  ${rule}`);
  }
  const css = [
    "/* GENERATED by scripts/gen-finance-theme.mjs — do not edit by hand; change",
    "   the PALETTE there and re-run it. The finance palette (owner 2026-10-14,",
    "   palette E: navy + teal + gold): every utility class in src/ that names an",
    "   old colour, recoloured inside a finance page only. */",
    "@layer utilities {",
    ...lines,
    "}",
    "",
  ].join("\n");
  return { css, count: lines.length, skipped: [...skipped].sort() };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1]?.endsWith("gen-finance-theme.mjs")) {
  const { css, count, skipped } = buildTheme();
  if (process.argv.includes("--check")) {
    const cur = (() => { try { return readFileSync(OUT, "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } })();
    if (cur !== css) {
      console.error(`${relative(ROOT, OUT)} is stale — run: node scripts/gen-finance-theme.mjs`);
      process.exit(1);
    }
    console.log(`${relative(ROOT, OUT)} is up to date (${count} rules).`);
  } else {
    writeFileSync(OUT, css);
    console.log(`Wrote ${relative(ROOT, OUT)} — ${count} rules.${skipped.length ? ` Left alone (unsupported variants): ${skipped.join(" ")}` : ""}`);
  }
}
