// Regenerates docs/how-to/README.md from the guide data in src/api/lib/howto/.
// Usage: node --import tsx/esm scripts/gen-howto-index.mjs
import { writeFileSync } from "node:fs";
const m = await import("../src/api/lib/mcp-howto.ts");
const L = [];
L.push("# How-to guides (AI Connector process help)", "", `> **Last generated: ${new Date().toISOString().slice(0, 10)}** by \`scripts/gen-howto-index.mjs\` from \`src/api/lib/howto/\`.`, "");
L.push('Staff ask Claude "how do I…" and the AI Connector answers from these guides (owner ask 2026-11-27).');
L.push("The guides are **data**, not prose: `src/api/lib/howto/`. This index is generated from that data — edit the data, then run `node --import tsx/esm scripts/gen-howto-index.mjs`.", "");
L.push("- Tools: `how_to {question?, topic?, company?}`, `module_overview {module?}`, `glossary {term?}`, `explain_error {text}`, `onboarding {role}` (logic `src/api/lib/mcp-howto.ts`, wired in `src/api/routes/mcp.ts`). Prompts: `how_do_i`, `explain_module`, `what_does_it_mean`, `explain_this_error`, `my_first_week`.");
L.push("- Honesty tests: `tests/mcp-howto.test.mjs` (+ `tests/_howto-check.mjs`) — every page path is in the router, every double-quoted UI label is in `src/`, every error fragment is real, every guide has a company tag, canDo follows RBAC.");
L.push("- Writing a guide: follow `src/api/lib/howto/types.ts` (SOP fields). Read the real page + API route; cite each enforced business rule in a code comment (`// src/...:line`), never in user text; never invent a rule (there are no written approval limits). Check one file: `node --import tsx/esm scripts/check-howto-fragment.mjs src/api/lib/howto/guides-<area>.ts`.");
L.push("- Companies: Hookka is ONE tenant org; the organisations registry holds HOOKKA and sister companies (e.g. OHANA). They change the letterhead / purchase company / sales org; accounting stays HOOKKA. No flow in the code is company-specific today, so every guide is tagged `ALL`; customer-type differences (consignment, customer hubs, per-customer prices, purchase company, sales org) are `variants`.");
L.push('- Gap log: help questions with no guide are logged in `mcp_calls` (note `no-guide`, emails / numbers stripped) and listed on SYSTEM → AI Connector → "Questions with no guide yet".', "");
L.push(`## Task guides (${m.GUIDES.length})`, "", "| id | title | module | page | permission |", "| --- | --- | --- | --- | --- |");
for (const g of m.GUIDES) L.push(`| \`${g.id}\` | ${g.title} | ${g.module} | \`${g.page}\` | ${[...g.permission, ...(g.permissionAny?.length ? [`any of ${g.permissionAny.join(" / ")}`] : [])].join(", ")} |`);
L.push("", "## End-to-end flows", "");
for (const f of m.FLOWS) L.push(`- **${f.title}** (\`${f.id}\`): ${f.steps.map((s) => `\`${s.guide}\` (${s.role})`).join(" → ")}`);
L.push("", "## First-week reading paths (`onboarding`)", "");
for (const [k, v] of Object.entries(m.ONBOARDING)) L.push(`- **${v.title}** (\`${k}\`): ${v.path.map((x) => `\`${x}\``).join(", ")}`);
L.push("", "## Modules (`module_overview`)", "");
for (const x of m.MODULES) L.push(`- **${x.section}** — ${x.oneLine}`);
L.push("", `## Glossary and errors`, "", `- \`glossary\`: ${m.GLOSSARY.length} terms (${m.GLOSSARY.map((e) => e.term).join(", ")}).`, `- \`explain_error\`: ${m.ERRORS.length} real ERP messages (\`src/api/lib/howto/errors.ts\`).`);
const sc = await import("../src/api/lib/mcp-screens.ts");
L.push("", "## Screen map (`explain_screen`, `where_is`)", "", `- ${sc.SCREENS.length} router pages (${sc.SCREENS.filter((x) => x.detail === "full").length} in full detail), ${sc.SCREENS.reduce((n, x) => n + x.actions.length, 0)} buttons / tabs / menu items — \`src/api/lib/howto/screens-*.ts\`. Links carry \`?highlight=<label>\`, which outlines that element in the ERP.`);
const hs = await import("../src/api/lib/howto/help-shots.ts");
L.push("", "## Screenshots (`show_me`)", "", `- ${hs.HELP_SHOTS.length} pages, ${hs.HELP_SHOTS.reduce((n, x) => n + x.boxes.length, 0)} boxed buttons, captured ${hs.HELP_SHOTS_CAPTURED_AT} with mocked demo data — \`public/help/shots/\`, boxes in \`src/api/lib/howto/help-shots.ts\`. Re-capture: \`npm run dev\`, then \`npm run help:shots\`.`);
writeFileSync(new URL("../docs/how-to/README.md", import.meta.url), L.join("\n") + "\n");
console.log(`wrote ${L.length} lines`);
