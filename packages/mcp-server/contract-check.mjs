import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAgentSeoMcpServer } from "./dist/server.js";

test("patched package exposes current tools and rejects invalid input without an API call", async () => {
  const originalFetch = globalThis.fetch;
  let apiCalls = 0;
  globalThis.fetch = async () => {
    apiCalls += 1;
    throw new Error("Unexpected API request");
  };

  const server = createAgentSeoMcpServer({
    apiBaseUrl: "http://127.0.0.1:9/api/v1",
    apiKey: "test-only-key",
  });
  const client = new Client({ name: "agentseo-package-contract", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 45);
    assert.ok(tools.find((tool) => tool.name === "agentseo_local_audit")?.inputSchema?.properties?.business_name);

    let rejected = false;
    try {
      const result = await client.callTool({
        name: "agentseo_local_audit",
        arguments: { business_name: 42, location: "Austin" },
      });
      rejected = result.isError === true;
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true);
    assert.equal(apiCalls, 0);
  } finally {
    await client.close();
    await server.close();
    globalThis.fetch = originalFetch;
  }
});
