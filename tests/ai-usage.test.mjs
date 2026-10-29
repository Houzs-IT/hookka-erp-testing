// ai-usage.test.mjs — every Claude call is logged with its feature, and the
// daily summary the IT Hub splits Hookka's AI cost by is priced and grouped
// right. No network, no database: a stub DB records what would be written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aiUsageScope,
  buildHubUsageReport,
  costUsd,
  hubSendDue,
  lastUtcDays,
  modelOf,
  usageFromBody,
} from "../src/api/lib/ai-usage.ts";
import { claudeFetch, setClaudeForwarder } from "../src/api/lib/claude-fetch.ts";

function stubDb() {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind: (...args) => ({ run: async () => writes.push([sql, args]) }),
        run: async () => writes.push([sql, []]),
      };
    },
  };
}

test("usage is read from a plain JSON response", () => {
  const t = usageFromBody(
    JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 } }),
  );
  assert.deepEqual(t, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 7 });
});

test("usage is read from a stream: input from message_start, output from the last delta", () => {
  const body = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":1,"cache_read_input_tokens":9}}}',
    'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
    'data: {"type":"message_delta","usage":{"output_tokens":12}}',
    'data: {"type":"message_delta","usage":{"output_tokens":30}}',
  ].join("\n");
  assert.deepEqual(usageFromBody(body), { inputTokens: 50, outputTokens: 30, cacheReadTokens: 9, cacheWriteTokens: 0 });
  assert.equal(usageFromBody("not json"), null);
});

test("the model comes from the request body", () => {
  assert.equal(modelOf(JSON.stringify({ model: "claude-haiku-4-5" })), "claude-haiku-4-5");
  assert.equal(modelOf("{bad"), "");
  assert.equal(modelOf(undefined), "");
});

test("prices: dated model ids match their family; unknown models price as Sonnet", () => {
  const t = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(costUsd("claude-haiku-4-5-20251001", t), 1);
  assert.equal(costUsd("claude-sonnet-4-5-20250929", t), 3);
  assert.equal(costUsd("something-else", t), 3);
});

test("a call inside a request scope is logged with its feature; outside, nothing is written", async () => {
  const db = stubDb();
  const pending = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 4 } }));
  try {
    setClaudeForwarder(undefined);
    const res = await aiUsageScope.run({ db, waitUntil: (p) => pending.push(p) }, () =>
      claudeFetch({ method: "POST", body: JSON.stringify({ model: "claude-sonnet-4-6" }) }, "scan_po"),
    );
    assert.deepEqual(JSON.parse(await res.text()).usage, { input_tokens: 10, output_tokens: 4 }, "caller still reads the body");
    await Promise.all(pending);
    const insert = db.writes.find(([sql]) => sql.includes("INSERT INTO ai_usage_events"));
    assert.ok(insert, "a row is written");
    const [, args] = insert;
    assert.deepEqual(args.slice(2), ["scan_po", "claude-sonnet-4-6", 10, 4, 0, 0, 1, 200]);

    const before = db.writes.length;
    await claudeFetch({ method: "POST", body: "{}" }, "scan_po");
    assert.equal(db.writes.length, before, "no scope, no write");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the hub report prices each feature per day and sends empty days too", () => {
  const days = lastUtcDays(new Date("2026-10-29T03:00:00Z"), 3);
  assert.deepEqual(days, ["2026-10-27", "2026-10-28", "2026-10-29"]);
  const zero = { outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const report = buildHubUsageReport(days, [
    { day: "2026-10-28", feature: "scan_po", model: "claude-sonnet-4-6", calls: 2, inputTokens: 1_000_000, ...zero },
    { day: "2026-10-28", feature: "scan_po", model: "claude-haiku-4-5", calls: 1, inputTokens: 1_000_000, ...zero },
    { day: "2026-10-01", feature: "scan_po", model: "claude-sonnet-4-6", calls: 9, inputTokens: 1, ...zero },
  ]);
  assert.equal(report.vendor, "Anthropic");
  assert.deepEqual(report.days[0], { day: "2026-10-27", rows: [] });
  assert.deepEqual(report.days[1].rows, [{ company: null, module: "scan_po", usd: 4, calls: 3 }]);
});

test("the send is due once per UTC day, after 02:00 UTC", () => {
  assert.equal(hubSendDue(new Date("2026-10-29T01:59:00Z"), null), false);
  assert.equal(hubSendDue(new Date("2026-10-29T02:00:00Z"), "2026-10-28"), true);
  assert.equal(hubSendDue(new Date("2026-10-29T09:00:00Z"), "2026-10-29"), false);
});

test("every Claude call site names its feature", () => {
  const files = [
    "src/api/lib/agent-brain.ts",
    "src/api/lib/anthropic-client.ts",
    "src/api/lib/ocr-distill.ts",
    "src/api/lib/scan-engine.ts",
    "src/api/lib/translate-announcement.ts",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const calls = src.split("claudeFetch(").length - 1;
    const named = (src.match(/\}, "[a-z_]+"\)/g) ?? []).length;
    assert.ok(calls > 0 && named >= calls, `${f}: ${calls} call(s), ${named} named`);
  }
});
