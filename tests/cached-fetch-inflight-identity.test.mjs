// BUG-2026-10-16-298: joinInflight dropped its map entry by URL when a request
// settled. An aborted request that settled after a newer one for the same URL
// had registered deleted the NEWER entry, so the next refresh could not abort
// it: it ran to the end and its body was thrown away (its consumer was gone).
//
// Renders the real hook with react-dom in node, same harness as
// production-poll-skip-inflight.test.mjs: a 100 ms refresh against a 300 ms
// response, so every request is superseded before it can land.
import test from "node:test";
import assert from "node:assert/strict";

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

test("a superseded request is always aborted, never left to finish unwatched", async () => {
  const stats = { started: 0, aborted: 0, finished: 0 };
  globalThis.fetch = (_u, init) => new Promise((resolve, reject) => {
    stats.started++;
    const body = '{"success":true,"data":[1]}';
    const t = setTimeout(() => {
      stats.finished++;
      resolve({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
    }, 300);
    init.signal.addEventListener("abort", () => {
      clearTimeout(t);
      stats.aborted++;
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
  function Page() {
    const r = useCachedJson("/api/production-orders?test=identity", 300);
    React.useEffect(() => {
      const id = setInterval(r.refresh, 100);
      return () => clearInterval(id);
    }, [r.refresh]);
    return null;
  }
  const root = createRoot(container);
  root.render(React.createElement(Page));
  await new Promise((r) => setTimeout(r, 1000));
  const snap = { ...stats };
  root.unmount();
  assert.ok(snap.started >= 5, `started ${snap.started}`);
  assert.equal(snap.finished, 0, JSON.stringify(snap));
  assert.equal(snap.aborted, snap.started - 1, JSON.stringify(snap));
});
