// ---------------------------------------------------------------------------
// mcp-screens.ts — AI Connector screen help (owner 2026-11-27):
//   explain_screen {path?, visible_text?}  which page this is (from a URL, or
//                                          from labels read off a screenshot)
//                                          and what every button does, with
//                                          canDo per action;
//   where_is {thing}                       "where do I open X" → sidebar path
//                                          + link (?highlight= the button).
// Data: ./howto/screens-*.ts (every router page). Pure; `can` is the ERP's
// hasPermission, so canDo matches what the server would allow.
// ---------------------------------------------------------------------------
import type { ScreenEntry } from "./howto/screen-types";
import { SCREENS as SALES } from "./howto/screens-sales";
import { SCREENS as PROCUREMENT } from "./howto/screens-procurement";
import { SCREENS as PRODUCTION } from "./howto/screens-production";
import { SCREENS as PRODUCTS } from "./howto/screens-products";
import { SCREENS as OVERVIEW } from "./howto/screens-overview";
import { GLOSSARY, GUIDES, normaliseLabelText, pageLink, scoreText, type Can, type HelpAnswer } from "./mcp-howto";
import { resourceForNav } from "./nav-permissions";

export const SCREENS: ScreenEntry[] = [...SALES, ...PROCUREMENT, ...PRODUCTION, ...PRODUCTS, ...OVERVIEW];

const SHOW_ME_TIP = "show_me {path, label} gives a screenshot of this page with the button boxed in red.";

const norm = (p: string) => p.replace(/\/+$/, "") || "/";

/** The screen for a URL or path (origin, query and hash ignored; ":id" segments match anything). */
export function screenForPath(raw: string): { screen: ScreenEntry; path: string; tab: string } | null {
  let p = String(raw ?? "").trim();
  if (!p) return null;
  let tab = "";
  try {
    const u = new URL(p, "https://x.invalid");
    p = u.pathname;
    tab = u.searchParams.get("tab") ?? "";
  } catch {
    return null;
  }
  const segs = norm(p).split("/");
  let best: ScreenEntry | null = null;
  let bestStatic = -1;
  for (const s of SCREENS) {
    const ps = norm(s.path).split("/");
    if (ps.length !== segs.length) continue;
    let ok = true;
    let statics = 0;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(":")) continue;
      if (ps[i] !== segs[i]) {
        ok = false;
        break;
      }
      statics++;
    }
    // The most specific pattern wins (/procurement/grn over /procurement/:id).
    if (ok && statics > bestStatic) {
      best = s;
      bestStatic = statics;
    }
  }
  return best ? { screen: best, path: norm(p), tab } : null;
}

/** Score screens by how many of the labels read off a screenshot they carry. */
export function screensForLabels(visible: string[]): { screen: ScreenEntry; score: number }[] {
  const seen = new Set(visible.map(normaliseLabelText).filter((x) => x.length >= 2));
  if (!seen.size) return [];
  return SCREENS.map((s) => {
    const labels = new Set([s.title, ...s.sections, ...s.actions.map((a) => a.label)].map(normaliseLabelText));
    let score = 0;
    for (const l of labels) if (seen.has(l)) score += l.length > 12 ? 3 : 2; // longer labels are more telling
    if (seen.has(normaliseLabelText(s.title))) score += 3;
    return { screen: s, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function screenOut(s: ScreenEntry, path: string, origin: string, can: Can, tab = "") {
  const base = path.includes(":") ? s.path : path;
  const pagePath = tab ? `${base}?tab=${tab}` : base;
  const r = resourceForNav(base);
  const canOpen = r ? await can(r, "read") : true;
  const actions = await Promise.all(
    s.actions.map(async (a) => {
      const [res, act] = (a.permission ?? "").split(":");
      const canDo = a.permission ? canOpen && (await can(res, act)) : canOpen;
      const link = pageLink(origin, pagePath, a.label);
      return { label: a.label, kind: a.kind, does: a.does, ...(a.sideEffects ? { sideEffects: a.sideEffects } : {}), ...(a.permission ? { permission: a.permission } : {}), canDo, ...(link ? { link } : {}) };
    }),
  );
  return {
    path: s.path,
    title: s.title,
    purpose: s.purpose,
    sidebar: s.sidebar,
    erpLink: pageLink(origin, pagePath),
    canOpen,
    ...(canOpen ? {} : { note: "You can't open this page with your ERP permissions — ask your supervisor or admin." }),
    sections: s.sections,
    actions,
    detail: s.detail,
  };
}

/** explain_screen: from a path / URL, or from labels read off a screenshot. */
export async function explainScreen(args: { path?: unknown; visible_text?: unknown; company?: unknown }, origin: string, can: Can): Promise<HelpAnswer> {
  const path = typeof args.path === "string" ? args.path : "";
  const visible = Array.isArray(args.visible_text) ? args.visible_text.filter((x): x is string => typeof x === "string").slice(0, 80) : [];
  const company = typeof args.company === "string" && args.company.trim() ? { company: args.company.trim().toUpperCase() } : {};
  if (path) {
    const hit = screenForPath(path);
    if (hit) return { matched: true, value: { identifiedBy: "path", screen: await screenOut(hit.screen, hit.path, origin, can, hit.tab), showMe: SHOW_ME_TIP, ...company } };
  }
  const ranked = screensForLabels(visible);
  if (ranked.length) {
    const top = ranked[0];
    const close = ranked.slice(1, 3).filter((x) => x.score >= top.score * 0.8);
    return {
      matched: true,
      value: {
        identifiedBy: "visible labels",
        confidence: close.length ? "low — compare the alternatives" : top.score >= 6 ? "high" : "medium",
        screen: await screenOut(top.screen, top.screen.path, origin, can),
        ...(close.length ? { alternatives: close.map((x) => ({ path: x.screen.path, title: x.screen.title })) } : {}),
        showMe: SHOW_ME_TIP,
        ...company,
      },
    };
  }
  return { matched: false, value: { noMatch: "I could not tell which ERP page this is. Read the address bar (the part after the domain) or more of the button / tab labels and try again.", ...company } };
}

const GENERIC = new Set(["open", "edit", "save", "cancel", "close", "delete", "print", "search", "filter", "export", "import", "view", "back", "next", "submit", "confirm", "refresh", "reset", "apply", "clear", "maintenance", "sales", "details"]);
const CREATE_INTENT = /\b(open|create|new|add|raise|make)\b|开|新建|新增|buat|baru/i;
const escapeRe =(x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "open an SO" → "open an SO Sales Order": glossary abbreviations get their long name added. */
export function expandAbbreviations(q: string): string {
  const extra: string[] = [];
  for (const w of q.split(/[^A-Za-z&]+/)) {
    if (w.length < 2 || w.length > 4 || w !== w.toUpperCase()) continue;
    const e = GLOSSARY.find((g) => g.term === w);
    if (e?.aliases[0]) extra.push(e.aliases[0]);
  }
  return extra.length ? `${q} ${extra.join(" ")}` : q;
}

/** where_is: "where do I open X" — screens and task guides, best first, with the sidebar path and a link. */
export async function whereIs(args: { thing?: unknown; company?: unknown }, origin: string, can: Can): Promise<HelpAnswer> {
  const thing = typeof args.thing === "string" ? args.thing.trim().slice(0, 200) : "";
  if (!thing) return { matched: false, value: { tip: "Say what you are looking for, e.g. 'maintenance log' or 'credit note'." } };
  const q = expandAbbreviations(thing);
  const tl = normaliseLabelText(q);
  const scored = SCREENS.map((s) => {
    // A button named in the question ("credit note" → "New Credit Note"); generic one-word labels (Open, Edit, Save…) never count.
    const named = s.actions.find((a) => {
      const l = normaliseLabelText(a.label);
      if (l.length < 3 || GENERIC.has(l)) return false;
      return new RegExp(`(^|\\W)${escapeRe(l)}(\\W|$)`).test(tl) || (tl.length >= 5 && l.includes(tl));
    });
    // "open / create / new / add an X" with no button named → the page's own create button.
    const action = named ?? (CREATE_INTENT.test(q) ? s.actions.find((a) => a.kind === "button" && /^\+?\s*(new|create|add)\b/i.test(a.label)) : undefined);
    const score =
      scoreText(q, { id: s.path.replace(/[/:]+/g, "-"), title: `${s.title} ${s.sections.join(" ")}`, keywords: [...(s.keywords ?? []), s.title] }) +
      (action ? 3 : 0) +
      (s.detail === "full" ? 0.5 : 0) +
      (s.path.includes(":") ? -3 : 0);
    return { s, score, action };
  })
    .filter((x) => x.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const guides = GUIDES.map((g) => ({ g, score: scoreText(thing, g) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (!scored.length && !guides.length) return { matched: false, value: { noMatch: `I could not find "${thing}" in the ERP map.`, tip: "Try another word, or module_overview for the list of modules." } };
  const places = await Promise.all(
    scored.map(async ({ s, action }) => {
      const r = resourceForNav(s.path);
      const canOpen = r ? await can(r, "read") : true;
      return {
        title: s.title,
        sidebar: s.sidebar,
        link: pageLink(origin, s.path, action?.label),
        ...(action ? { press: action.label, does: action.does } : {}),
        purpose: s.purpose,
        canOpen,
        ...(canOpen ? {} : { note: "You don't have permission for this in the ERP — ask your supervisor or admin." }),
      };
    }),
  );
  return {
    matched: true,
    value: {
      places,
      ...(guides.length ? { guides: guides.map((x) => ({ id: x.g.id, title: x.g.title, tip: "how_to {topic} for the steps" })) } : {}),
      showMe: SHOW_ME_TIP,
    },
  };
}
