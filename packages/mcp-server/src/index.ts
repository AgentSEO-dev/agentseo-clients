#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_BASE_URL =
  process.env.AGENTSEO_API_URL || "https://www.agentseo.dev/api/v1";
const API_KEY = process.env.AGENTSEO_API_KEY;
const PROJECT_ID = process.env.AGENTSEO_PROJECT_ID;
const WORKFLOW_ID = process.env.AGENTSEO_WORKFLOW_ID;

if (!API_KEY) {
  console.error("Error: AGENTSEO_API_KEY environment variable is required.");
  process.exit(1);
}

const server = new McpServer({
  name: "AgentSEO MCP Server",
  version: "0.2.0",
});

interface AxiosLikeError {
  isAxiosError?: boolean;
  message?: string;
  response?: {
    data?: {
      error?: unknown;
    };
  };
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === "object" && error !== null && "isAxiosError" in error;
}

type ApiMethod = "GET" | "POST";

async function callAgentSeoApi<T = unknown>(
  endpoint: string,
  options: {
    method?: ApiMethod;
    data?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> {
  const method = options.method ?? "POST";
  try {
    const response = await axios.request({
      url: `${API_BASE_URL}${endpoint}`,
      method,
      data: options.data,
      params: options.params,
      headers: {
        "x-api-key": API_KEY,
        "Content-Type": "application/json",
        "x-agentseo-client": "mcp-server",
        ...(PROJECT_ID ? { "x-project-id": PROJECT_ID } : {}),
        ...(WORKFLOW_ID ? { "x-workflow-id": WORKFLOW_ID } : {}),
      },
    });
    return response.data as T;
  } catch (error: unknown) {
    if (isAxiosLikeError(error)) {
      const errorData = error.response?.data?.error || error.message;
      throw new Error(`AgentSEO API Error: ${JSON.stringify(errorData)}`);
    }
    throw error;
  }
}

function jsonContent(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

server.tool(
  "agentseo_search",
  "Perform a Google search with optional domain filters.",
  {
    query: z.string().describe("The search query"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of results"),
    include_domains: z
      .array(z.string())
      .optional()
      .describe("Restrict results to these domains"),
    exclude_domains: z
      .array(z.string())
      .optional()
      .describe("Exclude results from these domains"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ query, limit, include_domains, exclude_domains, sync }) => {
    const result = await callAgentSeoApi("/search", {
      data: { query, limit, include_domains, exclude_domains },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_extract",
  "Extract content from a URL and convert to Markdown.",
  {
    url: z.string().url().describe("The URL to scrape"),
    include_images: z
      .boolean()
      .default(false)
      .describe("Include image links in markdown"),
  },
  async ({ url, include_images }) => {
    const result = await callAgentSeoApi("/extract", {
      data: { url, format: "markdown", include_images },
    });
    const parsed = z
      .object({ content: z.string() })
      .passthrough()
      .parse(result);
    return {
      content: [{ type: "text", text: parsed.content }],
    };
  },
);

server.tool(
  "agentseo_analyze_serp",
  "Deep analysis of Search Engine Results Page (SERP) features and competitors.",
  {
    keyword: z.string().describe("Target keyword"),
    location: z
      .string()
      .default("United States")
      .describe("Geographic location"),
    device: z
      .enum(["desktop", "mobile"])
      .default("desktop")
      .describe("Device type"),
    language: z.string().default("en").describe("Language code"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ keyword, location, device, language, sync }) => {
    const result = await callAgentSeoApi("/analyze/serp", {
      data: { keyword, location, device, language },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_local_audit",
  "Run a local SEO audit for a domain and location.",
  {
    domain: z.string().describe("Domain or business name"),
    location: z.string().describe("Target location"),
    language: z.string().default("en").describe("Language code"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ domain, location, language, sync }) => {
    const result = await callAgentSeoApi("/audit/local", {
      data: { domain, location, language },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_local_audit_batch",
  "Queue up to 10 local audits in one request.",
  {
    items: z
      .array(
        z.object({
          domain: z.string(),
          location: z.string(),
          language: z.string().optional(),
        }),
      )
      .max(10)
      .describe("Audit items"),
  },
  async ({ items }) => {
    const result = await callAgentSeoApi("/audit/local/batch", {
      data: { items },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_content_gap",
  "Run content gap analysis for a URL and keyword.",
  {
    url: z.string().url().describe("Your URL"),
    keyword: z.string().describe("Target keyword"),
    location: z
      .string()
      .default("United States")
      .describe("Geographic location"),
    language: z.string().default("en").describe("Language code"),
    scrape_depth: z
      .enum(["h1", "h2", "h3"])
      .default("h3")
      .describe("How deep to analyze headings"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ url, keyword, location, language, scrape_depth, sync }) => {
    const result = await callAgentSeoApi("/content/gap", {
      data: { url, keyword, location, language, scrape_depth },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_social_listen",
  "Find web mentions for a query (web-wide discovery; not platform-native monitoring).",
  {
    query: z.string().describe("Search query"),
    platform: z
      .enum(["reddit", "twitter", "all"])
      .default("all")
      .describe("Platform filter"),
    limit: z.number().int().min(1).max(50).default(10).describe("Result limit"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ query, platform, limit, sync }) => {
    const result = await callAgentSeoApi("/social/listen", {
      data: { query, platform, limit },
      params: { sync },
    });
    return jsonContent(result);
  },
);

// Preferred name; keep agentseo_social_listen for backward compatibility.
server.tool(
  "agentseo_web_mentions",
  "Find web mentions for a query (web-wide discovery; not platform-native monitoring).",
  {
    query: z.string().describe("Search query"),
    platform: z
      .enum(["reddit", "twitter", "all"])
      .default("all")
      .describe("Platform filter"),
    limit: z.number().int().min(1).max(50).default(10).describe("Result limit"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ query, platform, limit, sync }) => {
    const result = await callAgentSeoApi("/social/listen", {
      data: { query, platform, limit },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_ai_overview_extract",
  "Extract AI Overview insights for a target keyword.",
  {
    keyword: z.string().describe("Target keyword"),
    location: z
      .string()
      .default("United States")
      .describe("Geographic location"),
    language: z.string().default("en").describe("Language code"),
    target_domain: z
      .string()
      .optional()
      .describe(
        "Optional domain to check against the sampled citation candidates",
      ),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ keyword, location, language, target_domain, sync }) => {
    const result = await callAgentSeoApi("/ai-overview/extract", {
      data: { keyword, location, language, target_domain },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_local_visibility_track",
  "Track local visibility for a domain across keywords and locations.",
  {
    domain: z.string().describe("Domain to track"),
    keywords: z.array(z.string()).min(1).max(5).describe("Keywords"),
    locations: z.array(z.string()).min(1).max(3).describe("Locations"),
    language: z.string().default("en").describe("Language code"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ domain, keywords, locations, language, sync }) => {
    const result = await callAgentSeoApi("/local-visibility/track", {
      data: { domain, keywords, locations, language },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_llm_mentions_track",
  "Track brand mentions across LLM/search-style results.",
  {
    brand: z.string().describe("Brand name"),
    queries: z.array(z.string()).min(1).max(10).describe("Queries to check"),
    limit_per_query: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe("Per-query result limit"),
    platform: z
      .enum(["reddit", "twitter", "all"])
      .default("all")
      .describe("Platform filter"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ brand, queries, limit_per_query, platform, sync }) => {
    const result = await callAgentSeoApi("/llm-mentions/track", {
      data: { brand, queries, limit_per_query, platform },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_content_decay_detect",
  "Detect potential content decay for a URL and keyword.",
  {
    url: z.string().url().describe("Target URL"),
    keyword: z.string().describe("Target keyword"),
    lookback_days: z
      .number()
      .int()
      .min(3)
      .max(180)
      .default(30)
      .describe("Lookback window"),
    threshold: z
      .number()
      .min(1)
      .max(20)
      .default(3)
      .describe("Rank drop threshold"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ url, keyword, lookback_days, threshold, sync }) => {
    const result = await callAgentSeoApi("/content-decay/detect", {
      data: { url, keyword, lookback_days, threshold },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_keyword_cluster_build",
  "Build keyword clusters from an input keyword list.",
  {
    keywords: z.array(z.string()).min(1).max(200).describe("Keywords"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ keywords, sync }) => {
    const result = await callAgentSeoApi("/keyword-cluster/build", {
      data: { keywords },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_rank_track",
  "Queue a rank tracking check for a URL and keyword.",
  {
    keyword: z.string().describe("Keyword to track"),
    url: z.string().url().describe("URL to track"),
    location: z.string().default("United States").describe("Location"),
    sync: z.boolean().default(true).describe("Whether to run synchronously"),
  },
  async ({ keyword, url, location, sync }) => {
    const result = await callAgentSeoApi("/rank/track", {
      data: { keyword, url, location },
      params: { sync },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_rank_history",
  "Fetch historical rank data for a keyword and URL.",
  {
    keyword: z.string().describe("Keyword"),
    url: z.string().url().describe("URL"),
  },
  async ({ keyword, url }) => {
    const result = await callAgentSeoApi("/rank/track", {
      method: "GET",
      params: { keyword, url },
    });
    return jsonContent(result);
  },
);

server.tool(
  "agentseo_job_status",
  "Get status/result for a previously queued job.",
  {
    job_id: z.string().describe("Job ID"),
  },
  async ({ job_id }) => {
    const result = await callAgentSeoApi(`/jobs/${job_id}`, {
      method: "GET",
    });
    return jsonContent(result);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AgentSEO MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
