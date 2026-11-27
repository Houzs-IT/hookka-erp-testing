// Shared honesty checks for the AI Connector's help data (how-to guides,
// flows, module overview, glossary, screen map): every page path must exist in
// the router, every double-quoted UI label must appear verbatim in src/.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");

/** Help-data files themselves are excluded from the label corpus (they would match themselves). */
const EXCLUDE = [join("src", "api", "lib", "howto") + sep, join("src", "api", "lib", "mcp-howto")];

function walk(dir, out) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js|json)$/.test(f)) out.push(p);
  }
  return out;
}

let corpus = null;
export function labelCorpus() {
  if (corpus) return corpus;
  const files = walk(SRC, []).filter((p) => !EXCLUDE.some((e) => relative(ROOT, p).startsWith(e)));
  const raw = files.map((p) => readFileSync(p, "utf8")).join("\n");
  // JSX often wraps text across lines: also keep a whitespace-collapsed copy.
  corpus = { raw, flat: raw.replace(/\s+/g, " ") };
  return corpus;
}

export function labelExists(label) {
  const c = labelCorpus();
  const l = label.replace(/\s+/g, " ").trim();
  return c.raw.includes(label) || c.flat.includes(l);
}

/** Double-quoted segments in a sentence. */
export function quotedLabels(s) {
  return [...String(s ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

let routes = null;
/** Every router path: dashboard routes, standalone routes, worker routes, and the /m mobile shell. */
export function routerPaths() {
  if (routes) return routes;
  const out = new Set();
  for (const f of ["src/dashboard-routes.tsx", "src/router.tsx"]) {
    const t = readFileSync(join(ROOT, f), "utf8");
    for (const m of t.matchAll(/path:\s*'([^']+)'/g)) out.add(m[1]);
  }
  const ml = readFileSync(join(ROOT, "src/pages/m/MobileLayout.tsx"), "utf8");
  for (const m of ml.matchAll(/path="([^"]+)"/g)) if (m[1] !== "*") out.add(m[1] === "/" ? "/m" : `/m/${m[1].replace(/^\//, "")}`);
  routes = out;
  return out;
}

const norm = (p) => p.split("?")[0].replace(/:[^/]+/g, ":x").replace(/\/$/, "") || "/";

export function pathExists(p) {
  const n = norm(p);
  for (const r of routerPaths()) if (norm(r) === n) return true;
  return false;
}

/** All labels a guide claims are on screen. */
export function guideLabels(g) {
  const out = [];
  for (const s of g.steps ?? []) {
    out.push(...quotedLabels(s.do), ...quotedLabels(s.check), ...quotedLabels(s.then));
    if (s.highlight) out.push(s.highlight);
    for (const f of s.fields ?? []) out.push(f.label, ...quotedLabels(f.value));
  }
  for (const t of [...(g.checkBefore ?? []), ...(g.warnings ?? []), g.result, g.undo, g.approvals, g.deadlines]) out.push(...quotedLabels(t));
  for (const m of g.commonMistakes ?? []) out.push(...quotedLabels(m.mistake), ...quotedLabels(m.fix));
  for (const v of g.variants ?? []) for (const d of v.differences ?? []) out.push(...quotedLabels(d));
  for (const p of g.prerequisites ?? []) out.push(...quotedLabels(p));
  return out;
}

/** Problems in a list of guides: [{id, problem}]. */
export function checkGuides(guides) {
  const bad = [];
  for (const g of guides) {
    if (!pathExists(g.page)) bad.push({ id: g.id, problem: `page ${g.page} not in router` });
    for (const s of g.steps ?? []) if (s.page && !pathExists(s.page)) bad.push({ id: g.id, problem: `step page ${s.page} not in router` });
    for (const l of guideLabels(g)) if (!labelExists(l)) bad.push({ id: g.id, problem: `label "${l}" not found in src/` });
    if (!g.steps?.length) bad.push({ id: g.id, problem: "no steps" });
    for (const k of ["purpose", "who", "sidebar", "result", "undo", "workedExample", "contact"]) if (!String(g[k] ?? "").trim()) bad.push({ id: g.id, problem: `missing ${k}` });
    if (!(g.permission?.length || g.permissionAny?.length)) bad.push({ id: g.id, problem: "missing permission / permissionAny" });
    for (const k of ["prerequisites", "checkBefore", "commonMistakes", "keywords", "companies"]) if (!Array.isArray(g[k]) || !g[k].length) bad.push({ id: g.id, problem: `missing ${k}` });
    for (const s of g.steps ?? []) if (/fill in (the|all) (details|fields)|enter the details|as needed/i.test(s.do)) bad.push({ id: g.id, problem: `vague step: ${s.do}` });
  }
  return bad;
}
