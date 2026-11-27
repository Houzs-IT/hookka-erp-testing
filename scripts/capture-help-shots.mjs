// ---------------------------------------------------------------------------
// capture-help-shots.mjs — screenshots for the AI Connector's show_me tool
// (owner 2026-11-27: "send back a picture of the real ERP screen with a red
// box around the button to press").
//
//   npm run dev                      # local Vite dev server (another terminal)
//   npm run help:shots               # this script (BASE_URL defaults to :5173)
//
// SAFETY — never production data, never credentials:
//   * Every /api/* request is answered HERE with empty demo data (no request
//     reaches the dev server's /api proxy, which points at production), and
//     every request to a host other than the dev server is aborted.
//   * Nothing is typed into a sign-in form. The page is opened as a made-up
//     demo admin ("Demo Admin", demo@example.invalid) by seeding the client's
//     own session blob; the mocked permissions answer grants every button, so
//     the screenshot shows the full layout. Names and numbers are not real.
//
// Output (both committed):
//   public/help/shots/<page>.webp            compressed screenshot, 1280×800
//   src/api/lib/howto/help-shots.ts          page, label, x/y/w/h, viewport
// tests/mcp-help-shots.test.mjs fails with "re-capture screenshots" when a
// recorded label no longer exists in src/.
//
// Env: BASE_URL, CHROME_PATH (a Chromium binary; default: newest
// ms-playwright chromium), PLAYWRIGHT_CORE (path to playwright-core if it is
// not installed in this repo).
// ---------------------------------------------------------------------------
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import sharp from "sharp";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const VIEWPORT = { width: 1280, height: 800 };
const OUT_DIR = join(ROOT, "public", "help", "shots");
const DATA_FILE = join(ROOT, "src", "api", "lib", "howto", "help-shots.ts");
const ONLY = process.argv.slice(2).filter((a) => a.startsWith("/"));

async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    const p = process.env.PLAYWRIGHT_CORE;
    if (!p) throw new Error("playwright-core not found: npm i -D playwright-core, or set PLAYWRIGHT_CORE to its folder.");
    return await import(pathToFileURL(join(p, "index.mjs")).href);
  }
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "ms-playwright");
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const slug = (p) => p.replace(/^\//, "").replace(/[/:?=&]+/g, "-").replace(/-+$/, "") || "home";

const { SCREENS } = await import(pathToFileURL(join(ROOT, "src/api/lib/mcp-screens.ts")).href);
const { GUIDES } = await import(pathToFileURL(join(ROOT, "src/api/lib/mcp-howto.ts")).href);

// Pages we can open without a record id or a worker / public token.
const SKIP = /^\/(login|forgot-password|reset-password|invite|book|track|s|d|r|p|setup-2fa)(\/|$)|^\/worker\/(?!login$)/;
const pages = new Map();
for (const s of SCREENS) {
  if (s.path.includes(":") || SKIP.test(s.path)) continue;
  if (ONLY.length && !ONLY.includes(s.path)) continue;
  pages.set(s.path, new Set(s.actions.map((a) => a.label)));
}
for (const g of GUIDES) {
  for (const st of g.steps) {
    const page = (st.page ?? g.page).split("?")[0];
    if (st.highlight && pages.has(page)) pages.get(page).add(st.highlight);
  }
}

// The same matcher the ERP's ?highlight= helper uses, bundled for the page.
const matcher = esbuild.buildSync({ entryPoints: [join(ROOT, "src/lib/highlight-match.ts")], bundle: true, format: "iife", globalName: "HKHL", write: false, platform: "browser" }).outputFiles[0].text;

const DEMO_USER = { id: "demo-admin", email: "demo@example.invalid", role: "SUPER_ADMIN", displayName: "Demo Admin" };

function mockApi(url) {
  const u = new URL(url);
  const p = u.pathname;
  if (p.startsWith("/api/auth/me/permissions")) return { success: true, role: "SUPER_ADMIN", permissions: ["*:*"], navHidden: [] };
  if (p === "/api/auth/me") return { success: true, user: DEMO_USER, data: DEMO_USER };
  return { success: true, data: [], items: [], rows: [], total: 0 };
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "en-MY", timezoneId: "Asia/Kuala_Lumpur" });
const baseHost = new URL(BASE_URL).host;
await ctx.route("**/*", (route) => {
  const url = route.request().url();
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return route.abort();
  }
  if (host !== baseHost) return route.abort(); // nothing leaves this machine
  if (new URL(url).pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockApi(url)) });
  return route.continue();
});
await ctx.addInitScript((user) => {
  try {
    localStorage.setItem("hookka_auth", JSON.stringify({ user }));
    sessionStorage.setItem("hookka_auth", JSON.stringify({ user }));
  } catch {
    /* storage blocked */
  }
}, DEMO_USER);

if (!ONLY.length && existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
const shots = [];
let n = 0;
// One tab, client-side navigation (pushState + popstate, the way React Router
// moves between pages): a full reload per page re-transforms hundreds of dev
// modules and takes ~40 s; a route change takes a second or two.
const page = await ctx.newPage();
await page.goto(`${BASE_URL}/dashboard-experimental`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.addScriptTag({ content: matcher });
for (const [path, labels] of pages) {
  n++;
  try {
    await page.evaluate((p) => {
      window.history.pushState({}, "", p);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }, path);
    await page.waitForTimeout(700);
    // Wait for the lazy page chunk and its (mocked) data: no loading skeletons left, max 8 s.
    await page
      .waitForFunction(() => {
        const root = document.querySelector("main") ?? document.body;
        return root.innerText.trim().length > 40 && !root.querySelector(".animate-pulse");
      }, null, { timeout: 8_000, polling: 250 })
      .catch(() => {});
    await page.waitForTimeout(500);
    if (new URL(page.url()).pathname !== path) {
      console.log(`skip ${path}: redirected to ${new URL(page.url()).pathname}`);
      continue;
    }
    if (!(await page.evaluate(() => Boolean(globalThis.HKHL)))) await page.addScriptTag({ content: matcher });
    const boxes = await page.evaluate((list) => {
      const out = [];
      for (const label of list) {
        // The page's own content first (not the sidebar link with the same name).
        const main = document.querySelector("main");
        const el = (main && globalThis.HKHL.findHighlightElement(main, label)) || globalThis.HKHL.findHighlightElement(document, label);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        const x = Math.max(0, Math.round(r.left));
        const y = Math.max(0, Math.round(r.top));
        out.push({ label, x, y, w: Math.round(Math.min(r.right, innerWidth) - x), h: Math.round(Math.min(r.bottom, innerHeight) - y) });
      }
      return out;
    }, [...labels]);
    if (!boxes.length) {
      console.log(`skip ${path}: no labelled element on screen`);
      continue;
    }
    const png = await page.screenshot({ type: "png" });
    const file = `${slug(path)}.webp`;
    await sharp(png).webp({ quality: 50, effort: 6 }).toFile(join(OUT_DIR, file));
    shots.push({ page: path, file: `/help/shots/${file}`, boxes });
    console.log(`${n}/${pages.size} ${path}: ${boxes.length} boxes`);
  } catch (e) {
    console.log(`skip ${path}: ${String(e?.message ?? e).split(String.fromCharCode(10))[0]}`);
  }
}
await browser.close();

const bytes = readdirSync(OUT_DIR).reduce((t, f) => t + statSync(join(OUT_DIR, f)).size, 0);
const header = `// GENERATED by scripts/capture-help-shots.mjs — do not edit. Re-capture: npm run help:shots (with npm run dev running).
// Screenshots use mocked demo data (no production data, no sign-in); names and numbers differ from the real ERP, the layout is the same.
`;
writeFileSync(
  DATA_FILE,
  `${header}export type HelpShotBox = { label: string; x: number; y: number; w: number; h: number };
export type HelpShot = { page: string; file: string; boxes: HelpShotBox[] };
export const HELP_SHOTS_VIEWPORT = ${JSON.stringify(VIEWPORT)};
export const HELP_SHOTS_CAPTURED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};
export const HELP_SHOTS: HelpShot[] = ${JSON.stringify(shots, null, 1)};
`,
);
console.log(`\n${shots.length} screenshots, ${shots.reduce((t, s) => t + s.boxes.length, 0)} boxes, ${(bytes / 1024 / 1024).toFixed(2)} MB in public/help/shots`);
