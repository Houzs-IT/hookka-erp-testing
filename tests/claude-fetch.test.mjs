// claude-fetch.test.mjs: every Claude call goes through the Singapore
// forwarder when its service binding is present, and straight to Anthropic
// when it is not (tests, local dev). No network.
import test from "node:test";
import assert from "node:assert/strict";
import { claudeFetch, setClaudeForwarder } from "../src/api/lib/claude-fetch.ts";

const ANTHROPIC = "https://api.anthropic.com/v1/messages";

test("uses the forwarder binding when set", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("must not call Anthropic directly");
  try {
    setClaudeForwarder({ fetch: async (url, init) => (seen.push([url, init.body]), new Response("ok")) });
    const res = await claudeFetch({ method: "POST", body: "{}" }, "test");
    assert.equal(await res.text(), "ok");
    assert.deepEqual(seen, [[ANTHROPIC, "{}"]]);
  } finally {
    globalThis.fetch = realFetch;
    setClaudeForwarder(undefined);
  }
});

test("calls Anthropic directly without the binding", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (seen.push(url), new Response("direct"));
  try {
    setClaudeForwarder(undefined);
    assert.equal(await (await claudeFetch({ method: "POST" }, "test")).text(), "direct");
    assert.deepEqual(seen, [ANTHROPIC]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
