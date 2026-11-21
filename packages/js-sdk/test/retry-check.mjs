import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSEO, AgentSEOError } from "../dist/index.js";

function mockTransport(t, outcomes) {
  const realFetch = globalThis.fetch;
  const calls = [];
  // Replace fetch entirely; unexpected requests fail instead of using a network.
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: { ...options.headers }, body: options.body });
    assert.ok(outcomes.length, "Unexpected extra SDK request");
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return new Response(JSON.stringify(outcome.body ?? { jobId: "offline-job", status: "queued" }), { status: outcome.status ?? 202 });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return calls;
}

function assertOneIdentity(calls) {
  assert.ok(calls.length > 1);
  const identity = calls[0].headers["idempotency-key"];
  assert.match(identity, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  for (const call of calls) {
    assert.equal(call.method, "POST");
    assert.equal(call.headers["idempotency-key"], identity);
    assert.equal(call.body, calls[0].body);
  }
}

for (const status of [429, 502, 503, 504]) {
  test(`POST retries HTTP ${status} with one generated key`, async (t) => {
    const calls = mockTransport(t, [{ status }, {}]);
    await new AgentSEO({ apiKey: "sk_live_offline_fixture" }).search({ query: "fixture" }, { sync: true });
    assertOneIdentity(calls);
    assert.equal(calls[0].url, "https://www.agentseo.dev/api/v1/search?sync=true");
  });
}

for (const error of [new TypeError("Response lost after acceptance"), new DOMException("Timed out", "AbortError")]) {
  test(`POST retries ${error.name} with one generated key`, async (t) => {
    const calls = mockTransport(t, [error, {}]);
    await new AgentSEO({ apiKey: "sk_live_offline_fixture" }).search({ query: "fixture" });
    assertOneIdentity(calls);
  });
}

test("exhausted retries preserve one identity", async (t) => {
  const calls = mockTransport(t, [new TypeError("Network lost"), new TypeError("Network lost"), new TypeError("Network lost")]);
  await assert.rejects(new AgentSEO({ apiKey: "sk_live_offline_fixture", maxRetries: 2 }).search({ query: "fixture" }));
  assert.equal(calls.length, 3);
  assertOneIdentity(calls);
});

test("explicit caller identity survives a lost-response retry", async (t) => {
  const calls = mockTransport(t, [new TypeError("Network lost"), {}]);
  await new AgentSEO({ apiKey: "sk_live_offline_fixture" }).search({ query: "fixture" }, { idempotencyKey: "Exact-Caller-Key" });
  assert.deepEqual(calls.map(call => call.headers["idempotency-key"]), ["Exact-Caller-Key", "Exact-Caller-Key"]);
});

test("an explicit empty identity is left for server validation", async (t) => {
  const calls = mockTransport(t, [{ status: 400 }]);
  await assert.rejects(new AgentSEO({ apiKey: "sk_live_offline_fixture" }).search({ query: "fixture" }, { idempotencyKey: "" }), AgentSEOError);
  assert.equal(calls[0].headers["idempotency-key"], "");
  assert.equal(calls.length, 1);
});

test("independent calls get different keys even for identical inputs", async (t) => {
  const calls = mockTransport(t, [{}, {}]);
  const client = new AgentSEO({ apiKey: "sk_live_offline_fixture" });
  await client.search({ query: "same query" });
  await client.search({ query: "same query" });
  assert.ok(calls[0].headers["idempotency-key"]);
  assert.notEqual(calls[0].headers["idempotency-key"], calls[1].headers["idempotency-key"]);
});

test("GET retries do not send a mutation identity", async (t) => {
  const calls = mockTransport(t, [{ status: 503 }, { status: 200 }]);
  await new AgentSEO({ apiKey: "sk_live_offline_fixture" }).getJob("offline-job", { idempotencyKey: "post-only" });
  assert.deepEqual(calls.map(call => call.method), ["GET", "GET"]);
  assert.ok(calls.every(call => !("idempotency-key" in call.headers)));
});

for (const status of [400, 401, 402, 403, 409]) {
  test(`HTTP ${status} does not retry or create a replacement call`, async (t) => {
    const calls = mockTransport(t, [{ status }]);
    await assert.rejects(new AgentSEO({ apiKey: "sk_live_offline_fixture" }).search({ query: "fixture" }), AgentSEOError);
    assert.equal(calls.length, 1);
  });
}

test("maxRetries zero sends only one POST", async (t) => {
  const calls = mockTransport(t, [new TypeError("Network lost")]);
  await assert.rejects(new AgentSEO({ apiKey: "sk_live_offline_fixture", maxRetries: 0 }).search({ query: "fixture" }));
  assert.equal(calls.length, 1);
});
