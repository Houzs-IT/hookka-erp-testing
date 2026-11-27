// Usage: node --import tsx/esm scripts/check-screen-fragment.mjs src/api/lib/howto/screens-sales.ts
// Prints every path / label problem in one screen-map fragment (exports SCREENS).
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { checkScreens } from "../tests/_howto-check.mjs";
const m = await import(pathToFileURL(resolve(process.argv[2])).href);
const screens = m.SCREENS ?? [];
const bad = checkScreens(screens);
console.log(`${screens.length} screens, ${bad.length} problems`);
for (const b of bad) console.log(`  ${b.id}: ${b.problem}`);
process.exit(bad.length ? 1 : 0);
