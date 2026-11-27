// Usage: node --import tsx/esm scripts/check-howto-fragment.mjs src/api/lib/howto/guides-sales.ts
// Prints every page / label problem in one how-to guide fragment (exports GUIDES).
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { checkGuides } from "../tests/_howto-check.mjs";
const f = process.argv[2];
const m = await import(pathToFileURL(resolve(f)).href);
const guides = m.GUIDES ?? [];
const bad = checkGuides(guides);
console.log(`${guides.length} guides, ${bad.length} problems`);
for (const b of bad) console.log(`  ${b.id}: ${b.problem}`);
process.exit(bad.length ? 1 : 0);
