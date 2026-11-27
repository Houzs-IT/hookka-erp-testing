// ---------------------------------------------------------------------------
// mcp-show-me.ts — show_me (owner 2026-11-27): a picture of the real ERP
// screen with a RED BOX around the button to press, next to the ?highlight=
// link that outlines it on the live page.
//
// Screenshots: public/help/shots/*.webp + boxes in ./howto/help-shots.ts,
// captured by scripts/capture-help-shots.mjs against the local dev server
// with mocked demo data (no production data, no sign-in). The SVG embeds the
// screenshot and draws the box, an arrow and a caption.
// ---------------------------------------------------------------------------
import { HELP_SHOTS, HELP_SHOTS_VIEWPORT, type HelpShot, type HelpShotBox } from "./howto/help-shots";
import { GUIDES, normaliseLabelText, pageLink } from "./mcp-howto";
import { screenForPath } from "./mcp-screens";

export const TEST_DATA_NOTE = "This screenshot uses test data, so names and numbers differ from yours, but the layout and the buttons are the same.";

export type ShowMePick = { shot: HelpShot; box: HelpShotBox; caption: string; pagePath: string };

const byLabel = (shot: HelpShot, label: string): HelpShotBox | undefined => {
  const l = normaliseLabelText(label);
  return shot.boxes.find((b) => normaliseLabelText(b.label) === l) ?? shot.boxes.find((b) => normaliseLabelText(b.label).startsWith(l) || l.startsWith(normaliseLabelText(b.label)));
};

/** Which screenshot and box answer {path | guide_id + step | label}. */
export function pickShot(args: { path?: unknown; guide_id?: unknown; step?: unknown; label?: unknown }): ShowMePick | { error: string } {
  const label = typeof args.label === "string" ? args.label.trim() : "";
  let page = "";
  let want = label;
  let caption = "";
  if (typeof args.guide_id === "string" && args.guide_id.trim()) {
    const g = GUIDES.find((x) => x.id === (args.guide_id as string).trim());
    if (!g) return { error: `No guide "${args.guide_id}". Use how_to to find the guide id.` };
    const n = Number(args.step ?? 0);
    const steps = g.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.highlight);
    const st = n >= 1 && n <= g.steps.length ? { s: g.steps[n - 1], i: n - 1 } : steps[0];
    if (!st) return { error: `Guide "${g.id}" has no step with a button to show.` };
    page = (st.s.page ?? g.page).split("?")[0];
    want = want || st.s.highlight || "";
    caption = `${g.title} — step ${st.i + 1}: ${st.s.do.replace(/\s+/g, " ").slice(0, 160)}`;
  }
  if (typeof args.path === "string" && args.path.trim()) {
    const hit = screenForPath(args.path);
    page = hit ? hit.screen.path : args.path.split("?")[0];
  }
  const shots = page ? HELP_SHOTS.filter((s) => s.page === page) : HELP_SHOTS;
  if (!shots.length) return { error: page ? `No screenshot of ${page} yet (it needs a record open, or it was not captured). Use the link instead.` : "No screenshots captured yet." };
  for (const shot of shots) {
    const box = want ? byLabel(shot, want) : shot.boxes[0];
    if (box) return { shot, box, caption: caption || `${shot.page}: press "${box.label}"`, pagePath: shot.page };
  }
  return { error: want ? `"${want}" is not on the captured screenshot${page ? ` of ${page}` : "s"} (it may be below the fold or need a record open). Use the link instead.` : "Nothing to point at." };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An SVG: the screenshot, a red box around the element, an arrow pointing at it and a caption bar. */
export function annotatedSvg(imageDataUri: string, box: HelpShotBox, caption: string): string {
  const { width: W, height: H } = HELP_SHOTS_VIEWPORT;
  const capH = 44;
  const pad = 6;
  const bx = Math.max(0, box.x - pad);
  const by = Math.max(0, box.y - pad);
  const bw = Math.min(W - bx, box.w + pad * 2);
  const bh = Math.min(H - by, box.h + pad * 2);
  // Arrow from the emptier side (left or right, above or below) towards the box.
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const fromLeft = cx > W / 2;
  const fromAbove = cy > H / 2;
  const tipX = fromLeft ? bx - 4 : bx + bw + 4;
  const tipY = fromAbove ? by - 4 : by + bh + 4;
  const tailX = Math.min(W - 10, Math.max(10, tipX + (fromLeft ? -120 : 120)));
  const tailY = Math.min(H - 10, Math.max(10, tipY + (fromAbove ? -90 : 90)));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H + capH}" viewBox="0 0 ${W} ${H + capH}">
<defs><marker id="hd" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#E11D2E"/></marker></defs>
<image href="${imageDataUri}" xlink:href="${imageDataUri}" x="0" y="0" width="${W}" height="${H}"/>
<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="none" stroke="#E11D2E" stroke-width="4"/>
<line x1="${tailX}" y1="${tailY}" x2="${tipX}" y2="${tipY}" stroke="#E11D2E" stroke-width="5" stroke-linecap="round" marker-end="url(#hd)"/>
<rect x="0" y="${H}" width="${W}" height="${capH}" fill="#1F1D1A"/>
<text x="16" y="${H + 28}" font-family="system-ui, Segoe UI, sans-serif" font-size="17" fill="#FFFFFF">${esc(caption.slice(0, 140))}</text>
</svg>`;
}

/** base64 of a byte array (Workers and Node). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The ?highlight= link to the real page for this pick. */
export function realPageLink(origin: string, pick: ShowMePick): string | null {
  return pageLink(origin, pick.pagePath, pick.box.label);
}
