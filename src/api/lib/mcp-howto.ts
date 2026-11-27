// ---------------------------------------------------------------------------
// mcp-howto.ts — AI Connector process help (owner 2026-11-27): how_to,
// module_overview, glossary, explain_error, onboarding.
//
// Pure functions over the data in ./howto/ — no external AI, simple keyword
// scoring. `canDo` comes from the person's ERP permissions through the same
// hasPermission the routes use (passed in as `can`), so a guide never tells
// someone they can do what the ERP would refuse.
//
// Links carry `?highlight=<label>` for the button to press on that step; the
// frontend highlight helper (feat/mcp-screen-guide) outlines that element.
// ---------------------------------------------------------------------------
import type { HowToFlow, HowToGuide, HowToStep } from "./howto/types";
import { GUIDES as SALES } from "./howto/guides-sales";
import { GUIDES as PROCUREMENT } from "./howto/guides-procurement";
import { GUIDES as PRODUCTION } from "./howto/guides-production";
import { GUIDES as PRODUCTS } from "./howto/guides-products";
import { GUIDES as AFTERSALES } from "./howto/guides-aftersales";
import { FLOWS, ONBOARDING } from "./howto/flows";
import { MODULES } from "./howto/modules";
import { GLOSSARY } from "./howto/glossary";
import { ERRORS } from "./howto/errors";
import { resourceForNav } from "./nav-permissions";

export const GUIDES: HowToGuide[] = [...SALES, ...PROCUREMENT, ...PRODUCTION, ...PRODUCTS, ...AFTERSALES];
export { FLOWS, ONBOARDING, MODULES, GLOSSARY, ERRORS };

export const NO_PERMISSION_NOTE = "You don't have permission for this in the ERP — ask your supervisor or admin.";
/** The note mcp_calls carries when a help tool found nothing — the admin page lists these. */
export const NO_GUIDE_NOTE = "no-guide";

/** Worker-app (PIN login) routes do not use role permissions. */
const WORKER_PERMISSION = "worker-portal:use";

export type Can = (resource: string, action: string) => Promise<boolean>;

// ── scoring ─────────────────────────────────────────────────────────────────

const STOP = new Set(["how", "to", "do", "i", "a", "an", "the", "in", "on", "of", "for", "and", "or", "is", "it", "my", "me", "we", "can", "what", "where", "when", "with", "erp", "hookka", "please", "macam", "mana", "nak", "cara", "saya", "untuk", "dan"]);

const CJK = /[㐀-鿿]/;

/** Lower-case latin word tokens (stop words dropped). */
export function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((t) => t && !STOP.has(t));
}

/** Light stemming so "receiving" / "receive" / "received" meet. */
const stem = (t: string) => t.replace(/(ing|ed|es|s)$/, "") || t;

/**
 * Score a candidate against a question. Keywords count most (whole phrase in
 * the question: latin by word, CJK by substring), then title words, then id
 * words. Returns 0 when nothing meets.
 */
export function scoreText(question: string, c: { id: string; title: string; keywords: string[] }): number {
  const q = String(question ?? "");
  const ql = q.toLowerCase();
  const qt = new Set(tokens(q).map(stem));
  let score = 0;
  for (const kw of c.keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    if (CJK.test(k)) {
      if (ql.includes(k)) score += 4 + k.length;
      continue;
    }
    const kt = tokens(k).map(stem);
    if (kt.length && kt.every((t) => qt.has(t))) score += 3 + 2 * (kt.length - 1);
  }
  for (const t of new Set(tokens(c.title).map(stem))) if (qt.has(t)) score += 1;
  for (const t of new Set(c.id.split("-").map(stem))) if (qt.has(t)) score += 1;
  return score;
}

function rank<T extends { id: string; title: string; keywords: string[] }>(question: string, items: T[]): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: scoreText(question, item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ── links ───────────────────────────────────────────────────────────────────

/** An ERP link for a page, with ?highlight= for the label to press. Pages with :params get no link (open the record first). */
export function pageLink(origin: string, page: string, highlight?: string): string | null {
  if (!page || page.includes(":")) return null;
  const [path, query] = page.split("?");
  const params = new URLSearchParams(query ?? "");
  if (highlight) params.set("highlight", highlight);
  const qs = params.toString().replace(/\+/g, "%20");
  return `${origin}${path}${qs ? `?${qs}` : ""}`;
}

// ── permissions ─────────────────────────────────────────────────────────────

async function holds(can: Can, perm: string): Promise<boolean> {
  if (perm === WORKER_PERMISSION) return true;
  const [r, a] = perm.split(":");
  return !!r && !!a && (await can(r, a));
}

/** canDo: every `permission` AND (no `permissionAny`, or at least one of it). */
export async function guideCanDo(g: Pick<HowToGuide, "permission" | "permissionAny">, can: Can): Promise<boolean> {
  for (const p of g.permission) if (!(await holds(can, p))) return false;
  if (g.permissionAny?.length) {
    for (const p of g.permissionAny) if (await holds(can, p)) return true;
    return false;
  }
  return true;
}

// ── company ─────────────────────────────────────────────────────────────────

const appliesTo = (companies: string[] | undefined, company: string) => !companies?.length || companies.includes("ALL") || companies.map((c) => c.toUpperCase()).includes(company);

/** A guide narrowed to one company: variants for other companies are dropped. No company → everything. */
function forCompany(g: HowToGuide, company: string): HowToGuide {
  if (!company) return g;
  return { ...g, variants: (g.variants ?? []).filter((v) => appliesTo(v.companies, company)) };
}

// ── how_to ──────────────────────────────────────────────────────────────────

function stepOut(s: HowToStep, g: HowToGuide, origin: string, n: number) {
  const page = s.page ?? g.page;
  const link = pageLink(origin, page, s.highlight);
  return { n, ...s, page, ...(link ? { link } : {}) };
}

async function guideOut(g: HowToGuide, origin: string, can: Can, company: string) {
  const gg = forCompany(g, company);
  const canDo = await guideCanDo(gg, can);
  return {
    id: gg.id,
    title: gg.title,
    canDo,
    ...(canDo ? {} : { note: NO_PERMISSION_NOTE }),
    erpLink: pageLink(origin, gg.page),
    sidebar: gg.sidebar,
    module: gg.module,
    purpose: gg.purpose,
    who: gg.who,
    permission: gg.permission,
    ...(gg.permissionAny?.length ? { permissionAny: gg.permissionAny } : {}),
    companies: gg.companies,
    prerequisites: gg.prerequisites,
    steps: gg.steps.map((s, i) => stepOut(s, gg, origin, i + 1)),
    checkBefore: gg.checkBefore,
    result: gg.result,
    warnings: gg.warnings,
    undo: gg.undo,
    ...(gg.approvals ? { approvals: gg.approvals } : {}),
    ...(gg.deadlines ? { deadlines: gg.deadlines } : {}),
    commonMistakes: gg.commonMistakes,
    workedExample: gg.workedExample,
    ...(gg.variants?.length ? { variants: gg.variants } : {}),
    related: gg.related,
    ...(gg.nextStep ? { nextStep: gg.nextStep } : {}),
    contact: gg.contact,
  };
}

/** A flow: each step with its guide's click-by-click steps (compact) and the person's canDo. */
async function flowOut(f: HowToFlow, origin: string, can: Can, company: string) {
  const steps = [];
  let n = 0;
  for (const s of f.steps) {
    const g = GUIDES.find((x) => x.id === s.guide);
    if (!g) continue;
    const gg = forCompany(g, company);
    const canDo = await guideCanDo(gg, can);
    n++;
    steps.push({
      n,
      guide: gg.id,
      title: gg.title,
      role: s.role,
      handoff: s.handoff,
      sidebar: gg.sidebar,
      erpLink: pageLink(origin, gg.page),
      canDo,
      ...(canDo ? {} : { note: NO_PERMISSION_NOTE }),
      clicks: gg.steps.map((x, i) => {
        const o = stepOut(x, gg, origin, i + 1);
        return { n: o.n, do: o.do, ...(o.fields ? { fields: o.fields } : {}), ...(o.check ? { check: o.check } : {}), ...(o.then ? { then: o.then } : {}), ...(o.link ? { link: o.link } : {}) };
      }),
      warnings: gg.warnings,
      result: gg.result,
    });
  }
  return { id: f.id, title: f.title, summary: f.summary, steps, tip: "Call how_to {topic: <guide id>} for any step's full SOP (prerequisites, undo, common mistakes, worked example)." };
}

const allTitles = () => ({
  guides: GUIDES.map((g) => ({ id: g.id, title: g.title, module: g.module })),
  flows: FLOWS.map((f) => ({ id: f.id, title: f.title })),
});

export type HelpAnswer = { value: Record<string, unknown>; matched: boolean };

/** how_to: top 1–3 guides (or one flow) for a question or an exact topic id. */
export async function howTo(args: { question?: unknown; topic?: unknown; company?: unknown }, origin: string, can: Can): Promise<HelpAnswer> {
  const topic = typeof args.topic === "string" ? args.topic.trim() : "";
  const question = typeof args.question === "string" ? args.question.trim().slice(0, 300) : "";
  const company = typeof args.company === "string" ? args.company.trim().toUpperCase() : "";
  const extra = { showMe: "Ask show_me for a picture of the screen with the button marked (when available).", ...(company ? { company } : {}) };
  if (topic) {
    const f = FLOWS.find((x) => x.id === topic);
    if (f) return { matched: true, value: { flow: await flowOut(f, origin, can, company), ...extra } };
    const g = GUIDES.find((x) => x.id === topic);
    if (g) return { matched: true, value: { guides: [await guideOut(g, origin, can, company)], ...extra } };
  }
  const q = question || topic;
  if (!q) return { matched: true, value: { tip: "Ask a question, e.g. 'how do I create a PO', or give a topic id.", ...allTitles() } };
  const flowHits = rank(q, FLOWS);
  const guideHits = rank(q, GUIDES);
  // A flow wins only when the question is about the whole chain and beats the best single task.
  if (flowHits.length && (!guideHits.length || flowHits[0].score > guideHits[0].score)) {
    return { matched: true, value: { flow: await flowOut(flowHits[0].item, origin, can, company), ...extra } };
  }
  if (!guideHits.length) return { matched: false, value: { noMatch: `No guide matches "${q}". These are the guides there are:`, ...allTitles() } };
  const top = guideHits[0].score;
  const picked = guideHits.filter((h) => h.score >= top / 2).slice(0, 3);
  return { matched: true, value: { guides: await Promise.all(picked.map((h) => guideOut(h.item, origin, can, company))), ...extra } };
}

// ── module_overview ─────────────────────────────────────────────────────────

export async function moduleOverview(args: { module?: unknown }, origin: string, can: Can): Promise<HelpAnswer> {
  const m = typeof args.module === "string" ? args.module.trim() : "";
  if (!m) return { matched: true, value: { modules: MODULES.map((x) => ({ id: x.id, section: x.section, oneLine: x.oneLine })), tip: "Call module_overview {module: <id or section>} for one module." } };
  const ml = m.toLowerCase();
  const hit = MODULES.find((x) => x.id === ml || x.section.toLowerCase() === ml) ?? rank(m, MODULES.map((x) => ({ ...x, title: `${x.section} ${x.oneLine}` })))[0]?.item;
  if (!hit) return { matched: false, value: { noMatch: `No module matches "${m}".`, modules: MODULES.map((x) => ({ id: x.id, section: x.section })) } };
  const pages = await Promise.all(
    hit.pages.map(async (p) => {
      const r = resourceForNav(p.path);
      const canOpen = r ? await can(r, "read") : true;
      return { name: p.name, link: pageLink(origin, p.path), canOpen };
    }),
  );
  return { matched: true, value: { id: hit.id, section: hit.section, purpose: hit.purpose, usedBy: hit.usedBy, pages, links: hit.links, guides: hit.guides.map((id) => ({ id, title: GUIDES.find((g) => g.id === id)?.title ?? id })) } };
}

// ── glossary ────────────────────────────────────────────────────────────────

export function glossary(args: { term?: unknown }, origin: string): HelpAnswer {
  const t = typeof args.term === "string" ? args.term.trim() : "";
  const out = (e: (typeof GLOSSARY)[number]) => ({ term: e.term, aliases: e.aliases, definition: e.definition, ...(e.page ? { seeIt: pageLink(origin, e.page) } : {}), ...(e.guides?.length ? { guides: e.guides } : {}) });
  if (!t) return { matched: true, value: { terms: GLOSSARY.map((e) => ({ term: e.term, definition: e.definition })) } };
  const tl = t.toLowerCase();
  const exact = GLOSSARY.filter((e) => e.term.toLowerCase() === tl || e.aliases.some((a) => a.toLowerCase() === tl));
  if (exact.length) return { matched: true, value: { terms: exact.map(out) } };
  const hits = rank(t, GLOSSARY.map((e) => ({ ...e, id: e.term.toLowerCase().replace(/\s+/g, "-"), title: `${e.term} ${e.aliases.join(" ")}`, keywords: [e.term, ...e.aliases, ...e.keywords] })));
  if (!hits.length) return { matched: false, value: { noMatch: `"${t}" is not in the glossary.`, terms: GLOSSARY.map((e) => e.term) } };
  return { matched: true, value: { terms: hits.slice(0, 3).map((h) => out(h.item)) } };
}

// ── explain_error ───────────────────────────────────────────────────────────

export function explainError(args: { text?: unknown }): HelpAnswer {
  const t = typeof args.text === "string" ? args.text.trim().slice(0, 1000) : "";
  if (!t) return { matched: false, value: { tip: "Paste the error text (or read it off the screenshot)." } };
  const tl = t.toLowerCase();
  const out = (e: (typeof ERRORS)[number]) => ({ module: e.module, message: e.match, meaning: e.meaning, cause: e.cause, fix: e.fix });
  const direct = ERRORS.filter((e) => tl.includes(e.match.toLowerCase()) || e.match.toLowerCase().includes(tl)).sort((a, b) => b.match.length - a.match.length);
  if (direct.length) return { matched: true, value: { errors: direct.slice(0, 2).map(out) } };
  const hits = rank(t, ERRORS.map((e) => ({ ...e, title: e.match, keywords: [...(e.keywords ?? [])] })));
  if (!hits.length || hits[0].score < 2) return { matched: false, value: { noMatch: "This message is not in the error list yet. Tell your supervisor or IT what you were doing when it appeared.", hint: "Check the exact wording (a screenshot helps)." } };
  return { matched: true, value: { errors: hits.slice(0, 2).map((h) => out(h.item)), note: "Closest known messages — compare the wording." } };
}

// ── onboarding ──────────────────────────────────────────────────────────────

export async function onboarding(args: { role?: unknown }, origin: string, can: Can): Promise<HelpAnswer> {
  const r = typeof args.role === "string" ? args.role.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  const key = Object.keys(ONBOARDING).find((k) => k === r || r.startsWith(k) || k.startsWith(r));
  if (!r || !key) return { matched: !r, value: { roles: Object.entries(ONBOARDING).map(([k, v]) => ({ role: k, title: v.title })), tip: "Call onboarding {role} for that role's first-week reading path." } };
  const items = await Promise.all(
    ONBOARDING[key].path.map(async (id, i) => {
      const f = FLOWS.find((x) => x.id === id);
      if (f) return { day: Math.floor(i / 2) + 1, id, kind: "flow", title: f.title };
      const g = GUIDES.find((x) => x.id === id);
      return { day: Math.floor(i / 2) + 1, id, kind: "guide", title: g?.title ?? id, link: g ? pageLink(origin, g.page) : null, canDo: g ? await guideCanDo(g, can) : false };
    }),
  );
  return { matched: true, value: { role: key, title: ONBOARDING[key].title, path: items, tip: "Open each with how_to {topic: <id>}." } };
}

// ── gap log ─────────────────────────────────────────────────────────────────

/** A question with personal data stripped (emails, phone / long numbers, document numbers), for the "no guide yet" log. */
export function scrubQuestion(q: string): string {
  return String(q ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b[A-Z]{1,5}[-/]?\d{3,}[\w/-]*\b/gi, "[doc]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
