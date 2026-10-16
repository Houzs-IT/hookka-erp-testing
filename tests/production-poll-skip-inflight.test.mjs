// BUG-2026-10-16-297: the /production 8 s poll called refresh() while the
// order list was still loading, and refresh() cancels the running request. A
// list slower than 8 s was cancelled every time and never reached the page.
// The poll now asks useCachedJson.isFetching() first.
//
// Renders the real hook with react-dom in node (first React-rendering test in
// tests/), scaled down: 100 ms poll, 300 ms response. The objects below are
// only the fields react-dom reads when rendering a component that returns null.
// Timing-based, with wide margins (3x response vs poll, 1 s window).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.__BUILD_ID__ = "test-build";
globalThis.BroadcastChannel = undefined;
const noop = () => {};
const doc = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null, body: {} };
globalThis.document = doc;
globalThis.window = {
  HTMLIFrameElement: class {},
  document: doc,
  addEventListener: noop,
  removeEventListener: noop,
  localStorage: { length: 0, getItem: () => null, setItem: noop, removeItem: noop, key: () => null },
};
const container = {
  nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  ownerDocument: doc, addEventListener: noop, removeEventListener: noop,
};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCachedJson } = await import("../src/lib/cached-fetch.ts");

async function poll(guard) {
  const url = `/api/production-orders?test=${guard}`;
  const stats = { started: 0, aborted: 0 };
  globalThis.fetch = (_u, init) => new Promise((resolve, reject) => {
    stats.started++;
    const body = '{"success":true,"data":[1]}';
    const t = setTimeout(() => resolve({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }), 300);
    init.signal.addEventListener("abort", () => {
      clearTimeout(t);
      stats.aborted++;
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
  let data = null;
  function Page() {
    const r = useCachedJson(url, 300, { reuseUnchanged: true });
    data = r.data;
    React.useEffect(() => {
      const id = setInterval(() => {
        if (guard && r.isFetching()) return;
        r.refresh();
      }, 100);
      return () => clearInterval(id);
    }, [r.refresh, r.isFetching]);
    return null;
  }
  const root = createRoot(container);
  root.render(React.createElement(Page));
  await new Promise((r) => setTimeout(r, 1000));
  const out = { ...stats, data };
  root.unmount();
  return out;
}

test("a poll faster than the response never delivers data without the guard", async () => {
  const r = await poll(false);
  assert.equal(r.data, null);
  assert.ok(r.aborted >= 3, `aborted ${r.aborted}`);
});

test("with the isFetching guard each request lands and nothing is cancelled", async () => {
  const r = await poll(true);
  assert.deepEqual(r.data, { success: true, data: [1] });
  assert.equal(r.aborted, 0);
  assert.ok(r.started >= 2, `started ${r.started}`);
});

test("the /production poll tick checks the list request before refreshing", () => {
  const src = readFileSync(new URL("../src/pages/production/index.tsx", import.meta.url), "utf8");
  const tick = src.slice(src.indexOf("const POLL_INTERVAL_MS = 8_000;"), src.indexOf("setInterval(tick, POLL_INTERVAL_MS)"));
  assert.match(tick, /if \(ordersFetching\(\)\) return;[\s\S]*fetchOrders\(\);/);
});
