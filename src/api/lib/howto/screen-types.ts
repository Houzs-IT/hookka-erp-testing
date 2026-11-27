// ---------------------------------------------------------------------------
// howto/screen-types.ts — the screen map (owner 2026-11-27): every page in the
// router with its purpose, sections / tabs and every button / menu / action,
// so Claude can explain any screen — from a URL or from labels read off a
// screenshot — and answer "where do I open X". Written by reading the page
// code; tests/mcp-screen-map.test.mjs checks every path against the router
// and every label against src/.
// ---------------------------------------------------------------------------

export type ScreenAction = {
  /** The exact label on screen (must appear verbatim in src/). */
  label: string;
  kind: "button" | "tab" | "menu" | "row-action" | "link" | "toggle" | "filter";
  /** What it does — read from the handler. */
  does: string;
  /** "resource:action" the server checks (or the page hides it without). Omit for read-only / client-only actions. */
  permission?: string;
  /** Locks a document, moves stock or money, sends an email, cannot be undone… */
  sideEffects?: string;
};

export type ScreenEntry = {
  /** Router path, exactly as in src/dashboard-routes.tsx / router.tsx / the /m shell (":id" kept). */
  path: string;
  title: string;
  purpose: string;
  /** How to reach it from the sidebar, e.g. "PROCUREMENT → Purchase Order"; or how to reach it when it is not in the sidebar. */
  sidebar: string;
  /** Section headings / tab labels on the page (exact labels). */
  sections: string[];
  actions: ScreenAction[];
  /** "full" = every button documented; "basic" = purpose + main buttons. */
  detail: "full" | "basic";
  /** Extra words people use for this page (English / Chinese / Malay) for where_is. */
  keywords?: string[];
};
