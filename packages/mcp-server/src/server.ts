import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type ApiMethod = "GET" | "POST";

type AgentSeoMcpServerOptions = {
  apiBaseUrl: string;
  apiKey: string;
  projectId?: string;
  workflowId?: string;
};

// All analysis calls below use the account's existing credits and can create
// durable work. The client sends no idempotency key, so repeats can charge again.
const billableToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

// These workflows only analyze supplied records; they still create charged work.
const suppliedDataToolAnnotations = {
  ...billableToolAnnotations,
  openWorldHint: false,
} as const;

// Polling can resume the same job, including upstream work, without a new debit.
const jobStatusAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function jsonContent(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function internalLinksTargetPagesErrorContent() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: {
              code: "MISSING_TARGET_PAGES",
              message:
                "target_pages is required for agentseo_content_internal_links. Provide 1-50 candidate internal pages to rank for link opportunities.",
              details: {
                expected_shape: {
                  target_pages: [
                    {
                      url: "https://example.com/docs/api-reference",
                      title: "API Reference",
                      description: "Optional page summary",
                      keywords: ["seo api", "api docs"],
                    },
                  ],
                },
                suggested_workflow: [
                  "Export candidate internal pages from your sitemap, CMS, crawler, or Search Console.",
                  "Pass those pages as target_pages.",
                  "Use agentseo_site_sitemap_audit first if you need help building a candidate page set.",
                ],
              },
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function callAgentSeoApi<T = unknown>(
  apiBaseUrl: string,
  apiKey: string,
  projectId: string | undefined,
  workflowId: string | undefined,
  endpoint: string,
  options: {
    method?: ApiMethod;
    data?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> {
  const method = options.method ?? "POST";
  const normalizedBase = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const url = new URL(normalizedEndpoint, normalizedBase);

  Object.entries(options.params ?? {}).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method,
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "x-agentseo-client": "hosted-mcp",
      ...(projectId ? { "x-project-id": projectId } : {}),
      ...(workflowId ? { "x-workflow-id": workflowId } : {}),
    },
    body: method === "POST" ? JSON.stringify(options.data ?? {}) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`AgentSEO API Error: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export function createAgentSeoMcpServer({
  apiBaseUrl,
  apiKey,
  projectId,
  workflowId,
}: AgentSeoMcpServerOptions) {
  const server = new McpServer({
    name: "AgentSEO Hosted MCP",
    version: "0.1.4",
    websiteUrl: "https://www.agentseo.dev",
  });

  server.registerTool(
    "agentseo_search",
    {
      title: "AgentSEO Search",
      description: "Perform a Google search with optional domain filters. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        query: z.string().describe("Google search query to run; provide the words or phrase to search for. Type: String. Required."),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of search results to return; larger result sets may consume more credits. Type: Safe integer. Minimum: 1. Maximum: 50. Default: 10."),
        include_domains: z.array(z.string().describe("One allowed hostname for search inclusion, for example example.com. Type: String. Required.")).optional().describe("Restrict search results to these hostnames, for example example.com; omit for no inclusion filter. Type: Array. Optional; no client default."),
        exclude_domains: z.array(z.string().describe("One hostname to exclude from the search results, for example example.com. Type: String. Required.")).optional().describe("Exclude these hostnames from search results, for example example.com. Type: Array. Optional; no client default."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ query, limit, include_domains, exclude_domains, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/search",
        {
        data: { query, limit, include_domains, exclude_domains },
        params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_extract",
    {
      title: "AgentSEO Extract",
      description: "Extract content from a URL and convert to Markdown. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Required."),
        include_images: z.boolean().default(false).describe("Include extracted image information with the returned page content when true. Type: Boolean. Default: false."),
      },
    },
    async ({ url, include_images }) => {
      const result = await callAgentSeoApi<{ content: string }>(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/extract",
        {
          data: { url, format: "markdown", include_images },
        },
      );

      return {
        content: [{ type: "text" as const, text: result.content }],
      };
    },
  );

  server.registerTool(
    "agentseo_analyze_serp",
    {
      title: "AgentSEO Analyze SERP",
      description:
        "Deep analysis of Search Engine Results Page (SERP) features and competitors. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        device: z.enum(["desktop", "mobile"]).default("desktop").describe("Device search-result profile used for the analysis. Type: String. Accepted values: \"desktop\", \"mobile\". Default: \"desktop\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ keyword, location, device, language, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/analyze/serp",
        {
          data: { keyword, location, device, language },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_local_audit",
    {
      title: "AgentSEO Local Audit",
      description: "Audit one Google Maps business listing. Provide its business name and city/state/country; do not pass a website URL or domain. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        business_name: z.string().describe("Business name as shown in its Google Maps listing, not a website domain or URL. Type: String. Required."),
        location: z.string().describe("Business city, state/region and country as a human-readable place name, for example Austin, Texas, United States. Type: String. Required."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ business_name, location, language, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/audit/local",
        {
          data: { business_name, location, language },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_gap",
    {
      title: "AgentSEO Content Gap",
      description: "Run content gap analysis for a URL and keyword. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Required."),
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        scrape_depth: z.enum(["h1", "h2", "h3"]).default("h3").describe("Deepest heading level to include when comparing scraped page outlines. Type: String. Accepted values: \"h1\", \"h2\", \"h3\". Default: \"h3\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ url, keyword, location, language, scrape_depth, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/gap",
        {
          data: { url, keyword, location, language, scrape_depth },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_opportunities_find",
    {
      title: "AgentSEO Opportunity Finder",
      description: "Find prioritized SEO opportunities for a domain or URL. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        keyword_limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of keyword candidates to inspect for opportunities. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        opportunity_limit: z.number().int().min(1).max(25).default(10).describe("Maximum number of prioritized opportunities to return. Type: Safe integer. Minimum: 1. Maximum: 25. Default: 10."),
        include_serp_competitors: z.boolean().default(false).describe("Include competitors found in sampled search results when true; this may require additional upstream analysis. Type: Boolean. Default: false."),
        include_competitor_discovery: z.boolean().default(false).describe("Discover additional competing domains when true instead of relying only on the target data. Type: Boolean. Default: false."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      location,
      language,
      keyword_limit,
      opportunity_limit,
      include_serp_competitors,
      include_competitor_discovery,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/opportunities/find",
        {
          data: {
            target,
            location,
            language,
            keyword_limit,
            opportunity_limit,
            include_serp_competitors,
            include_competitor_discovery,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_opportunities_brief",
    {
      title: "AgentSEO Opportunity Brief",
      description: "Turn one keyword or page opportunity into an implementation-ready brief. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        target: z.string().describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Required."),
        page_url: z.string().url().optional().describe("Existing target page URL for the opportunity brief, if one already exists. Type: String. Format: absolute URL. Optional; no client default."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        opportunity_type: z
          .enum([
            "quick_win",
            "content_refresh",
            "ai_overview_opportunity",
            "featured_snippet_opportunity",
            "commercial_intent_opportunity",
            "lost_keyword_recovery",
            "competitor_gap",
          ])
          .optional().describe("Opportunity category to emphasize when constructing the brief. Type: String. Accepted values: \"quick_win\", \"content_refresh\", \"ai_overview_opportunity\", \"featured_snippet_opportunity\", \"commercial_intent_opportunity\", \"lost_keyword_recovery\", \"competitor_gap\". Optional; no client default."),
        current_rank: z.number().int().min(1).max(100).optional().describe("Known current organic search position, with 1 meaning first; omit when unknown rather than using zero. Type: Safe integer. Minimum: 1. Maximum: 100. Optional; no client default."),
        include_competitor_outlines: z.boolean().default(true).describe("Include sampled competitor heading outlines in the brief when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      keyword,
      target,
      page_url,
      location,
      language,
      opportunity_type,
      current_rank,
      include_competitor_outlines,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/opportunities/brief",
        {
          data: {
            keyword,
            target,
            page_url,
            location,
            language,
            opportunity_type,
            current_rank,
            include_competitor_outlines,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_refresh_brief",
    {
      title: "AgentSEO Content Refresh Brief",
      description: "Create a refresh brief for an existing URL and keyword. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Required."),
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        scrape_depth: z.enum(["h1", "h2", "h3"]).default("h3").describe("Deepest heading level to include when comparing scraped page outlines. Type: String. Accepted values: \"h1\", \"h2\", \"h3\". Default: \"h3\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ url, keyword, location, language, scrape_depth, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/refresh-brief",
        {
          data: { url, keyword, location, language, scrape_depth },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_serp_outline",
    {
      title: "AgentSEO SERP Outline",
      description: "Turn live SERP intent into a writer- and agent-ready page outline. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        device: z.enum(["desktop", "mobile"]).default("desktop").describe("Device search-result profile used for the analysis. Type: String. Accepted values: \"desktop\", \"mobile\". Default: \"desktop\"."),
        outline_depth: z.enum(["brief", "standard", "detailed"]).default("standard").describe("Amount of detail requested in the recommended content outline. Type: String. Accepted values: \"brief\", \"standard\", \"detailed\". Default: \"standard\"."),
        include_title_options: z.boolean().default(true).describe("Include proposed page-title alternatives in the outline when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      keyword,
      target,
      location,
      language,
      device,
      outline_depth,
      include_title_options,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/serp-outline",
        {
          data: {
            keyword,
            target,
            location,
            language,
            device,
            outline_depth,
            include_title_options,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_brief",
    {
      title: "AgentSEO Content Brief",
      description: "Turn live SERP intent into a production-ready content brief for writers and coding agents. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        audience: z.string().optional().describe("Intended reader or buyer group in plain language; do not include unnecessary personal data. Type: String. Optional; no client default."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        device: z.enum(["desktop", "mobile"]).default("desktop").describe("Device search-result profile used for the analysis. Type: String. Accepted values: \"desktop\", \"mobile\". Default: \"desktop\"."),
        brand_voice: z.enum(["neutral", "expert", "friendly", "bold", "technical"]).default("expert").describe("Writing voice to use for the content recommendations. Type: String. Accepted values: \"neutral\", \"expert\", \"friendly\", \"bold\", \"technical\". Default: \"expert\"."),
        page_type: z
          .enum(["auto", "blog_post", "landing_page", "comparison_page", "guide", "tool_page"])
          .default("auto").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"auto\", \"blog_post\", \"landing_page\", \"comparison_page\", \"guide\", \"tool_page\". Default: \"auto\"."),
        brief_depth: z.enum(["standard", "detailed"]).default("standard").describe("Amount of implementation detail requested in the content brief. Type: String. Accepted values: \"standard\", \"detailed\". Default: \"standard\"."),
        include_serp_outline: z.boolean().default(true).describe("Include a search-result-informed page outline in the brief when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      keyword,
      target,
      audience,
      location,
      language,
      device,
      brand_voice,
      page_type,
      brief_depth,
      include_serp_outline,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/brief",
        {
          data: {
            keyword,
            target,
            audience,
            location,
            language,
            device,
            brand_voice,
            page_type,
            brief_depth,
            include_serp_outline,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_draft_qa",
    {
      title: "AgentSEO Content Draft QA",
      description: "Validate a draft URL or markdown against live SERP expectations before publishing. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        draft_url: z.string().url().optional().describe("Accessible draft or staged web page URL to evaluate; supply this or draft_markdown. Type: String. Format: absolute URL. Optional; no client default."),
        draft_markdown: z.string().min(100).max(50000).optional().describe("Draft page content as Markdown, used when a draft URL is unavailable; supply this or draft_url. Type: String. Minimum: 100 characters. Maximum: 50000 characters. Optional; no client default."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        device: z.enum(["desktop", "mobile"]).default("desktop").describe("Device search-result profile used for the analysis. Type: String. Accepted values: \"desktop\", \"mobile\". Default: \"desktop\"."),
        qa_depth: z.enum(["standard", "strict"]).default("standard").describe("How strict the draft quality review should be. Type: String. Accepted values: \"standard\", \"strict\". Default: \"standard\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      keyword,
      draft_url,
      draft_markdown,
      target,
      location,
      language,
      device,
      qa_depth,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/draft-qa",
        {
          data: {
            keyword,
            draft_url,
            draft_markdown,
            target,
            location,
            language,
            device,
            qa_depth,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_schema_plan",
    {
      title: "AgentSEO Content Schema Plan",
      description: "Plan JSON-LD schema for a URL or markdown page without a provider call. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().optional().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Optional; no client default."),
        page_markdown: z.string().min(80).max(50000).optional().describe("Page content supplied as Markdown instead of fetching url; provide page content or an accessible URL. Type: String. Minimum: 80 characters. Maximum: 50000 characters. Optional; no client default."),
        page_type: z
          .enum([
            "auto",
            "article",
            "blog_post",
            "landing_page",
            "product",
            "software",
            "local_business",
            "faq",
            "how_to",
          ])
          .default("auto").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"auto\", \"article\", \"blog_post\", \"landing_page\", \"product\", \"software\", \"local_business\", \"faq\", \"how_to\". Default: \"auto\"."),
        keyword: z.string().optional().describe("Search keyword or phrase to analyze for this workflow. Type: String. Optional; no client default."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        include_jsonld: z.boolean().default(true).describe("Include proposed JSON-LD structured-data examples in the plan when true; this does not publish them. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      url,
      page_markdown,
      page_type,
      keyword,
      target,
      include_jsonld,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/schema-plan",
        {
          data: {
            url,
            page_markdown,
            page_type,
            keyword,
            target,
            include_jsonld,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_internal_links",
    {
      title: "AgentSEO Content Internal Links",
      description: "Find internal link opportunities from a source page to required supplied target pages. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        source_url: z.string().url().optional().describe("Accessible source page URL to inspect for link opportunities; supply this or source_markdown. Type: String. Format: absolute URL. Optional; no client default."),
        source_markdown: z.string().min(80).max(50000).optional().describe("Source page content as Markdown instead of fetching source_url; supply this or source_url. Type: String. Minimum: 80 characters. Maximum: 50000 characters. Optional; no client default."),
        keyword: z.string().optional().describe("Search keyword or phrase to analyze for this workflow. Type: String. Optional; no client default."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        max_suggestions: z.number().int().min(1).max(20).default(8).describe("Maximum number of internal-link suggestions to return. Type: Safe integer. Minimum: 1. Maximum: 20. Default: 8."),
        target_pages: z
          .array(
            z.object({
              url: z.string().url().describe("Absolute URL identifying a supplied internal-link candidate page; this field does not request a page fetch. Type: String. Format: absolute URL. Required."),
              title: z.string().min(1).max(180).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
              description: z.string().max(500).optional().describe("Short summary of this supplied page; this is input evidence, not a request to generate a meta description. Type: String. Maximum: 500 characters. Optional; no client default."),
              keywords: z.array(z.string().describe("One search keyword or phrase, not a comma-separated list. Type: String. Required.")).max(12).default([]).describe("Search phrases to evaluate or associate with the supplied page. Type: Array. Maximum: 12 items. Default: []."),
            }).describe("One candidate internal page with its supplied title and optional relevance evidence. Type: Object. Required."),
          )
          .min(1)
          .max(50)
          .optional()
          .describe("Candidate internal pages from a sitemap, CMS, crawler, Search Console or a prior sitemap audit. The handler requires 1-50 entries even though this wire field is optional; omitting it returns setup guidance without an API request. Type: Array. Minimum: 1 items. Maximum: 50 items. Optional; no client default."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      source_url,
      source_markdown,
      keyword,
      target,
      max_suggestions,
      target_pages,
      sync,
    }) => {
      if (!target_pages?.length) {
        return internalLinksTargetPagesErrorContent();
      }

      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/internal-links",
        {
          data: {
            source_url,
            source_markdown,
            keyword,
            target,
            max_suggestions,
            target_pages,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_title_meta",
    {
      title: "AgentSEO Content Title Meta",
      description: "Generate SEO title and meta description options for a URL or markdown page. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().optional().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Optional; no client default."),
        page_markdown: z.string().min(80).max(50000).optional().describe("Page content supplied as Markdown instead of fetching url; provide page content or an accessible URL. Type: String. Minimum: 80 characters. Maximum: 50000 characters. Optional; no client default."),
        keyword: z.string().min(1).describe("Search keyword or phrase to analyze for this workflow. Type: String. Minimum: 1 characters. Required."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        page_type: z
          .enum(["auto", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide"])
          .default("auto").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"auto\", \"blog_post\", \"landing_page\", \"product\", \"software\", \"local_business\", \"comparison_page\", \"guide\". Default: \"auto\"."),
        current_title: z.string().max(120).optional().describe("Existing SEO title to compare with proposed title alternatives. Type: String. Maximum: 120 characters. Optional; no client default."),
        current_meta_description: z.string().max(320).optional().describe("Existing meta description to compare with proposed alternatives. Type: String. Maximum: 320 characters. Optional; no client default."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      url,
      page_markdown,
      keyword,
      target,
      page_type,
      current_title,
      current_meta_description,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/title-meta",
        {
          data: {
            url,
            page_markdown,
            keyword,
            target,
            page_type,
            current_title,
            current_meta_description,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_keyword_map",
    {
      title: "AgentSEO Content Keyword Map",
      description: "Map supplied keywords to supplied pages and flag missing pages or cannibalization risks. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        keywords: z.array(z.string().min(1).describe("One search keyword or phrase, not a comma-separated list. Type: String. Minimum: 1 characters. Required.")).min(1).max(250).describe("Search phrases to evaluate or associate with the supplied page. Type: Array. Minimum: 1 items. Maximum: 250 items. Required."),
        pages: z
          .array(
            z.object({
              url: z.string().url().describe("Absolute URL identifying this supplied page for keyword mapping; the page content is supplied in the other record fields. Type: String. Format: absolute URL. Required."),
              title: z.string().min(1).max(180).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
              description: z.string().max(500).optional().describe("Short summary of this supplied page; this is input evidence, not a request to generate a meta description. Type: String. Maximum: 500 characters. Optional; no client default."),
              headings: z.array(z.string().min(1).describe("One existing page heading as plain text. Type: String. Minimum: 1 characters. Required.")).max(30).default([]).describe("Existing page headings as plain-text strings, in reading order when available. Type: Array. Maximum: 30 items. Default: []."),
              current_keywords: z.array(z.string().min(1).describe("One keyword currently assigned to this supplied page. Type: String. Minimum: 1 characters. Required.")).max(30).default([]).describe("Keywords currently assigned to or targeted by this supplied page. Type: Array. Maximum: 30 items. Default: []."),
              page_type: z
                .enum(["unknown", "homepage", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs"])
                .default("unknown").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"unknown\", \"homepage\", \"blog_post\", \"landing_page\", \"product\", \"software\", \"local_business\", \"comparison_page\", \"guide\", \"docs\". Default: \"unknown\"."),
            }).describe("One supplied page record used in this comparison. Type: Object. Required."),
          )
          .min(1)
          .max(100).describe("Supplied page records to compare; URLs identify the records and are not instructions to publish changes. Type: Array. Minimum: 1 items. Maximum: 100 items. Required."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        max_mappings: z.number().int().min(1).max(250).default(250).describe("Maximum number of keyword-to-page mappings to include in the result. Type: Safe integer. Minimum: 1. Maximum: 250. Default: 250."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ keywords, pages, target, max_mappings, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/keyword-map",
        {
          data: {
            keywords,
            pages,
            target,
            max_mappings,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_technical_qa",
    {
      title: "AgentSEO Content Technical QA",
      description: "Run pre-publish SEO QA for metadata, indexability, canonical, headings, schema, links, and media. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().optional().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Optional; no client default."),
        html: z.string().min(80).max(250000).optional().describe("Page HTML supplied directly for analysis; provide this, markdown or a URL and avoid secrets in markup. Type: String. Minimum: 80 characters. Maximum: 250000 characters. Optional; no client default."),
        markdown: z.string().min(80).max(50000).optional().describe("Page Markdown supplied directly for analysis; provide this, html or a URL. Type: String. Minimum: 80 characters. Maximum: 50000 characters. Optional; no client default."),
        keyword: z.string().min(1).optional().describe("Search keyword or phrase to analyze for this workflow. Type: String. Minimum: 1 characters. Optional; no client default."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        expected_canonical: z.string().url().optional().describe("Absolute canonical URL the page should declare, used as the comparison target. Type: String. Format: absolute URL. Optional; no client default."),
        page_type: z
          .enum(["auto", "article", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs"])
          .default("auto").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"auto\", \"article\", \"blog_post\", \"landing_page\", \"product\", \"software\", \"local_business\", \"comparison_page\", \"guide\", \"docs\". Default: \"auto\"."),
        check_external_links: z.boolean().default(false).describe("External-link review preference. The current workflow inspects extracted link information, not the HTTP status of every external destination; fetching the source url can still access the internet. Type: Boolean. Default: false."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      url,
      html,
      markdown,
      keyword,
      target,
      expected_canonical,
      page_type,
      check_external_links,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/technical-qa",
        {
          data: {
            url,
            html,
            markdown,
            keyword,
            target,
            expected_canonical,
            page_type,
            check_external_links,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_action_plan",
    {
      title: "AgentSEO Content Action Plan",
      description: "Turn supplied SEO opportunities into a capacity-aware content calendar and execution plan. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        goal: z
          .enum(["traffic_growth", "lead_generation", "refresh_decay", "launch_support", "authority_building"])
          .default("traffic_growth").describe("Primary business outcome used to prioritize the proposed content plan. Type: String. Accepted values: \"traffic_growth\", \"lead_generation\", \"refresh_decay\", \"launch_support\", \"authority_building\". Default: \"traffic_growth\"."),
        horizon_days: z.number().int().min(7).max(90).default(30).describe("Planning horizon measured in calendar days. Type: Safe integer. Minimum: 7. Maximum: 90. Default: 30."),
        weekly_capacity: z.number().int().min(1).max(25).default(5).describe("Weekly planning capacity in effort points, not hours or item count. Small tasks use 1 point, medium 2 and large 4; overflow can be placed in the final planning week. Type: Safe integer. Minimum: 1. Maximum: 25. Default: 5."),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Planning start date in YYYY-MM-DD calendar-date format; omit to let the service choose a start date. Type: String. Format must match /^\\d{4}-\\d{2}-\\d{2}$/. Optional; no client default."),
        team: z.array(z.string().min(1).max(80).describe("One available team role or member label for planning assignments. Type: String. Minimum: 1 characters. Maximum: 80 characters. Required.")).max(20).default([]).describe("Team member or role labels available for assignment in the plan; use roles instead of personal details when possible. Type: Array. Maximum: 20 items. Default: []."),
        items: z.array(z.object({
          title: z.string().min(1).max(180).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
          keyword: z.string().min(1).max(120).optional().describe("Search keyword or phrase to analyze for this workflow. Type: String. Minimum: 1 characters. Maximum: 120 characters. Optional; no client default."),
          url: z.string().url().optional().describe("Absolute URL of the page associated with this planned work item; provenance only, not a fetch or publish request. Type: String. Format: absolute URL. Optional; no client default."),
          source_endpoint: z.string().max(120).optional().describe("AgentSEO API path that produced the opportunity, for example /content/gap; provenance only, not an endpoint to execute. Type: String. Maximum: 120 characters. Optional; no client default."),
          opportunity_type: z
            .enum(["new_content", "refresh", "technical_fix", "internal_links", "schema", "backlink_outreach", "monitoring"])
            .default("new_content").describe("Kind of planned SEO work used to prioritize and route this item. Type: String. Accepted values: \"new_content\", \"refresh\", \"technical_fix\", \"internal_links\", \"schema\", \"backlink_outreach\", \"monitoring\". Default: \"new_content\"."),
          buyer_stage: z
            .enum(["awareness", "consideration", "decision", "implementation", "retention"])
            .default("awareness").describe("Buyer-journey stage associated with this page or opportunity. Type: String. Accepted values: \"awareness\", \"consideration\", \"decision\", \"implementation\", \"retention\". Default: \"awareness\"."),
          priority: z.enum(["low", "medium", "high", "critical"]).default("medium").describe("Supplied urgency level used when ordering the work. Type: String. Accepted values: \"low\", \"medium\", \"high\", \"critical\". Default: \"medium\"."),
          impact_score: z.number().min(0).max(100).optional().describe("Supplied impact score on a 0-100 scale, with larger values indicating greater expected impact. Type: Number. Minimum: 0. Maximum: 100. Optional; no client default."),
          effort: z.enum(["small", "medium", "large"]).default("medium").describe("Relative planning effort: small uses 1 capacity point, medium 2 and large 4; these are not hours. Type: String. Accepted values: \"small\", \"medium\", \"large\". Default: \"medium\"."),
          status: z.enum(["idea", "ready", "blocked", "in_progress"]).default("idea").describe("Current workflow state of the supplied work item. Type: String. Accepted values: \"idea\", \"ready\", \"blocked\", \"in_progress\". Default: \"idea\"."),
          dependencies: z.array(z.string().min(1).max(160).describe("One prerequisite work-item title or label. Type: String. Minimum: 1 characters. Maximum: 160 characters. Required.")).max(10).default([]).describe("Names or labels of prerequisite work items that should be completed first. Type: Array. Maximum: 10 items. Default: []."),
          notes: z.string().max(1000).optional().describe("Additional supplied context relevant to this record; exclude credentials and unnecessary personal data. Type: String. Maximum: 1000 characters. Optional; no client default."),
        }).describe("One supplied opportunity or work item to prioritize. Type: Object. Required.")).min(1).max(100).describe("Supplied opportunities or tasks to prioritize and schedule; this creates a plan, not CMS posts or calendar events. Type: Array. Minimum: 1 items. Maximum: 100 items. Required."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      goal,
      horizon_days,
      weekly_capacity,
      start_date,
      team,
      items,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/action-plan",
        {
          data: {
            target,
            goal,
            horizon_days,
            weekly_capacity,
            start_date,
            team,
            items,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_site_sitemap_audit",
    {
      title: "AgentSEO Sitemap Audit",
      description: "Audit sitemap coverage, orphan-page candidates, important URLs, canonical/indexability noise, and internal-link gaps. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        sitemap_url: z.string().url().optional().describe("Accessible XML sitemap or sitemap-index URL; supply this or sitemap_xml. Type: String. Format: absolute URL. Optional; no client default."),
        sitemap_xml: z.string().min(80).max(2000000).optional().describe("XML sitemap or sitemap-index content supplied directly instead of fetching sitemap_url. Type: String. Minimum: 80 characters. Maximum: 2000000 characters. Optional; no client default."),
        max_sitemap_children: z.number().int().min(0).max(10).default(3).describe("Maximum child sitemap documents to inspect from a sitemap index; zero disables child fetching. Type: Safe integer. Minimum: 0. Maximum: 10. Default: 3."),
        important_urls: z.array(z.string().url().describe("One important absolute web page URL to check for sitemap coverage. Type: String. Format: absolute URL. Required.")).max(500).default([]).describe("Important absolute page URLs that should be checked for sitemap coverage. Type: Array. Maximum: 500 items. Default: []."),
        crawl_urls: z.array(z.object({
          url: z.string().url().describe("Absolute URL identifying this supplied crawl observation; not an instruction to crawl that page again. Type: String. Format: absolute URL. Required."),
          source: z.string().max(80).optional().describe("Label identifying the origin of this supplied crawl record, for example a crawler or Search Console export. Type: String. Maximum: 80 characters. Optional; no client default."),
          title: z.string().max(180).optional().describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Maximum: 180 characters. Optional; no client default."),
          status_code: z.number().int().min(100).max(599).optional().describe("HTTP response status code, for example 200 or 404; not an application job status. Type: Safe integer. Minimum: 100. Maximum: 599. Optional; no client default."),
          indexable: z.boolean().default(true).describe("Whether this supplied page is considered indexable according to your crawl evidence. Type: Boolean. Default: true."),
          canonical_url: z.string().url().optional().describe("Absolute canonical URL reported for this supplied page. Type: String. Format: absolute URL. Optional; no client default."),
          inbound_internal_links: z.number().int().min(0).optional().describe("Count of incoming internal links observed for this supplied page. Type: Safe integer. Minimum: 0. Optional; no client default."),
          clicks: z.number().min(0).optional().describe("Count of search clicks in your supplied reporting window; use the same window across compared records. Type: Number. Minimum: 0. Optional; no client default."),
          impressions: z.number().min(0).optional().describe("Count of search impressions in your supplied reporting window; use the same window across compared records. Type: Number. Minimum: 0. Optional; no client default."),
        }).describe("One supplied crawl or analytics observation for a page. Type: Object. Required.")).max(5000).default([]).describe("Previously collected crawl or analytics records to compare with the sitemap; these records are not a new full-site crawl request. Type: Array. Maximum: 5000 items. Default: []."),
        internal_links: z.array(z.object({
          source_url: z.string().url().describe("Source page URL associated with this record or analysis; use an absolute web URL. Type: String. Format: absolute URL. Required."),
          target_url: z.string().url().describe("Absolute destination page URL of the supplied internal link. Type: String. Format: absolute URL. Required."),
          anchor: z.string().max(160).optional().describe("Visible anchor text of the supplied link. Type: String. Maximum: 160 characters. Optional; no client default."),
        }).describe("One observed internal-link edge with source and destination URLs. Type: Object. Required.")).max(20000).default([]).describe("Supplied internal-link edges to use for coverage and orphan-page analysis. Type: Array. Maximum: 20000 items. Default: []."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      sitemap_url,
      sitemap_xml,
      max_sitemap_children,
      important_urls,
      crawl_urls,
      internal_links,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/site/sitemap-audit",
        {
          data: {
            target,
            sitemap_url,
            sitemap_xml,
            max_sitemap_children,
            important_urls,
            crawl_urls,
            internal_links,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_serp_volatility",
    {
      title: "AgentSEO SERP Volatility Monitor",
      description: "Compare supplied SERP snapshots to detect rank churn, top-domain churn, feature changes, and target visibility movement. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        keyword: z.string().min(1).describe("Search keyword or phrase to analyze for this workflow. Type: String. Minimum: 1 characters. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        device: z.enum(["desktop", "mobile"]).default("desktop").describe("Device search-result profile used for the analysis. Type: String. Accepted values: \"desktop\", \"mobile\". Default: \"desktop\"."),
        sensitivity: z.enum(["low", "medium", "high"]).default("medium").describe("Sensitivity of change detection across the supplied snapshots; high reports smaller changes. Type: String. Accepted values: \"low\", \"medium\", \"high\". Default: \"medium\"."),
        target_domains: z.array(z.string().min(1).max(180).describe("One website hostname whose visibility should be compared. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required.")).max(10).default([]).describe("Hostnames whose visibility should be compared across the supplied snapshots. Type: Array. Maximum: 10 items. Default: []."),
        snapshots: z.array(z.object({
          checked_at: z.string().min(1).describe("Snapshot capture time; use an ISO 8601 timestamp with a timezone. The client only checks that this string is nonempty. Type: String. Minimum: 1 characters. Required."),
          serp_features: z.array(z.string().min(1).max(80).describe("One observed search-feature name, for example ai_overview. Type: String. Minimum: 1 characters. Maximum: 80 characters. Required.")).max(30).default([]).describe("Names of search features present in this supplied snapshot, for example ai_overview or local_pack. Type: Array. Maximum: 30 items. Default: []."),
          results: z.array(z.object({
            position: z.number().int().min(1).max(100).describe("Observed search-result rank, where 1 means first. Type: Safe integer. Minimum: 1. Maximum: 100. Required."),
            url: z.string().url().describe("Absolute URL of the search result observed at this position in the supplied snapshot. Type: String. Format: absolute URL. Required."),
            title: z.string().max(240).optional().describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Maximum: 240 characters. Optional; no client default."),
            domain: z.string().max(180).optional().describe("Website hostname associated with this record, for example example.com rather than a business name. Type: String. Maximum: 180 characters. Optional; no client default."),
            result_type: z.enum(["organic", "paid", "local_pack", "featured_snippet", "ai_overview", "people_also_ask", "video", "image", "news", "other"]).default("organic").describe("Search-result category observed in the supplied snapshot. Type: String. Accepted values: \"organic\", \"paid\", \"local_pack\", \"featured_snippet\", \"ai_overview\", \"people_also_ask\", \"video\", \"image\", \"news\", \"other\". Default: \"organic\"."),
          }).describe("One observed ranked result in this snapshot. Type: Object. Required.")).min(1).max(100).describe("Ranked search-result records observed in this snapshot. Type: Array. Minimum: 1 items. Maximum: 100 items. Required."),
        }).describe("One supplied SERP snapshot with its capture time and ranked results. Type: Object. Required.")).min(2).max(30).describe("Time-ordered search-result snapshots for the same query and market; supply at least two comparable observations. Type: Array. Minimum: 2 items. Maximum: 30 items. Required."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      keyword,
      location,
      device,
      sensitivity,
      target_domains,
      snapshots,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/serp/volatility",
        {
          data: {
            target,
            keyword,
            location,
            device,
            sensitivity,
            target_domains,
            snapshots,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_page_cro_qa",
    {
      title: "AgentSEO Page CRO QA",
      description: "Audit SEO landing pages for value proposition clarity, CTA strength, trust proof, objection handling, and conversion friction. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        url: z.string().url().optional().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Optional; no client default."),
        html: z.string().min(80).max(250000).optional().describe("Page HTML supplied directly for analysis; provide this, markdown or a URL and avoid secrets in markup. Type: String. Minimum: 80 characters. Maximum: 250000 characters. Optional; no client default."),
        markdown: z.string().min(80).max(50000).optional().describe("Page Markdown supplied directly for analysis; provide this, html or a URL. Type: String. Minimum: 80 characters. Maximum: 50000 characters. Optional; no client default."),
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        keyword: z.string().optional().describe("Search keyword or phrase to analyze for this workflow. Type: String. Optional; no client default."),
        page_type: z.enum(["auto", "homepage", "landing_page", "pricing", "feature", "blog_post", "product", "comparison_page", "docs"]).default("auto").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"auto\", \"homepage\", \"landing_page\", \"pricing\", \"feature\", \"blog_post\", \"product\", \"comparison_page\", \"docs\". Default: \"auto\"."),
        conversion_goal: z.enum(["signup", "trial", "demo", "purchase", "contact_sales", "subscribe", "download", "learn_more"]).default("signup").describe("Desired visitor action used to evaluate conversion friction; no purchase or signup is performed. Type: String. Accepted values: \"signup\", \"trial\", \"demo\", \"purchase\", \"contact_sales\", \"subscribe\", \"download\", \"learn_more\". Default: \"signup\"."),
        traffic_source: z.enum(["organic", "paid", "email", "social", "direct", "referral", "unknown"]).default("organic").describe("Acquisition channel of the visitors this page is intended to convert. Type: String. Accepted values: \"organic\", \"paid\", \"email\", \"social\", \"direct\", \"referral\", \"unknown\". Default: \"organic\"."),
        audience: z.string().max(180).optional().describe("Intended reader or buyer group in plain language; do not include unnecessary personal data. Type: String. Maximum: 180 characters. Optional; no client default."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      url,
      html,
      markdown,
      target,
      keyword,
      page_type,
      conversion_goal,
      traffic_source,
      audience,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/page/cro-qa",
        {
          data: {
            url,
            html,
            markdown,
            target,
            keyword,
            page_type,
            conversion_goal,
            traffic_source,
            audience,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_ai_visibility_prompt_set",
    {
      title: "AgentSEO AI Visibility Prompt Set",
      description: "Build stable AI visibility prompt sets mapped to owned assets, platforms, competitors, citations, and weekly action routing. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Minimum: 1 characters. Required."),
        category: z.string().min(1).max(160).describe("Product or market category used to construct relevant AI-visibility prompts. Type: String. Minimum: 1 characters. Maximum: 160 characters. Required."),
        audience: z.string().max(180).optional().describe("Intended reader or buyer group in plain language; do not include unnecessary personal data. Type: String. Maximum: 180 characters. Optional; no client default."),
        locale: z.string().min(2).max(80).default("United States").describe("Human-readable market or locale context for the prompt set, for example United States. Type: String. Minimum: 2 characters. Maximum: 80 characters. Default: \"United States\"."),
        platforms: z.array(z.enum(["chatgpt", "perplexity", "google_ai", "gemini", "copilot", "claude"]).describe("One AI/search platform to design prompts for; no platform request is executed. Type: String. Accepted values: \"chatgpt\", \"perplexity\", \"google_ai\", \"gemini\", \"copilot\", \"claude\". Required.")).min(1).max(6).default(["chatgpt", "perplexity", "google_ai"]).describe("AI/search platforms to design prompts for; this plans prompts and does not run them on those platforms. Type: Array. Minimum: 1 items. Maximum: 6 items. Default: [\"chatgpt\",\"perplexity\",\"google_ai\"]."),
        competitors: z.array(z.string().min(1).max(160).describe("One competing brand or domain name used in the comparison. Type: String. Minimum: 1 characters. Maximum: 160 characters. Required.")).max(20).default([]).describe("Competing brands or domains to compare using the data supplied to this workflow. Type: Array. Maximum: 20 items. Default: []."),
        topics: z.array(z.string().min(1).max(120).describe("One topic or theme relevant to the supplied entity. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).min(1).max(40).describe("Relevant topics or themes associated with this target, page or prospect. Type: Array. Minimum: 1 items. Maximum: 40 items. Required."),
        product_terms: z.array(z.string().min(1).max(120).describe("One product or product-category phrase to include in prompt planning. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(40).default([]).describe("Product names or product-category phrases to incorporate into the planned prompts. Type: Array. Maximum: 40 items. Default: []."),
        personas: z.array(z.string().min(1).max(120).describe("One audience-role label used to vary prompt context. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(20).default([]).describe("Audience-role labels to vary the planned prompts by buyer context. Type: Array. Maximum: 20 items. Default: []."),
        owned_assets: z.array(z.object({
          url: z.string().url().describe("Absolute URL of your supplied owned asset to associate with planned prompts; no page fetch is performed. Type: String. Format: absolute URL. Required."),
          title: z.string().min(1).max(180).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
          page_type: z.enum(["homepage", "docs", "blog_post", "comparison", "pricing", "product", "case_study", "tool", "other"]).default("other").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"homepage\", \"docs\", \"blog_post\", \"comparison\", \"pricing\", \"product\", \"case_study\", \"tool\", \"other\". Default: \"other\"."),
          topics: z.array(z.string().min(1).max(120).describe("One topic or theme relevant to the supplied entity. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(20).default([]).describe("Relevant topics or themes associated with this target, page or prospect. Type: Array. Maximum: 20 items. Default: []."),
        }).describe("One page or resource you own, supplied as evidence for the plan. Type: Object. Required.")).max(100).default([]).describe("Supplied pages or resources you own that can support prompts or backlink recommendations; this does not edit or publish them. Type: Array. Maximum: 100 items. Default: []."),
        prompt_count: z.number().int().min(6).max(50).default(20).describe("Maximum number of prompts to generate in the planned set, not the number of live AI requests. Type: Safe integer. Minimum: 6. Maximum: 50. Default: 20."),
        cadence: z.enum(["weekly", "biweekly", "monthly"]).default("weekly").describe("Recommended comparison frequency for the prompt set; does not schedule or execute recurring checks. Type: String. Accepted values: \"weekly\", \"biweekly\", \"monthly\". Default: \"weekly\"."),
        include_citation_checks: z.boolean().default(true).describe("Include citation-check prompt variants in the plan when true; does not execute those checks. Type: Boolean. Default: true."),
        include_competitor_checks: z.boolean().default(true).describe("Include competitor-comparison prompt variants in the plan when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      category,
      audience,
      locale,
      platforms,
      competitors,
      topics,
      product_terms,
      personas,
      owned_assets,
      prompt_count,
      cadence,
      include_citation_checks,
      include_competitor_checks,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/ai-visibility/prompt-set",
        {
          data: {
            target,
            category,
            audience,
            locale,
            platforms,
            competitors,
            topics,
            product_terms,
            personas,
            owned_assets,
            prompt_count,
            cadence,
            include_citation_checks,
            include_competitor_checks,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_programmatic_template",
    {
      title: "AgentSEO Programmatic SEO Template",
      description: "Plan safe programmatic SEO templates with uniqueness rules, indexation gates, internal links, schema guidance, and launch QA. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        playbook: z.enum(["templates", "curation", "conversions", "comparisons", "examples", "locations", "personas", "integrations", "glossary", "translations", "directory", "profiles", "custom"]).default("custom").describe("Programmatic SEO template strategy to plan; custom allows a caller-defined pattern. Type: String. Accepted values: \"templates\", \"curation\", \"conversions\", \"comparisons\", \"examples\", \"locations\", \"personas\", \"integrations\", \"glossary\", \"translations\", \"directory\", \"profiles\", \"custom\". Default: \"custom\"."),
        page_goal: z.enum(["traffic", "lead_generation", "trial_signup", "demo_request", "purchase", "authority", "support"]).default("lead_generation").describe("Primary outcome the proposed programmatic pages should support. Type: String. Accepted values: \"traffic\", \"lead_generation\", \"trial_signup\", \"demo_request\", \"purchase\", \"authority\", \"support\". Default: \"lead_generation\"."),
        keyword_pattern: z.string().min(1).max(180).describe("Keyword template with named variables, for example best {category} in {city}. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
        url_pattern: z.string().min(1).max(180).describe("Proposed URL/path template using the supplied variables, for example /{category}/{city}; no URL is published. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
        audience: z.string().max(180).optional().describe("Intended reader or buyer group in plain language; do not include unnecessary personal data. Type: String. Maximum: 180 characters. Optional; no client default."),
        page_count_estimate: z.number().int().min(1).max(1000000).default(100).describe("Estimated number of pages in the proposed rollout, not a request to create that many pages. Type: Safe integer. Minimum: 1. Maximum: 1000000. Default: 100."),
        data_sources: z.array(z.object({
          name: z.string().min(1).max(120).describe("Human-readable name of the supplied dataset or source. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required."),
          type: z.enum(["first_party", "product", "user_generated", "licensed", "public", "manual", "unknown"]).default("unknown").describe("Provenance category of the supplied dataset. Type: String. Accepted values: \"first_party\", \"product\", \"user_generated\", \"licensed\", \"public\", \"manual\", \"unknown\". Default: \"unknown\"."),
          freshness: z.enum(["real_time", "daily", "weekly", "monthly", "quarterly", "static", "unknown"]).default("unknown").describe("Update frequency of the supplied dataset; this does not configure a refresh job. Type: String. Accepted values: \"real_time\", \"daily\", \"weekly\", \"monthly\", \"quarterly\", \"static\", \"unknown\". Default: \"unknown\"."),
          fields: z.array(z.string().min(1).max(80).describe("One available dataset column name. Type: String. Minimum: 1 characters. Maximum: 80 characters. Required.")).max(80).default([]).describe("Column names available in this supplied data source. Type: Array. Maximum: 80 items. Default: []."),
        }).describe("One dataset description with its provenance, freshness and available columns. Type: Object. Required.")).min(1).max(20).describe("Descriptions of the datasets available for the proposed template; no credentials or live dataset connection. Type: Array. Minimum: 1 items. Maximum: 20 items. Required."),
        variables: z.array(z.string().min(1).max(80).describe("One variable name available in the template patterns. Type: String. Minimum: 1 characters. Maximum: 80 characters. Required.")).min(1).max(30).describe("Variable names available for substitution into keyword and URL patterns. Type: Array. Minimum: 1 items. Maximum: 30 items. Required."),
        unique_fields: z.array(z.string().min(1).max(80).describe("One dataset column that provides distinctive page content or evidence. Type: String. Minimum: 1 characters. Maximum: 80 characters. Required.")).max(80).default([]).describe("Dataset column names that provide distinct evidence or value across generated pages. Type: Array. Maximum: 80 items. Default: []."),
        sample_records: z.array(z.record(z.string().describe("Column name for a supplied sample record. Type: String. Required."), z.union([z.string(), z.number(), z.boolean(), z.null()]).describe("Value for the named sample-record column; nested arrays and objects are not accepted. Type: String, number, boolean or null. Required.")).describe("One sample data row keyed by column name; values must be scalar strings, numbers, booleans or null. Type: Object. Required.")).max(10).default([]).describe("Example dataset rows keyed by column name. Values may be strings, numbers, booleans or null, not nested arrays or objects. Type: Array. Maximum: 10 items. Default: []."),
        competitors: z.array(z.string().min(1).max(160).describe("One competing brand or domain name used in the comparison. Type: String. Minimum: 1 characters. Maximum: 160 characters. Required.")).max(20).default([]).describe("Competing brands or domains to compare using the data supplied to this workflow. Type: Array. Maximum: 20 items. Default: []."),
        conversion_cta: z.string().max(120).optional().describe("Proposed conversion call-to-action text for the template; no transaction is initiated. Type: String. Maximum: 120 characters. Optional; no client default."),
        publishing_cadence: z.enum(["pilot", "weekly_batch", "monthly_batch", "bulk_import"]).default("pilot").describe("Proposed rollout pattern for the plan; does not schedule or publish pages. Type: String. Accepted values: \"pilot\", \"weekly_batch\", \"monthly_batch\", \"bulk_import\". Default: \"pilot\"."),
        include_schema: z.boolean().default(true).describe("Include structured-data guidance in the generated plan when true. Type: Boolean. Default: true."),
        include_internal_linking: z.boolean().default(true).describe("Include internal-linking guidance in the plan when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      playbook,
      page_goal,
      keyword_pattern,
      url_pattern,
      audience,
      page_count_estimate,
      data_sources,
      variables,
      unique_fields,
      sample_records,
      competitors,
      conversion_cta,
      publishing_cadence,
      include_schema,
      include_internal_linking,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/programmatic-template",
        {
          data: {
            target,
            playbook,
            page_goal,
            keyword_pattern,
            url_pattern,
            audience,
            page_count_estimate,
            data_sources,
            variables,
            unique_fields,
            sample_records,
            competitors,
            conversion_cta,
            publishing_cadence,
            include_schema,
            include_internal_linking,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_content_cannibalization",
    {
      title: "AgentSEO Content Cannibalization",
      description: "Detect overlapping SEO pages and recommend safe consolidation, differentiation, canonical, and internal-link fixes. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        focus_keywords: z.array(z.string().min(1).max(120).describe("One keyword phrase to emphasize in the page comparison. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(250).default([]).describe("Optional keyword phrases to emphasize when comparing the supplied pages. Type: Array. Maximum: 250 items. Default: []."),
        sensitivity: z.enum(["conservative", "balanced", "aggressive"]).default("balanced").describe("Conservative, balanced or aggressive threshold preset for flagging page overlap. Type: String. Accepted values: \"conservative\", \"balanced\", \"aggressive\". Default: \"balanced\"."),
        pages: z.array(z.object({
          url: z.string().url().describe("Absolute URL identifying this supplied page for overlap analysis; no page fetch is requested by this record. Type: String. Format: absolute URL. Required."),
          title: z.string().min(1).max(180).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
          description: z.string().max(500).optional().describe("Short summary of this supplied page; this is input evidence, not a request to generate a meta description. Type: String. Maximum: 500 characters. Optional; no client default."),
          headings: z.array(z.string().min(1).describe("One existing page heading as plain text. Type: String. Minimum: 1 characters. Required.")).max(30).default([]).describe("Existing page headings as plain-text strings, in reading order when available. Type: Array. Maximum: 30 items. Default: []."),
          primary_keyword: z.string().min(1).max(120).optional().describe("Main keyword phrase assigned to this supplied page. Type: String. Minimum: 1 characters. Maximum: 120 characters. Optional; no client default."),
          target_keywords: z.array(z.string().min(1).max(120).describe("One keyword phrase this supplied page is intended to target. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(50).default([]).describe("Additional keyword phrases this supplied page is intended to target. Type: Array. Maximum: 50 items. Default: []."),
          ranking_queries: z.array(z.string().min(1).max(120).describe("One search query known to rank for this page. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(100).default([]).describe("Search queries known to rank for this page from your supplied evidence. Type: Array. Maximum: 100 items. Default: []."),
          page_type: z
            .enum(["unknown", "homepage", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs"])
            .default("unknown").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"unknown\", \"homepage\", \"blog_post\", \"landing_page\", \"product\", \"software\", \"local_business\", \"comparison_page\", \"guide\", \"docs\". Default: \"unknown\"."),
          canonical_url: z.string().url().optional().describe("Absolute canonical URL reported for this supplied page. Type: String. Format: absolute URL. Optional; no client default."),
          indexable: z.boolean().default(true).describe("Whether this supplied page is considered indexable according to your crawl evidence. Type: Boolean. Default: true."),
          clicks: z.number().min(0).optional().describe("Count of search clicks in your supplied reporting window; use the same window across compared records. Type: Number. Minimum: 0. Optional; no client default."),
          impressions: z.number().min(0).optional().describe("Count of search impressions in your supplied reporting window; use the same window across compared records. Type: Number. Minimum: 0. Optional; no client default."),
          avg_position: z.number().min(1).max(100).optional().describe("Supplied mean organic search position, where 1 is best; not an authority score. Type: Number. Minimum: 1. Maximum: 100. Optional; no client default."),
          backlinks: z.number().min(0).optional().describe("Count of backlinks reported for this supplied page. Type: Number. Minimum: 0. Optional; no client default."),
          last_updated: z.string().max(40).optional().describe("Supplied page update date or timestamp; use YYYY-MM-DD or ISO 8601 when available. Type: String. Maximum: 40 characters. Optional; no client default."),
        }).describe("One supplied page record used in this comparison. Type: Object. Required.")).min(2).max(100).describe("Supplied page records to compare; URLs identify the records and are not instructions to publish changes. Type: Array. Minimum: 2 items. Maximum: 100 items. Required."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ target, focus_keywords, sensitivity, pages, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/cannibalization",
        {
          data: {
            target,
            focus_keywords,
            sensitivity,
            pages,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  const competitorGapPageSchema = z.object({
    url: z.string().url().describe("Absolute URL identifying this supplied own or competitor page; all comparison evidence comes from the supplied record. Type: String. Format: absolute URL. Required."),
    title: z.string().min(1).max(180).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Maximum: 180 characters. Required."),
    description: z.string().max(500).optional().describe("Short summary of this supplied page; this is input evidence, not a request to generate a meta description. Type: String. Maximum: 500 characters. Optional; no client default."),
    keywords: z.array(z.string().min(1).max(120).describe("One search keyword or phrase, not a comma-separated list. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(100).default([]).describe("Search phrases to evaluate or associate with the supplied page. Type: Array. Maximum: 100 items. Default: []."),
    ranking_queries: z.array(z.string().min(1).max(120).describe("One search query known to rank for this page. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(100).default([]).describe("Search queries known to rank for this page from your supplied evidence. Type: Array. Maximum: 100 items. Default: []."),
    page_type: z
      .enum(["unknown", "homepage", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs", "template", "tool", "case_study"])
      .default("unknown").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"unknown\", \"homepage\", \"blog_post\", \"landing_page\", \"product\", \"software\", \"local_business\", \"comparison_page\", \"guide\", \"docs\", \"template\", \"tool\", \"case_study\". Default: \"unknown\"."),
    buyer_stage: z
      .enum(["awareness", "consideration", "decision", "implementation", "retention"])
      .default("awareness").describe("Buyer-journey stage associated with this page or opportunity. Type: String. Accepted values: \"awareness\", \"consideration\", \"decision\", \"implementation\", \"retention\". Default: \"awareness\"."),
    estimated_traffic: z.number().min(0).optional().describe("Estimated search visits for this supplied page; use a consistent time window across compared pages. Type: Number. Minimum: 0. Optional; no client default."),
    search_volume: z.number().min(0).optional().describe("Estimated monthly searches for this supplied keyword or topic, not a measured page-visit count. Type: Number. Minimum: 0. Optional; no client default."),
    avg_position: z.number().min(1).max(100).optional().describe("Supplied mean organic search position, where 1 is best; not an authority score. Type: Number. Minimum: 1. Maximum: 100. Optional; no client default."),
    backlinks: z.number().min(0).optional().describe("Count of backlinks reported for this supplied page. Type: Number. Minimum: 0. Optional; no client default."),
  });

  server.registerTool(
    "agentseo_content_competitor_gap_matrix",
    {
      title: "AgentSEO Competitor Content Gap Matrix",
      description: "Compare supplied own and competitor pages to find missing topics, weak coverage, format gaps, and buyer-stage gaps. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().optional().describe("Your target brand, domain or URL used to scope this workflow; supply the entity you want assessed. Type: String. Optional; no client default."),
        focus_topics: z.array(z.string().min(1).max(120).describe("One topic to prioritize in the competitor comparison. Type: String. Minimum: 1 characters. Maximum: 120 characters. Required.")).max(100).default([]).describe("Topics to prioritize in the supplied competitor content comparison. Type: Array. Maximum: 100 items. Default: []."),
        own_pages: z.array(competitorGapPageSchema.describe("One of your supplied pages, with coverage evidence for comparison. Type: Object. Required.")).max(100).default([]).describe("Your supplied page records for comparison with competitor pages; an empty list represents no supplied owned coverage. Type: Array. Maximum: 100 items. Default: []."),
        competitors: z.array(z.object({
          domain: z.string().min(1).max(160).describe("Website hostname associated with this record, for example example.com rather than a business name. Type: String. Minimum: 1 characters. Maximum: 160 characters. Required."),
          pages: z.array(competitorGapPageSchema.describe("One supplied page record used in this comparison. Type: Object. Required.")).min(1).max(100).describe("Supplied page records to compare; URLs identify the records and are not instructions to publish changes. Type: Array. Minimum: 1 items. Maximum: 100 items. Required."),
        }).describe("One competitor domain with its supplied page records. Type: Object. Required.")).min(1).max(10).describe("Competitor domains with their supplied page records; no competitor crawl is performed. Type: Array. Minimum: 1 items. Maximum: 10 items. Required."),
        max_opportunities: z.number().int().min(1).max(100).default(30).describe("Maximum number of prioritized opportunities to return from the supplied comparison. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 30."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ target, focus_topics, own_pages, competitors, max_opportunities, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/content/competitor-gap-matrix",
        {
          data: {
            target,
            focus_topics,
            own_pages,
            competitors,
            max_opportunities,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_keyword_ideas_suggest",
    {
      title: "AgentSEO Keyword Ideas Suggest",
      description: "Expand one seed keyword into prioritized long-tail keyword ideas with search metrics. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().min(3).describe("Search keyword or phrase to analyze for this workflow. Type: String. Minimum: 3 characters. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        limit: z.number().int().min(5).max(100).default(25).describe("Maximum number of keyword suggestions to return. Type: Safe integer. Minimum: 5. Maximum: 100. Default: 25."),
        min_search_volume: z.number().int().min(0).max(1000000).default(0).describe("Minimum estimated monthly keyword searches to include; zero disables this lower-bound filter. Type: Safe integer. Minimum: 0. Maximum: 1000000. Default: 0."),
        include_seed_keyword: z.boolean().default(true).describe("Include the original seed phrase among returned keyword ideas when true. Type: Boolean. Default: true."),
        exact_match: z.boolean().default(false).describe("Request exact-match keyword filtering rather than broader phrase matching when true. Type: Boolean. Default: false."),
        ignore_synonyms: z.boolean().default(true).describe("Ask the provider not to expand keyword matching to synonyms when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      keyword,
      location,
      location_code,
      language,
      limit,
      min_search_volume,
      include_seed_keyword,
      exact_match,
      ignore_synonyms,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/keyword-ideas/suggest",
        {
          data: {
            keyword,
            location,
            location_code,
            language,
            limit,
            min_search_volume,
            include_seed_keyword,
            exact_match,
            ignore_synonyms,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_keyword_metrics_overview",
    {
      title: "AgentSEO Keyword Metrics Overview",
      description: "Score a supplied keyword list with search metrics and page-priority guidance. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keywords: z.array(z.string().min(1).max(80).describe("One search keyword or phrase, not a comma-separated list. Type: String. Minimum: 1 characters. Maximum: 80 characters. Required.")).min(1).max(100).describe("Search phrases to evaluate or associate with the supplied page. Type: Array. Minimum: 1 items. Maximum: 100 items. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        min_search_volume: z.number().int().min(0).max(1000000).default(0).describe("Minimum estimated monthly keyword searches to include; zero disables this lower-bound filter. Type: Safe integer. Minimum: 0. Maximum: 1000000. Default: 0."),
        sort_by: z.enum(["priority", "search_volume", "cpc", "difficulty"]).default("priority").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"priority\", \"search_volume\", \"cpc\", \"difficulty\". Default: \"priority\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      keywords,
      location,
      location_code,
      language,
      min_search_volume,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/keyword-metrics/overview",
        {
          data: {
            keywords,
            location,
            location_code,
            language,
            min_search_volume,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_domain_ranked_keywords",
    {
      title: "AgentSEO Domain Ranked Keywords",
      description: "Find ranked keywords for a domain, subdomain, or URL and prioritize refresh opportunities. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        limit: z.number().int().min(10).max(250).default(50).describe("Maximum number of ranked keyword records to return. Type: Safe integer. Minimum: 10. Maximum: 250. Default: 50."),
        min_search_volume: z.number().int().min(0).max(1000000).default(0).describe("Minimum estimated monthly keyword searches to include; zero disables this lower-bound filter. Type: Safe integer. Minimum: 0. Maximum: 1000000. Default: 0."),
        max_rank: z.number().int().min(1).max(100).default(100).describe("Worst organic search position to include, where 1 means first. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 100."),
        sort_by: z.enum(["opportunity", "estimated_traffic", "rank", "search_volume", "cpc"]).default("opportunity").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"opportunity\", \"estimated_traffic\", \"rank\", \"search_volume\", \"cpc\". Default: \"opportunity\"."),
        include_lost: z.boolean().default(false).describe("Include historically lost ranking keywords when true. Type: Boolean. Default: false."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      location,
      location_code,
      language,
      limit,
      min_search_volume,
      max_rank,
      sort_by,
      include_lost,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/domain/ranked-keywords",
        {
          data: {
            target,
            location,
            location_code,
            language,
            limit,
            min_search_volume,
            max_rank,
            sort_by,
            include_lost,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_domain_relevant_pages",
    {
      title: "AgentSEO Domain Relevant Pages",
      description: "Find traffic-carrying pages for a domain and route them into protect, refresh, expand, or recover actions. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        limit: z.number().int().min(10).max(250).default(50).describe("Maximum number of traffic-carrying page records to return. Type: Safe integer. Minimum: 10. Maximum: 250. Default: 50."),
        min_traffic: z.number().int().min(0).max(10000000).default(0).describe("Minimum estimated monthly organic search visits a page must have; zero disables this lower-bound filter. Type: Safe integer. Minimum: 0. Maximum: 10000000. Default: 0."),
        historical_serp_mode: z.enum(["live", "lost", "all"]).default("live").describe("Whether to use live, lost or all supported historical search-ranking observations. Type: String. Accepted values: \"live\", \"lost\", \"all\". Default: \"live\"."),
        sort_by: z.enum(["estimated_traffic", "keyword_count", "top3", "opportunity"]).default("estimated_traffic").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"estimated_traffic\", \"keyword_count\", \"top3\", \"opportunity\". Default: \"estimated_traffic\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      location,
      location_code,
      language,
      limit,
      min_traffic,
      historical_serp_mode,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/domain/relevant-pages",
        {
          data: {
            target,
            location,
            location_code,
            language,
            limit,
            min_traffic,
            historical_serp_mode,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_domain_competitors",
    {
      title: "AgentSEO Domain Competitors",
      description: "Discover search competitors for a domain and prioritize overlap, traffic gaps, and next analysis actions. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        limit: z.number().int().min(5).max(250).default(25).describe("Maximum number of competing domain records to return. Type: Safe integer. Minimum: 5. Maximum: 250. Default: 25."),
        min_intersections: z.number().int().min(0).max(10000000).default(0).describe("Minimum count of shared ranking keywords required for a search competitor. Type: Safe integer. Minimum: 0. Maximum: 10000000. Default: 0."),
        max_rank_group: z.number().int().min(1).max(100).default(20).describe("Worst search position included when measuring competitor overlap, where 1 means first. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 20."),
        sort_by: z.enum(["overlap", "competitor_traffic", "traffic_gap", "threat"]).default("threat").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"overlap\", \"competitor_traffic\", \"traffic_gap\", \"threat\". Default: \"threat\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      location,
      location_code,
      language,
      limit,
      min_intersections,
      max_rank_group,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/domain/competitors",
        {
          data: {
            target,
            location,
            location_code,
            language,
            limit,
            min_intersections,
            max_rank_group,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_domain_intersection",
    {
      title: "AgentSEO Domain Intersection",
      description: "Compare two domains to find shared keyword deficits, advantages, and target1-exclusive keyword opportunities. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target1: z.string().min(1).describe("Your comparison target as a domain, subdomain or page URL; results are interpreted relative to this first target. Type: String. Minimum: 1 characters. Required."),
        target2: z.string().min(1).describe("Second domain, subdomain or page URL used as the comparison target. Type: String. Minimum: 1 characters. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        limit: z.number().int().min(5).max(250).default(25).describe("Maximum number of intersecting or target1-exclusive keyword records to return. Type: Safe integer. Minimum: 5. Maximum: 250. Default: 25."),
        intersections: z.boolean().default(true).describe("True requests shared keywords; false requests keywords exclusive to target1. Type: Boolean. Default: true."),
        min_search_volume: z.number().int().min(0).max(10000000).default(0).describe("Minimum estimated monthly keyword searches to include; zero disables this lower-bound filter. Type: Safe integer. Minimum: 0. Maximum: 10000000. Default: 0."),
        sort_by: z.enum(["opportunity", "search_volume", "traffic_gap", "rank_gap", "cpc"]).default("opportunity").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"opportunity\", \"search_volume\", \"traffic_gap\", \"rank_gap\", \"cpc\". Default: \"opportunity\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target1,
      target2,
      location,
      location_code,
      language,
      limit,
      intersections,
      min_search_volume,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/domain/intersection",
        {
          data: {
            target1,
            target2,
            location,
            location_code,
            language,
            limit,
            intersections,
            min_search_volume,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_domain_traffic_estimate",
    {
      title: "AgentSEO Domain Traffic Estimate",
      description: "Compare estimated search traffic across multiple domains, subdomains, or URLs before spending deeper analysis credits. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        targets: z.array(z.string().min(1).describe("One domain, subdomain or absolute page URL included in the comparison. Type: String. Minimum: 1 characters. Required.")).min(1).max(100).describe("Domains, subdomains or URLs to compare; provide the target formats supported by this workflow. Type: Array. Minimum: 1 items. Maximum: 100 items. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        include_paid: z.boolean().default(true).describe("Include estimates for paid-search traffic when true; this does not buy ads. Type: Boolean. Default: true."),
        include_featured_snippet: z.boolean().default(true).describe("Include featured-snippet contributions in the returned estimates when supported. Type: Boolean. Default: true."),
        include_local_pack: z.boolean().default(false).describe("Include local-pack contributions in the returned estimates when supported. Type: Boolean. Default: false."),
        sort_by: z.enum(["organic_traffic", "total_traffic", "paid_traffic", "opportunity", "target"]).default("organic_traffic").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"organic_traffic\", \"total_traffic\", \"paid_traffic\", \"opportunity\", \"target\". Default: \"organic_traffic\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      targets,
      location,
      location_code,
      language,
      include_paid,
      include_featured_snippet,
      include_local_pack,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/domain/traffic-estimate",
        {
          data: {
            targets,
            location,
            location_code,
            language,
            include_paid,
            include_featured_snippet,
            include_local_pack,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_summary",
    {
      title: "AgentSEO Backlinks Summary",
      description: "Summarize backlink authority, referring domains, spam risk, broken backlinks, and next SEO actions for a domain, subdomain, or URL. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        include_indirect_links: z.boolean().default(true).describe("Include backlinks that reach the target through supported indirect/redirect link relationships when true. Type: Boolean. Default: true."),
        exclude_internal_backlinks: z.boolean().default(true).describe("Exclude links originating within the target’s own site when true. Type: Boolean. Default: true."),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live").describe("Backlink lifecycle filter: live links only, lost links only, or all supported links. Type: String. Accepted values: \"live\", \"all\", \"lost\". Default: \"live\"."),
        dofollow_only: z.boolean().default(false).describe("Restrict results to followed backlinks when true; false does not apply that filter. Type: Boolean. Default: false."),
        internal_list_limit: z.number().int().min(1).max(100).default(10).describe("Maximum embedded sample rows per aggregate record; this does not cap the aggregate backlink totals. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 10."),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred").describe("Requested provider authority-score scale: one_hundred is 0-100; one_thousand is 0-1000. Individual filter input bounds still apply. Type: String. Accepted values: \"one_hundred\", \"one_thousand\". Default: \"one_hundred\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      include_subdomains,
      include_indirect_links,
      exclude_internal_backlinks,
      backlinks_status_type,
      dofollow_only,
      internal_list_limit,
      rank_scale,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/summary",
        {
          data: {
            target,
            include_subdomains,
            include_indirect_links,
            exclude_internal_backlinks,
            backlinks_status_type,
            dofollow_only,
            internal_list_limit,
            rank_scale,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_list",
    {
      title: "AgentSEO Backlinks List",
      description: "Return a bounded list of actionable backlinks and classify each one for protection, repair, reclaim, quality review, or outreach reference. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        mode: z.enum(["as_is", "one_per_domain", "one_per_anchor"]).default("one_per_domain").describe("Backlink grouping strategy: raw rows, at most one row per referring domain, or at most one row per anchor. Type: String. Accepted values: \"as_is\", \"one_per_domain\", \"one_per_anchor\". Default: \"one_per_domain\"."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of backlink rows to return for this page of results. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live").describe("Backlink lifecycle filter: live links only, lost links only, or all supported links. Type: String. Accepted values: \"live\", \"all\", \"lost\". Default: \"live\"."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        include_indirect_links: z.boolean().default(true).describe("Include backlinks that reach the target through supported indirect/redirect link relationships when true. Type: Boolean. Default: true."),
        exclude_internal_backlinks: z.boolean().default(true).describe("Exclude links originating within the target’s own site when true. Type: Boolean. Default: true."),
        intersection_mode: z.enum(["all", "partial"]).default("partial").describe("Whether matches must cover every supplied target (all) or a supported subset (partial). Type: String. Accepted values: \"all\", \"partial\". Default: \"partial\"."),
        dofollow_only: z.boolean().default(false).describe("Restrict results to followed backlinks when true; false does not apply that filter. Type: Boolean. Default: false."),
        broken_only: z.boolean().default(false).describe("Restrict results to backlinks associated with broken target pages when true. Type: Boolean. Default: false."),
        min_rank: z.number().int().min(0).max(100).optional().describe("Minimum provider backlink authority score, not a Google search position; use the supported score scale and stated input bounds. Type: Safe integer. Minimum: 0. Maximum: 100. Optional; no client default."),
        sort_by: z.enum(["rank", "page_rank", "first_seen", "lost_date"]).default("rank").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"rank\", \"page_rank\", \"first_seen\", \"lost_date\". Default: \"rank\"."),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred").describe("Requested provider authority-score scale: one_hundred is 0-100; one_thousand is 0-1000. Individual filter input bounds still apply. Type: String. Accepted values: \"one_hundred\", \"one_thousand\". Default: \"one_hundred\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      mode,
      limit,
      offset,
      backlinks_status_type,
      include_subdomains,
      include_indirect_links,
      exclude_internal_backlinks,
      intersection_mode,
      dofollow_only,
      broken_only,
      min_rank,
      sort_by,
      rank_scale,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/list",
        {
          data: {
            target,
            mode,
            limit,
            offset,
            backlinks_status_type,
            include_subdomains,
            include_indirect_links,
            exclude_internal_backlinks,
            intersection_mode,
            dofollow_only,
            broken_only,
            min_rank,
            sort_by,
            rank_scale,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_anchors",
    {
      title: "AgentSEO Backlinks Anchors",
      description: "Analyze backlink anchor text groups and classify branded, commercial, generic, URL, risky, broken, or lost anchor patterns. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of aggregated anchor-text records to return. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        internal_list_limit: z.number().int().min(1).max(100).default(10).describe("Maximum embedded sample rows per aggregate record; this does not cap the aggregate backlink totals. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 10."),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live").describe("Backlink lifecycle filter: live links only, lost links only, or all supported links. Type: String. Accepted values: \"live\", \"all\", \"lost\". Default: \"live\"."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        include_indirect_links: z.boolean().default(true).describe("Include backlinks that reach the target through supported indirect/redirect link relationships when true. Type: Boolean. Default: true."),
        exclude_internal_backlinks: z.boolean().default(true).describe("Exclude links originating within the target’s own site when true. Type: Boolean. Default: true."),
        dofollow_only: z.boolean().default(false).describe("Restrict results to followed backlinks when true; false does not apply that filter. Type: Boolean. Default: false."),
        anchor_filter: z.string().min(1).max(80).optional().describe("Text filter to match backlink anchor text. Type: String. Minimum: 1 characters. Maximum: 80 characters. Optional; no client default."),
        min_backlinks: z.number().int().min(1).max(10000000).optional().describe("Minimum backlink count for an aggregate record to be included. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        min_referring_domains: z.number().int().min(1).max(10000000).optional().describe("Minimum count of distinct referring domains for a record to be included. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        sort_by: z.enum(["backlinks", "rank", "referring_domains", "spam_score", "broken_backlinks"]).default("backlinks").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"backlinks\", \"rank\", \"referring_domains\", \"spam_score\", \"broken_backlinks\". Default: \"backlinks\"."),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred").describe("Requested provider authority-score scale: one_hundred is 0-100; one_thousand is 0-1000. Individual filter input bounds still apply. Type: String. Accepted values: \"one_hundred\", \"one_thousand\". Default: \"one_hundred\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      limit,
      offset,
      internal_list_limit,
      backlinks_status_type,
      include_subdomains,
      include_indirect_links,
      exclude_internal_backlinks,
      dofollow_only,
      anchor_filter,
      min_backlinks,
      min_referring_domains,
      sort_by,
      rank_scale,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/anchors",
        {
          data: {
            target,
            limit,
            offset,
            internal_list_limit,
            backlinks_status_type,
            include_subdomains,
            include_indirect_links,
            exclude_internal_backlinks,
            dofollow_only,
            anchor_filter,
            min_backlinks,
            min_referring_domains,
            sort_by,
            rank_scale,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_referring_domains",
    {
      title: "AgentSEO Backlinks Referring Domains",
      description: "Analyze referring domains and classify authority, lost-domain recovery, broken-link repair, quality review, and outreach patterns. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of referring-domain records to return. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        internal_list_limit: z.number().int().min(1).max(100).default(10).describe("Maximum embedded sample rows per aggregate record; this does not cap the aggregate backlink totals. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 10."),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live").describe("Backlink lifecycle filter: live links only, lost links only, or all supported links. Type: String. Accepted values: \"live\", \"all\", \"lost\". Default: \"live\"."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        include_indirect_links: z.boolean().default(true).describe("Include backlinks that reach the target through supported indirect/redirect link relationships when true. Type: Boolean. Default: true."),
        exclude_internal_backlinks: z.boolean().default(true).describe("Exclude links originating within the target’s own site when true. Type: Boolean. Default: true."),
        dofollow_only: z.boolean().default(false).describe("Restrict results to followed backlinks when true; false does not apply that filter. Type: Boolean. Default: false."),
        domain_filter: z.string().min(1).max(120).optional().describe("Text filter to match the referring domain. Type: String. Minimum: 1 characters. Maximum: 120 characters. Optional; no client default."),
        min_backlinks: z.number().int().min(1).max(10000000).optional().describe("Minimum backlink count for an aggregate record to be included. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        min_referring_pages: z.number().int().min(1).max(10000000).optional().describe("Minimum count of referring pages for a referring-domain record to be included. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        min_rank: z.number().int().min(0).max(1000).optional().describe("Minimum provider backlink authority score, not a Google search position; use the supported score scale and stated input bounds. Type: Safe integer. Minimum: 0. Maximum: 1000. Optional; no client default."),
        sort_by: z.enum(["rank", "backlinks", "referring_pages", "spam_score", "broken_backlinks", "first_seen", "lost_date"]).default("rank").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"rank\", \"backlinks\", \"referring_pages\", \"spam_score\", \"broken_backlinks\", \"first_seen\", \"lost_date\". Default: \"rank\"."),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred").describe("Requested provider authority-score scale: one_hundred is 0-100; one_thousand is 0-1000. Individual filter input bounds still apply. Type: String. Accepted values: \"one_hundred\", \"one_thousand\". Default: \"one_hundred\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      limit,
      offset,
      internal_list_limit,
      backlinks_status_type,
      include_subdomains,
      include_indirect_links,
      exclude_internal_backlinks,
      dofollow_only,
      domain_filter,
      min_backlinks,
      min_referring_pages,
      min_rank,
      sort_by,
      rank_scale,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/referring-domains",
        {
          data: {
            target,
            limit,
            offset,
            internal_list_limit,
            backlinks_status_type,
            include_subdomains,
            include_indirect_links,
            exclude_internal_backlinks,
            dofollow_only,
            domain_filter,
            min_backlinks,
            min_referring_pages,
            min_rank,
            sort_by,
            rank_scale,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_domain_pages",
    {
      title: "AgentSEO Backlinks Domain Pages",
      description: "Analyze backlink-bearing pages and classify linkable assets, broken backlink pages, lost links, refresh candidates, and quality risks. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of linked target-page records to return. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        internal_list_limit: z.number().int().min(1).max(100).default(10).describe("Maximum embedded sample rows per aggregate record; this does not cap the aggregate backlink totals. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 10."),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live").describe("Backlink lifecycle filter: live links only, lost links only, or all supported links. Type: String. Accepted values: \"live\", \"all\", \"lost\". Default: \"live\"."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        exclude_internal_backlinks: z.boolean().default(true).describe("Exclude links originating within the target’s own site when true. Type: Boolean. Default: true."),
        dofollow_only: z.boolean().default(false).describe("Restrict results to followed backlinks when true; false does not apply that filter. Type: Boolean. Default: false."),
        page_filter: z.string().min(1).max(160).optional().describe("Text filter to match the page URL. Type: String. Minimum: 1 characters. Maximum: 160 characters. Optional; no client default."),
        title_filter: z.string().min(1).max(160).optional().describe("Text filter to match the reported page title. Type: String. Minimum: 1 characters. Maximum: 160 characters. Optional; no client default."),
        status_code: z.number().int().min(100).max(599).optional().describe("HTTP response status code, for example 200 or 404; not an application job status. Type: Safe integer. Minimum: 100. Maximum: 599. Optional; no client default."),
        min_backlinks: z.number().int().min(1).max(10000000).optional().describe("Minimum backlink count for an aggregate record to be included. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        min_referring_domains: z.number().int().min(1).max(10000000).optional().describe("Minimum count of distinct referring domains for a record to be included. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        min_words: z.number().int().min(1).max(1000000).optional().describe("Minimum reported page word count for inclusion. Type: Safe integer. Minimum: 1. Maximum: 1000000. Optional; no client default."),
        sort_by: z.enum(["backlinks", "referring_domains", "rank", "spam_score", "broken_backlinks", "first_visited", "words_count", "external_links"]).default("backlinks").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"backlinks\", \"referring_domains\", \"rank\", \"spam_score\", \"broken_backlinks\", \"first_visited\", \"words_count\", \"external_links\". Default: \"backlinks\"."),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred").describe("Requested provider authority-score scale: one_hundred is 0-100; one_thousand is 0-1000. Individual filter input bounds still apply. Type: String. Accepted values: \"one_hundred\", \"one_thousand\". Default: \"one_hundred\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      limit,
      offset,
      internal_list_limit,
      backlinks_status_type,
      include_subdomains,
      exclude_internal_backlinks,
      dofollow_only,
      page_filter,
      title_filter,
      status_code,
      min_backlinks,
      min_referring_domains,
      min_words,
      sort_by,
      rank_scale,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/domain-pages",
        {
          data: {
            target,
            limit,
            offset,
            internal_list_limit,
            backlinks_status_type,
            include_subdomains,
            exclude_internal_backlinks,
            dofollow_only,
            page_filter,
            title_filter,
            status_code,
            min_backlinks,
            min_referring_domains,
            min_words,
            sort_by,
            rank_scale,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_competitors",
    {
      title: "AgentSEO Backlinks Competitors",
      description: "Discover backlink-profile competitors and prioritize overlap, authority, and link-gap research actions. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of backlink competitor records to return. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        min_rank: z.number().int().min(0).max(1000).optional().describe("Minimum provider backlink authority score, not a Google search position; use the supported score scale and stated input bounds. Type: Safe integer. Minimum: 0. Maximum: 1000. Optional; no client default."),
        min_intersections: z.number().int().min(1).max(10000000).optional().describe("Minimum count of shared referring domains required for a backlink competitor. Type: Safe integer. Minimum: 1. Maximum: 10000000. Optional; no client default."),
        main_domain: z.boolean().default(true).describe("Compare competitor backlinks at the main-domain level when true. Type: Boolean. Default: true."),
        exclude_large_domains: z.boolean().default(true).describe("Exclude very large general-purpose domains from competitor recommendations when true. Type: Boolean. Default: true."),
        sort_by: z.enum(["rank", "intersections", "opportunity"]).default("opportunity").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"rank\", \"intersections\", \"opportunity\". Default: \"opportunity\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      limit,
      offset,
      min_rank,
      min_intersections,
      main_domain,
      exclude_large_domains,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/competitors",
        {
          data: {
            target,
            limit,
            offset,
            min_rank,
            min_intersections,
            main_domain,
            exclude_large_domains,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_new_lost_timeseries",
    {
      title: "AgentSEO Backlinks New/Lost Timeseries",
      description: "Track new and lost backlinks/referring domains over time and classify link momentum, leakage, and volatility. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Beginning of the requested reporting date range in YYYY-MM-DD format. Type: String. Format must match /^\\d{4}-\\d{2}-\\d{2}$/. Optional; no client default."),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End of the requested reporting date range in YYYY-MM-DD format; must not precede date_from. Type: String. Format must match /^\\d{4}-\\d{2}-\\d{2}$/. Optional; no client default."),
        group_range: z.enum(["day", "week", "month", "year"]).default("month").describe("Calendar interval used to aggregate the new/lost backlink time series. Type: String. Accepted values: \"day\", \"week\", \"month\", \"year\". Default: \"month\"."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      date_from,
      date_to,
      group_range,
      include_subdomains,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/new-lost-timeseries",
        {
          data: {
            target,
            date_from,
            date_to,
            group_range,
            include_subdomains,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_page_intersection",
    {
      title: "AgentSEO Backlinks Page Intersection",
      description: "Find source pages that link to competitor targets but not excluded/user targets, then prioritize link-gap outreach and quality review. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        targets: z.array(z.string().min(1).describe("One domain, subdomain or absolute page URL included in the comparison. Type: String. Minimum: 1 characters. Required.")).min(1).max(5).describe("Domains, subdomains or URLs to compare; provide the target formats supported by this workflow. Type: Array. Minimum: 1 items. Maximum: 5 items. Required."),
        exclude_targets: z.array(z.string().min(1).describe("One target whose existing link relationships should be excluded. Type: String. Minimum: 1 characters. Required.")).max(5).default([]).describe("Targets whose existing backlinks should be excluded from the candidate intersection set. Type: Array. Maximum: 5 items. Default: []."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of source-page backlink intersection records to return. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        internal_list_limit: z.number().int().min(1).max(100).default(10).describe("Maximum embedded sample rows per aggregate record; this does not cap the aggregate backlink totals. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 10."),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live").describe("Backlink lifecycle filter: live links only, lost links only, or all supported links. Type: String. Accepted values: \"live\", \"all\", \"lost\". Default: \"live\"."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        include_indirect_links: z.boolean().default(true).describe("Include backlinks that reach the target through supported indirect/redirect link relationships when true. Type: Boolean. Default: true."),
        exclude_internal_backlinks: z.boolean().default(true).describe("Exclude links originating within the target’s own site when true. Type: Boolean. Default: true."),
        dofollow_only: z.boolean().default(false).describe("Restrict results to followed backlinks when true; false does not apply that filter. Type: Boolean. Default: false."),
        broken_only: z.boolean().default(false).describe("Restrict results to backlinks associated with broken target pages when true. Type: Boolean. Default: false."),
        min_rank: z.number().int().min(0).max(1000).optional().describe("Minimum provider backlink authority score, not a Google search position; use the supported score scale and stated input bounds. Type: Safe integer. Minimum: 0. Maximum: 1000. Optional; no client default."),
        min_domain_rank: z.number().int().min(0).max(1000).optional().describe("Minimum referring-domain authority score on the provider score scale, not a search position. Type: Safe integer. Minimum: 0. Maximum: 1000. Optional; no client default."),
        min_page_rank: z.number().int().min(0).max(1000).optional().describe("Minimum referring-page authority score on the provider score scale, not a search position. Type: Safe integer. Minimum: 0. Maximum: 1000. Optional; no client default."),
        max_spam_score: z.number().int().min(0).max(100).optional().describe("Maximum tolerated provider backlink spam score on a 0-100 scale; lower values are stricter. Type: Safe integer. Minimum: 0. Maximum: 100. Optional; no client default."),
        sort_by: z.enum(["rank", "domain_rank", "page_rank", "first_seen", "last_seen"]).default("rank").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"rank\", \"domain_rank\", \"page_rank\", \"first_seen\", \"last_seen\". Default: \"rank\"."),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred").describe("Requested provider authority-score scale: one_hundred is 0-100; one_thousand is 0-1000. Individual filter input bounds still apply. Type: String. Accepted values: \"one_hundred\", \"one_thousand\". Default: \"one_hundred\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      targets,
      exclude_targets,
      limit,
      offset,
      internal_list_limit,
      backlinks_status_type,
      include_subdomains,
      include_indirect_links,
      exclude_internal_backlinks,
      dofollow_only,
      broken_only,
      min_rank,
      min_domain_rank,
      min_page_rank,
      max_spam_score,
      sort_by,
      rank_scale,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/page-intersection",
        {
          data: {
            targets,
            exclude_targets,
            limit,
            offset,
            internal_list_limit,
            backlinks_status_type,
            include_subdomains,
            include_indirect_links,
            exclude_internal_backlinks,
            dofollow_only,
            broken_only,
            min_rank,
            min_domain_rank,
            min_page_rank,
            max_spam_score,
            sort_by,
            rank_scale,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_backlinks_opportunity_finder",
    {
      title: "AgentSEO Backlinks Opportunity Finder",
      description: "Turn supplied backlink prospects, competitor link gaps, and owned assets into prioritized safe outreach, reclaim, repair, and digital PR actions. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: suppliedDataToolAnnotations,
      inputSchema: {
        target: z.string().min(1).describe("Target domain, subdomain or absolute page URL to analyze; use a hostname or URL, not a business name. Type: String. Minimum: 1 characters. Required."),
        campaign_goal: z.enum(["mixed", "link_gap", "broken_link_building", "digital_pr", "resource_page", "reclaim_lost_links", "protect_authority"]).default("mixed").describe("Backlink campaign objective used to prioritize supplied prospects; does not send outreach. Type: String. Accepted values: \"mixed\", \"link_gap\", \"broken_link_building\", \"digital_pr\", \"resource_page\", \"reclaim_lost_links\", \"protect_authority\". Default: \"mixed\"."),
        prospects: z.array(z.object({
          source_domain: z.string().min(1).describe("Referring or prospective publisher hostname, for example publisher.example. Type: String. Minimum: 1 characters. Required."),
          source_url: z.string().url().optional().describe("Source page URL associated with this record or analysis; use an absolute web URL. Type: String. Format: absolute URL. Optional; no client default."),
          title: z.string().optional().describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Optional; no client default."),
          source_type: z.enum(["resource_page", "article", "directory", "tool_list", "news", "partner", "unknown"]).default("unknown").describe("Classification of the prospective linking page or publisher. Type: String. Accepted values: \"resource_page\", \"article\", \"directory\", \"tool_list\", \"news\", \"partner\", \"unknown\". Default: \"unknown\"."),
          linked_competitors: z.array(z.string().describe("One competitor hostname already linked by this prospect. Type: String. Required.")).default([]).describe("Competitor hostnames already linked from this prospect according to your supplied evidence. Type: Array. Default: []."),
          topics: z.array(z.string().describe("One topic or theme relevant to the supplied entity. Type: String. Required.")).default([]).describe("Relevant topics or themes associated with this target, page or prospect. Type: Array. Default: []."),
          domain_rank: z.number().min(0).max(1000).optional().describe("Supplied domain authority score on the provider 0-1000 scale. Type: Number. Minimum: 0. Maximum: 1000. Optional; no client default."),
          page_rank: z.number().min(0).max(1000).optional().describe("Supplied page authority score on the provider 0-1000 scale. Type: Number. Minimum: 0. Maximum: 1000. Optional; no client default."),
          spam_score: z.number().min(0).max(100).optional().describe("Supplied provider spam score on a 0-100 scale; higher means greater spam risk. Type: Number. Minimum: 0. Maximum: 100. Optional; no client default."),
          traffic_estimate: z.number().min(0).optional().describe("Supplied estimated search visits for this prospect; keep the reporting window consistent across prospects. Type: Number. Minimum: 0. Optional; no client default."),
          dofollow: z.boolean().optional().describe("Whether the observed prospect link is followed according to your supplied evidence; omit when unknown. Type: Boolean. Optional; no client default."),
          broken_link: z.boolean().default(false).describe("Whether your supplied evidence identifies a broken-link replacement opportunity. Type: Boolean. Default: false."),
          lost_link: z.boolean().default(false).describe("Whether your supplied evidence identifies a previously lost link to reclaim. Type: Boolean. Default: false."),
          context: z.string().optional().describe("Supplied surrounding link text or relevance notes used to assess this prospect. Type: String. Optional; no client default."),
          notes: z.string().optional().describe("Additional supplied context relevant to this record; exclude credentials and unnecessary personal data. Type: String. Optional; no client default."),
        }).describe("One supplied backlink prospect and its observed relevance/quality evidence. Type: Object. Required.")).min(1).max(250).describe("Supplied backlink prospect records to score; this does not discover prospects or contact their owners. Type: Array. Minimum: 1 items. Maximum: 250 items. Required."),
        owned_assets: z.array(z.object({
          url: z.string().url().describe("Absolute URL of a supplied asset you own that prospects could link to; this does not fetch or publish it. Type: String. Format: absolute URL. Required."),
          title: z.string().min(1).describe("Title of the supplied page or work item, used as its human-readable label. Type: String. Minimum: 1 characters. Required."),
          page_type: z.enum(["research", "tool", "guide", "template", "comparison", "case_study", "landing_page", "other"]).default("other").describe("Page format or classification for this record; select one of the accepted values. Type: String. Accepted values: \"research\", \"tool\", \"guide\", \"template\", \"comparison\", \"case_study\", \"landing_page\", \"other\". Default: \"other\"."),
          topics: z.array(z.string().describe("One topic or theme relevant to the supplied entity. Type: String. Required.")).default([]).describe("Relevant topics or themes associated with this target, page or prospect. Type: Array. Default: []."),
          linkable_reason: z.string().optional().describe("Reason this owned asset would be useful for a publisher to cite or link to. Type: String. Optional; no client default."),
        }).describe("One page or resource you own, supplied as evidence for the plan. Type: Object. Required.")).default([]).describe("Supplied pages or resources you own that can support prompts or backlink recommendations; this does not edit or publish them. Type: Array. Default: []."),
        competitor_domains: z.array(z.string().describe("One competitor hostname to consider when scoring link gaps. Type: String. Required.")).default([]).describe("Competitor hostnames to count when evaluating supplied link gaps. Type: Array. Default: []."),
        existing_backlink_domains: z.array(z.string().describe("One hostname already linking to your site. Type: String. Required.")).default([]).describe("Hostnames already linking to your site, used to distinguish new prospects from existing relationships. Type: Array. Default: []."),
        max_opportunities: z.number().int().min(1).max(50).default(20).describe("Maximum number of prioritized opportunities to return from the supplied comparison. Type: Safe integer. Minimum: 1. Maximum: 50. Default: 20."),
        min_priority: z.enum(["low", "medium", "high"]).default("medium").describe("Lowest recommended prospect priority to include in the result. Type: String. Accepted values: \"low\", \"medium\", \"high\". Default: \"medium\"."),
        max_spam_score: z.number().int().min(0).max(100).default(35).describe("Maximum tolerated provider backlink spam score on a 0-100 scale; lower values are stricter. Type: Safe integer. Minimum: 0. Maximum: 100. Default: 35."),
        include_outreach_angles: z.boolean().default(true).describe("Include draft outreach ideas in the result when true; no email or message is sent. Type: Boolean. Default: true."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      target,
      campaign_goal,
      prospects,
      owned_assets,
      competitor_domains,
      existing_backlink_domains,
      max_opportunities,
      min_priority,
      max_spam_score,
      include_outreach_angles,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/backlinks/opportunity-finder",
        {
          data: {
            target,
            campaign_goal,
            prospects,
            owned_assets,
            competitor_domains,
            existing_backlink_domains,
            max_opportunities,
            min_priority,
            max_spam_score,
            include_outreach_angles,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_page_intersection",
    {
      title: "AgentSEO Page Intersection",
      description: "Compare ranking pages to find shared page keywords or competitor-page keywords excluded from your pages. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        pages: z.array(z.string().url().describe("One absolute page URL whose ranking keywords should be compared. Type: String. Format: absolute URL. Required.")).min(1).max(5).describe("Absolute page URLs whose ranking keywords should be compared; these are URLs, not supplied page objects. Type: Array. Minimum: 1 items. Maximum: 5 items. Required."),
        exclude_pages: z.array(z.string().url().describe("One absolute page URL to exclude from the keyword intersection. Type: String. Format: absolute URL. Required.")).max(5).default([]).describe("Absolute page URLs to exclude from the keyword intersection comparison. Type: Array. Maximum: 5 items. Default: []."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        location_code: z.number().int().positive().optional().describe("Numeric provider location identifier for the search market; the service validates support alongside the location name. Type: Safe integer. Must be greater than 0. Optional; no client default."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        item_types: z.array(z.enum(["organic", "paid", "featured_snippet", "local_pack"]).describe("One search-result category to include in the comparison. Type: String. Accepted values: \"organic\", \"paid\", \"featured_snippet\", \"local_pack\". Required.")).min(1).max(4).default(["organic", "featured_snippet"]).describe("Search-result categories to include in the page intersection analysis. Type: Array. Minimum: 1 items. Maximum: 4 items. Default: [\"organic\",\"featured_snippet\"]."),
        limit: z.number().int().min(5).max(100).default(25).describe("Maximum number of keyword intersection records to return. Type: Safe integer. Minimum: 5. Maximum: 100. Default: 25."),
        offset: z.number().int().min(0).max(20000).default(0).describe("Zero-based result offset measured in rows; use with limit for pagination. Type: Safe integer. Minimum: 0. Maximum: 20000. Default: 0."),
        include_subdomains: z.boolean().default(true).describe("Include links or ranking data for subdomains of the target when true. Type: Boolean. Default: true."),
        intersection_mode: z.enum(["union", "intersect"]).default("union").describe("Whether matches must cover every supplied target (all) or a supported subset (partial). Type: String. Accepted values: \"union\", \"intersect\". Default: \"union\"."),
        include_serp_info: z.boolean().default(false).describe("Include provider search-result context in the returned records when true. Type: Boolean. Default: false."),
        include_clickstream_data: z.boolean().default(false).describe("Request available provider clickstream-derived estimates when true; these are not your own analytics measurements. Type: Boolean. Default: false."),
        ignore_synonyms: z.boolean().default(true).describe("Ask the provider not to expand keyword matching to synonyms when true. Type: Boolean. Default: true."),
        min_search_volume: z.number().int().min(0).max(10000000).default(0).describe("Minimum estimated monthly keyword searches to include; zero disables this lower-bound filter. Type: Safe integer. Minimum: 0. Maximum: 10000000. Default: 0."),
        max_rank: z.number().int().min(1).max(100).default(30).describe("Worst organic search position to include, where 1 means first. Type: Safe integer. Minimum: 1. Maximum: 100. Default: 30."),
        sort_by: z.enum(["opportunity", "search_volume", "traffic_gap", "rank", "cpc"]).default("opportunity").describe("Metric used to order returned results; choose one of this tool’s accepted enum values. Type: String. Accepted values: \"opportunity\", \"search_volume\", \"traffic_gap\", \"rank\", \"cpc\". Default: \"opportunity\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({
      pages,
      exclude_pages,
      location,
      location_code,
      language,
      item_types,
      limit,
      offset,
      include_subdomains,
      intersection_mode,
      include_serp_info,
      include_clickstream_data,
      ignore_synonyms,
      min_search_volume,
      max_rank,
      sort_by,
      sync,
    }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/pages/intersection",
        {
          data: {
            pages,
            exclude_pages,
            location,
            location_code,
            language,
            item_types,
            limit,
            offset,
            include_subdomains,
            intersection_mode,
            include_serp_info,
            include_clickstream_data,
            ignore_synonyms,
            min_search_volume,
            max_rank,
            sort_by,
          },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_ai_overview_extract",
    {
      title: "AgentSEO AI Overview Extract",
      description: "Extract AI Overview insights for a target keyword. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        target_domain: z.string().optional().describe("Your hostname, for example example.com, to check against sampled AI Overview candidate domains; this is not official citation attribution. Type: String. Optional; no client default."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ keyword, location, language, target_domain, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/ai-overview/extract",
        {
          data: { keyword, location, language, target_domain },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_local_visibility_track",
    {
      title: "AgentSEO Local Visibility Track",
      description: "Track local visibility for a domain across keywords and locations. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        domain: z.string().describe("Website hostname to track across the supplied keywords and markets, for example example.com. Type: String. Required."),
        keywords: z.array(z.string().describe("One search keyword or phrase, not a comma-separated list. Type: String. Required.")).min(1).max(5).describe("Search phrases to evaluate or associate with the supplied page. Type: Array. Minimum: 1 items. Maximum: 5 items. Required."),
        locations: z.array(z.string().describe("One supported geographic market name, for example Austin, Texas, United States. Type: String. Required.")).min(1).max(3).describe("Supported geographic market names to check, for example Austin, Texas, United States; each keyword/location combination contributes work. Type: Array. Minimum: 1 items. Maximum: 3 items. Required."),
        language: z.string().default("en").describe("Supported search language code, for example en for English. Type: String. Default: \"en\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ domain, keywords, locations, language, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/local-visibility/track",
        {
          data: { domain, keywords, locations, language },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_rank_track",
    {
      title: "AgentSEO Rank Track",
      description: "Queue a rank tracking check for a URL and keyword. Uses AgentSEO credits; repeating the call can create new charged work.",
      annotations: billableToolAnnotations,
      inputSchema: {
        keyword: z.string().describe("Search keyword or phrase to analyze for this workflow. Type: String. Required."),
        url: z.string().url().describe("Absolute web page URL to analyze; use an http:// or https:// URL. Type: String. Format: absolute URL. Required."),
        location: z.string().default("United States").describe("Supported geographic search-market name, for example United States; this is not a coordinate pair. Type: String. Default: \"United States\"."),
        sync: z.boolean().default(true).describe("Request a bounded wait for completion when true. The API can still return a pending job; retain its job ID and poll agentseo_job_status instead of repeating this charged call. False returns a queued job without waiting. Type: Boolean. Default: true."),
      },
    },
    async ({ keyword, url, location, sync }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        "/rank/track",
        {
          data: { keyword, url, location },
          params: { sync },
        },
      );
      return jsonContent(result);
    },
  );

  server.registerTool(
    "agentseo_job_status",
    {
      title: "AgentSEO Job Status",
      description: "Get status/result for an existing job. Polling can resume pending work; it does not debit credits again. Repeat polls refer to the same job.",
      annotations: jobStatusAnnotations,
      inputSchema: {
        job_id: z.string().describe("UUID job identifier previously returned by AgentSEO; it must belong to the connected API-key account. Polling may resume existing pending work without a second debit. Type: String. Required."),
      },
    },
    async ({ job_id }) => {
      const result = await callAgentSeoApi(
        apiBaseUrl,
        apiKey,
        projectId,
        workflowId,
        `/jobs/${job_id}`,
        {
          method: "GET",
        },
      );
      return jsonContent(result);
    },
  );

  return server;
}
