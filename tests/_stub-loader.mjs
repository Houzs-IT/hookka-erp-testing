// Redirects "@/lib/cached-fetch" to tests/_stubs/cached-fetch.mjs. Register AFTER
// _alias-loader.mjs (later loaders run first).
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
const STUB = pathToFileURL(resolvePath(process.cwd(), "tests/_stubs/cached-fetch.mjs")).href;
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/cached-fetch") return nextResolve(STUB, context);
  return nextResolve(specifier, context);
}

// Side-effect stylesheets (import "./x.css") have no meaning in node: load them as empty modules.
export function load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
  return nextLoad(url, context);
}
