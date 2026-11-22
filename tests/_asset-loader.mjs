// _asset-loader.mjs — Vite image imports ("x.png?inline") have no meaning in
// node: serve each as a 1×1 PNG data URL so PDF generators (which draw the
// letterhead logo) can be built inside a test. Register AFTER
// _alias-loader.mjs (later loaders run first). Not a *.test.mjs file.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
export function resolve(specifier, context, nextResolve) {
  if (/\.(png|jpe?g|svg)(\?inline)?$/.test(specifier)) {
    return { url: `asset-stub:${encodeURIComponent(specifier)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("asset-stub:")) {
    return { format: "module", source: `export default ${JSON.stringify(PNG)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
