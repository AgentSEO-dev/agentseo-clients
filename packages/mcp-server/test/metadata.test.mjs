import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createAgentSeoMcpServer } from "../dist/server.js";
import { assertMetadataContract } from "./metadata-contract.mjs";

async function withCatalog(run) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected API request"); };
  const server = createAgentSeoMcpServer({ apiBaseUrl: "http://127.0.0.1:9/api/v1", apiKey: "dummy-metadata-only" });
  const client = new Client({ name: "metadata-contract", version: "1.0.0" });
  const [s, c] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(s);
    await client.connect(c);
    await run((await client.listTools()).tools);
    assert.equal(calls, 0, "initialization/listing must not call the API");
  } finally {
    await client.close();
    await server.close();
    globalThis.fetch = originalFetch;
  }
}

test("all tools publish accurate annotations and complete recursive input documentation", async () => {
  await withCatalog(tools => {
    assert.deepEqual(assertMetadataContract(tools), { tools: 45, topLevelFields: 398, nestedFields: 109, containerSchemas: 62 });
  });
});

test("metadata guards reject misleading safety flags, missing nested descriptions and changed validation", async () => {
  await withCatalog(tools => {
    const wrongFlags = structuredClone(tools);
    wrongFlags[0].annotations.readOnlyHint = true;
    assert.throws(() => assertMetadataContract(wrongFlags), /annotations/);

    const unsafeRetry = structuredClone(tools);
    unsafeRetry[0].annotations.idempotentHint = true;
    assert.throws(() => assertMetadataContract(unsafeRetry), /annotations/);

    const missingNested = structuredClone(tools);
    delete missingNested.find(t => t.name === "agentseo_content_internal_links").inputSchema.properties.target_pages.items.properties.url.description;
    assert.throws(() => assertMetadataContract(missingNested), /target_pages.items.url: missing description/);

    const changedDefault = structuredClone(tools);
    changedDefault[0].inputSchema.properties.limit.default = 42;
    assert.throws(() => assertMetadataContract(changedDefault), /validation\/defaults changed/);
  });
});

test("units, pagination, formats and pending-work guidance remain specific", async () => {
  await withCatalog(tools => {
    const params = name => tools.find(t => t.name === name).inputSchema.properties;
    assert.match(params("agentseo_content_action_plan").weekly_capacity.description, /effort points/);
    assert.match(params("agentseo_backlinks_list").offset.description, /Zero-based.*rows/);
    assert.match(params("agentseo_backlinks_new_lost_timeseries").date_from.description, /YYYY-MM-DD/);
    assert.match(params("agentseo_backlinks_page_intersection").max_spam_score.description, /0-100 scale/);
    assert.match(params("agentseo_search").sync.description, /still return a pending job.*poll agentseo_job_status/);
    assert.match(params("agentseo_content_internal_links").target_pages.description, /handler requires 1-50.*wire field is optional/);
    assert.match(params("agentseo_ai_visibility_prompt_set").platforms.description, /does not run them/);
  });
});

test("stdio initialization and tools/list work with dummy credentials and all network disabled", { timeout: 15000 }, async () => {
  // An empty temporary working directory prevents dotenv loading a developer's
  // .env. Pass only explicit dummy config; never inherit service credentials.
  const cwd = await mkdtemp(join(tmpdir(), "agentseo-mcp-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", fileURLToPath(new URL("./no-network.mjs", import.meta.url)), fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    cwd,
    env: { AGENTSEO_API_KEY: "dummy-metadata-only", AGENTSEO_API_URL: "http://127.0.0.1:9/api/v1" },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: "stdio-metadata-contract", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 5000 });
    assert.ok(client.getServerVersion()?.name);
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(client.getServerVersion().version, manifest.version, "stdio must advertise the packaged release version");
    assertMetadataContract((await client.listTools({}, { timeout: 5000 })).tools);
    const result = await client.callTool({ name: "agentseo_local_audit", arguments: { business_name: 42, location: "Austin" } });
    assert.equal(result.isError, true, "invalid input must be rejected before the API");
    assert.doesNotMatch(stderr, /UNEXPECTED_NETWORK_REQUEST/);
  } finally {
    await client.close();
    await transport.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
