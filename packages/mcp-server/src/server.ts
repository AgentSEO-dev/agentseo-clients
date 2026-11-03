import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type ApiMethod = "GET" | "POST";

type AgentSeoMcpServerOptions = {
  apiBaseUrl: string;
  apiKey: string;
  projectId?: string;
  workflowId?: string;
};

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
      description: "Perform a Google search with optional domain filters.",
      inputSchema: {
        query: z.string().describe("The search query"),
        limit: z.number().int().min(1).max(50).default(10),
        include_domains: z.array(z.string()).optional(),
        exclude_domains: z.array(z.string()).optional(),
        sync: z.boolean().default(true),
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
      description: "Extract content from a URL and convert to Markdown.",
      inputSchema: {
        url: z.string().url().describe("The URL to scrape"),
        include_images: z.boolean().default(false),
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
        "Deep analysis of Search Engine Results Page (SERP) features and competitors.",
      inputSchema: {
        keyword: z.string().describe("Target keyword"),
        location: z.string().default("United States"),
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        language: z.string().default("en"),
        sync: z.boolean().default(true),
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
      description: "Audit one Google Maps business listing. Provide its business name and city/state/country; do not pass a website URL or domain.",
      inputSchema: {
        business_name: z.string().describe("Business name as shown on Google Maps, not a domain or URL"),
        location: z.string().describe("City, state, and country of the business"),
        language: z.string().default("en"),
        sync: z.boolean().default(true),
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
      description: "Run content gap analysis for a URL and keyword.",
      inputSchema: {
        url: z.string().url().describe("Your URL"),
        keyword: z.string().describe("Target keyword"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        scrape_depth: z.enum(["h1", "h2", "h3"]).default("h3"),
        sync: z.boolean().default(true),
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
      description: "Find prioritized SEO opportunities for a domain or URL.",
      inputSchema: {
        target: z.string().describe("Domain or URL to analyze"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        keyword_limit: z.number().int().min(1).max(100).default(25),
        opportunity_limit: z.number().int().min(1).max(25).default(10),
        include_serp_competitors: z.boolean().default(false),
        include_competitor_discovery: z.boolean().default(false),
        sync: z.boolean().default(true),
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
      description: "Turn one keyword or page opportunity into an implementation-ready brief.",
      inputSchema: {
        keyword: z.string().describe("Selected opportunity keyword"),
        target: z.string().describe("Target domain or URL"),
        page_url: z.string().url().optional(),
        location: z.string().default("United States"),
        language: z.string().default("en"),
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
          .optional(),
        current_rank: z.number().int().min(1).max(100).optional(),
        include_competitor_outlines: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Create a refresh brief for an existing URL and keyword.",
      inputSchema: {
        url: z.string().url().describe("Existing page URL"),
        keyword: z.string().describe("Target keyword"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        scrape_depth: z.enum(["h1", "h2", "h3"]).default("h3"),
        sync: z.boolean().default(true),
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
      description: "Turn live SERP intent into a writer- and agent-ready page outline.",
      inputSchema: {
        keyword: z.string().describe("Target keyword"),
        target: z.string().optional().describe("Optional target brand or domain"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        outline_depth: z.enum(["brief", "standard", "detailed"]).default("standard"),
        include_title_options: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Turn live SERP intent into a production-ready content brief for writers and coding agents.",
      inputSchema: {
        keyword: z.string().describe("Target keyword"),
        target: z.string().optional().describe("Optional target brand, domain, or product"),
        audience: z.string().optional().describe("Optional audience description"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        brand_voice: z.enum(["neutral", "expert", "friendly", "bold", "technical"]).default("expert"),
        page_type: z
          .enum(["auto", "blog_post", "landing_page", "comparison_page", "guide", "tool_page"])
          .default("auto"),
        brief_depth: z.enum(["standard", "detailed"]).default("standard"),
        include_serp_outline: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Validate a draft URL or markdown against live SERP expectations before publishing.",
      inputSchema: {
        keyword: z.string().describe("Target keyword"),
        draft_url: z.string().url().optional().describe("Draft or staged page URL"),
        draft_markdown: z.string().min(100).max(50000).optional().describe("Draft markdown when no URL exists"),
        target: z.string().optional().describe("Optional target brand, domain, or product"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        qa_depth: z.enum(["standard", "strict"]).default("standard"),
        sync: z.boolean().default(true),
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
      description: "Plan JSON-LD schema for a URL or markdown page without a provider call.",
      inputSchema: {
        url: z.string().url().optional().describe("Page URL to scrape"),
        page_markdown: z.string().min(80).max(50000).optional().describe("Page markdown when no URL exists"),
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
          .default("auto"),
        keyword: z.string().optional(),
        target: z.string().optional().describe("Optional target brand, domain, or product"),
        include_jsonld: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Find internal link opportunities from a source page to required supplied target pages.",
      inputSchema: {
        source_url: z.string().url().optional().describe("Source page URL to scrape"),
        source_markdown: z.string().min(80).max(50000).optional().describe("Source page markdown when no URL exists"),
        keyword: z.string().optional(),
        target: z.string().optional().describe("Optional target brand, domain, or product"),
        max_suggestions: z.number().int().min(1).max(20).default(8),
        target_pages: z
          .array(
            z.object({
              url: z.string().url(),
              title: z.string().min(1).max(180),
              description: z.string().max(500).optional(),
              keywords: z.array(z.string()).max(12).default([]),
            }),
          )
          .min(1)
          .max(50)
          .optional()
          .describe("Required candidate internal pages from your sitemap, CMS, crawler, Search Console, or /site/sitemap-audit."),
        sync: z.boolean().default(true),
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
      description: "Generate SEO title and meta description options for a URL or markdown page.",
      inputSchema: {
        url: z.string().url().optional().describe("Page URL to scrape"),
        page_markdown: z.string().min(80).max(50000).optional().describe("Page markdown when no URL exists"),
        keyword: z.string().min(1),
        target: z.string().optional().describe("Optional target brand, domain, or product"),
        page_type: z
          .enum(["auto", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide"])
          .default("auto"),
        current_title: z.string().max(120).optional(),
        current_meta_description: z.string().max(320).optional(),
        sync: z.boolean().default(true),
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
      description: "Map supplied keywords to supplied pages and flag missing pages or cannibalization risks.",
      inputSchema: {
        keywords: z.array(z.string().min(1)).min(1).max(250),
        pages: z
          .array(
            z.object({
              url: z.string().url(),
              title: z.string().min(1).max(180),
              description: z.string().max(500).optional(),
              headings: z.array(z.string().min(1)).max(30).default([]),
              current_keywords: z.array(z.string().min(1)).max(30).default([]),
              page_type: z
                .enum(["unknown", "homepage", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs"])
                .default("unknown"),
            }),
          )
          .min(1)
          .max(100),
        target: z.string().optional().describe("Optional target brand, domain, or product"),
        max_mappings: z.number().int().min(1).max(250).default(250),
        sync: z.boolean().default(true),
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
      description: "Run pre-publish SEO QA for metadata, indexability, canonical, headings, schema, links, and media.",
      inputSchema: {
        url: z.string().url().optional(),
        html: z.string().min(80).max(250000).optional(),
        markdown: z.string().min(80).max(50000).optional(),
        keyword: z.string().min(1).optional(),
        target: z.string().optional(),
        expected_canonical: z.string().url().optional(),
        page_type: z
          .enum(["auto", "article", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs"])
          .default("auto"),
        check_external_links: z.boolean().default(false),
        sync: z.boolean().default(true),
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
      description: "Turn supplied SEO opportunities into a capacity-aware content calendar and execution plan.",
      inputSchema: {
        target: z.string().optional(),
        goal: z
          .enum(["traffic_growth", "lead_generation", "refresh_decay", "launch_support", "authority_building"])
          .default("traffic_growth"),
        horizon_days: z.number().int().min(7).max(90).default(30),
        weekly_capacity: z.number().int().min(1).max(25).default(5),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        team: z.array(z.string().min(1).max(80)).max(20).default([]),
        items: z.array(z.object({
          title: z.string().min(1).max(180),
          keyword: z.string().min(1).max(120).optional(),
          url: z.string().url().optional(),
          source_endpoint: z.string().max(120).optional(),
          opportunity_type: z
            .enum(["new_content", "refresh", "technical_fix", "internal_links", "schema", "backlink_outreach", "monitoring"])
            .default("new_content"),
          buyer_stage: z
            .enum(["awareness", "consideration", "decision", "implementation", "retention"])
            .default("awareness"),
          priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
          impact_score: z.number().min(0).max(100).optional(),
          effort: z.enum(["small", "medium", "large"]).default("medium"),
          status: z.enum(["idea", "ready", "blocked", "in_progress"]).default("idea"),
          dependencies: z.array(z.string().min(1).max(160)).max(10).default([]),
          notes: z.string().max(1000).optional(),
        })).min(1).max(100),
        sync: z.boolean().default(true),
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
      description: "Audit sitemap coverage, orphan-page candidates, important URLs, canonical/indexability noise, and internal-link gaps.",
      inputSchema: {
        target: z.string().optional(),
        sitemap_url: z.string().url().optional(),
        sitemap_xml: z.string().min(80).max(2000000).optional(),
        max_sitemap_children: z.number().int().min(0).max(10).default(3),
        important_urls: z.array(z.string().url()).max(500).default([]),
        crawl_urls: z.array(z.object({
          url: z.string().url(),
          source: z.string().max(80).optional(),
          title: z.string().max(180).optional(),
          status_code: z.number().int().min(100).max(599).optional(),
          indexable: z.boolean().default(true),
          canonical_url: z.string().url().optional(),
          inbound_internal_links: z.number().int().min(0).optional(),
          clicks: z.number().min(0).optional(),
          impressions: z.number().min(0).optional(),
        })).max(5000).default([]),
        internal_links: z.array(z.object({
          source_url: z.string().url(),
          target_url: z.string().url(),
          anchor: z.string().max(160).optional(),
        })).max(20000).default([]),
        sync: z.boolean().default(true),
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
      description: "Compare supplied SERP snapshots to detect rank churn, top-domain churn, feature changes, and target visibility movement.",
      inputSchema: {
        target: z.string().optional(),
        keyword: z.string().min(1),
        location: z.string().default("United States"),
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        sensitivity: z.enum(["low", "medium", "high"]).default("medium"),
        target_domains: z.array(z.string().min(1).max(180)).max(10).default([]),
        snapshots: z.array(z.object({
          checked_at: z.string().min(1),
          serp_features: z.array(z.string().min(1).max(80)).max(30).default([]),
          results: z.array(z.object({
            position: z.number().int().min(1).max(100),
            url: z.string().url(),
            title: z.string().max(240).optional(),
            domain: z.string().max(180).optional(),
            result_type: z.enum(["organic", "paid", "local_pack", "featured_snippet", "ai_overview", "people_also_ask", "video", "image", "news", "other"]).default("organic"),
          })).min(1).max(100),
        })).min(2).max(30),
        sync: z.boolean().default(true),
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
      description: "Audit SEO landing pages for value proposition clarity, CTA strength, trust proof, objection handling, and conversion friction.",
      inputSchema: {
        url: z.string().url().optional(),
        html: z.string().min(80).max(250000).optional(),
        markdown: z.string().min(80).max(50000).optional(),
        target: z.string().optional(),
        keyword: z.string().optional(),
        page_type: z.enum(["auto", "homepage", "landing_page", "pricing", "feature", "blog_post", "product", "comparison_page", "docs"]).default("auto"),
        conversion_goal: z.enum(["signup", "trial", "demo", "purchase", "contact_sales", "subscribe", "download", "learn_more"]).default("signup"),
        traffic_source: z.enum(["organic", "paid", "email", "social", "direct", "referral", "unknown"]).default("organic"),
        audience: z.string().max(180).optional(),
        sync: z.boolean().default(true),
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
      description: "Build stable AI visibility prompt sets mapped to owned assets, platforms, competitors, citations, and weekly action routing.",
      inputSchema: {
        target: z.string().min(1),
        category: z.string().min(1).max(160),
        audience: z.string().max(180).optional(),
        locale: z.string().min(2).max(80).default("United States"),
        platforms: z.array(z.enum(["chatgpt", "perplexity", "google_ai", "gemini", "copilot", "claude"])).min(1).max(6).default(["chatgpt", "perplexity", "google_ai"]),
        competitors: z.array(z.string().min(1).max(160)).max(20).default([]),
        topics: z.array(z.string().min(1).max(120)).min(1).max(40),
        product_terms: z.array(z.string().min(1).max(120)).max(40).default([]),
        personas: z.array(z.string().min(1).max(120)).max(20).default([]),
        owned_assets: z.array(z.object({
          url: z.string().url(),
          title: z.string().min(1).max(180),
          page_type: z.enum(["homepage", "docs", "blog_post", "comparison", "pricing", "product", "case_study", "tool", "other"]).default("other"),
          topics: z.array(z.string().min(1).max(120)).max(20).default([]),
        })).max(100).default([]),
        prompt_count: z.number().int().min(6).max(50).default(20),
        cadence: z.enum(["weekly", "biweekly", "monthly"]).default("weekly"),
        include_citation_checks: z.boolean().default(true),
        include_competitor_checks: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Plan safe programmatic SEO templates with uniqueness rules, indexation gates, internal links, schema guidance, and launch QA.",
      inputSchema: {
        target: z.string().optional(),
        playbook: z.enum(["templates", "curation", "conversions", "comparisons", "examples", "locations", "personas", "integrations", "glossary", "translations", "directory", "profiles", "custom"]).default("custom"),
        page_goal: z.enum(["traffic", "lead_generation", "trial_signup", "demo_request", "purchase", "authority", "support"]).default("lead_generation"),
        keyword_pattern: z.string().min(1).max(180),
        url_pattern: z.string().min(1).max(180),
        audience: z.string().max(180).optional(),
        page_count_estimate: z.number().int().min(1).max(1000000).default(100),
        data_sources: z.array(z.object({
          name: z.string().min(1).max(120),
          type: z.enum(["first_party", "product", "user_generated", "licensed", "public", "manual", "unknown"]).default("unknown"),
          freshness: z.enum(["real_time", "daily", "weekly", "monthly", "quarterly", "static", "unknown"]).default("unknown"),
          fields: z.array(z.string().min(1).max(80)).max(80).default([]),
        })).min(1).max(20),
        variables: z.array(z.string().min(1).max(80)).min(1).max(30),
        unique_fields: z.array(z.string().min(1).max(80)).max(80).default([]),
        sample_records: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(10).default([]),
        competitors: z.array(z.string().min(1).max(160)).max(20).default([]),
        conversion_cta: z.string().max(120).optional(),
        publishing_cadence: z.enum(["pilot", "weekly_batch", "monthly_batch", "bulk_import"]).default("pilot"),
        include_schema: z.boolean().default(true),
        include_internal_linking: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Detect overlapping SEO pages and recommend safe consolidation, differentiation, canonical, and internal-link fixes.",
      inputSchema: {
        target: z.string().optional(),
        focus_keywords: z.array(z.string().min(1).max(120)).max(250).default([]),
        sensitivity: z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
        pages: z.array(z.object({
          url: z.string().url(),
          title: z.string().min(1).max(180),
          description: z.string().max(500).optional(),
          headings: z.array(z.string().min(1)).max(30).default([]),
          primary_keyword: z.string().min(1).max(120).optional(),
          target_keywords: z.array(z.string().min(1).max(120)).max(50).default([]),
          ranking_queries: z.array(z.string().min(1).max(120)).max(100).default([]),
          page_type: z
            .enum(["unknown", "homepage", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs"])
            .default("unknown"),
          canonical_url: z.string().url().optional(),
          indexable: z.boolean().default(true),
          clicks: z.number().min(0).optional(),
          impressions: z.number().min(0).optional(),
          avg_position: z.number().min(1).max(100).optional(),
          backlinks: z.number().min(0).optional(),
          last_updated: z.string().max(40).optional(),
        })).min(2).max(100),
        sync: z.boolean().default(true),
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
    url: z.string().url(),
    title: z.string().min(1).max(180),
    description: z.string().max(500).optional(),
    keywords: z.array(z.string().min(1).max(120)).max(100).default([]),
    ranking_queries: z.array(z.string().min(1).max(120)).max(100).default([]),
    page_type: z
      .enum(["unknown", "homepage", "blog_post", "landing_page", "product", "software", "local_business", "comparison_page", "guide", "docs", "template", "tool", "case_study"])
      .default("unknown"),
    buyer_stage: z
      .enum(["awareness", "consideration", "decision", "implementation", "retention"])
      .default("awareness"),
    estimated_traffic: z.number().min(0).optional(),
    search_volume: z.number().min(0).optional(),
    avg_position: z.number().min(1).max(100).optional(),
    backlinks: z.number().min(0).optional(),
  });

  server.registerTool(
    "agentseo_content_competitor_gap_matrix",
    {
      title: "AgentSEO Competitor Content Gap Matrix",
      description: "Compare supplied own and competitor pages to find missing topics, weak coverage, format gaps, and buyer-stage gaps.",
      inputSchema: {
        target: z.string().optional(),
        focus_topics: z.array(z.string().min(1).max(120)).max(100).default([]),
        own_pages: z.array(competitorGapPageSchema).max(100).default([]),
        competitors: z.array(z.object({
          domain: z.string().min(1).max(160),
          pages: z.array(competitorGapPageSchema).min(1).max(100),
        })).min(1).max(10),
        max_opportunities: z.number().int().min(1).max(100).default(30),
        sync: z.boolean().default(true),
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
      description: "Expand one seed keyword into prioritized long-tail keyword ideas with search metrics.",
      inputSchema: {
        keyword: z.string().min(3).describe("Seed keyword or topic"),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        limit: z.number().int().min(5).max(100).default(25),
        min_search_volume: z.number().int().min(0).max(1000000).default(0),
        include_seed_keyword: z.boolean().default(true),
        exact_match: z.boolean().default(false),
        ignore_synonyms: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Score a supplied keyword list with search metrics and page-priority guidance.",
      inputSchema: {
        keywords: z.array(z.string().min(1).max(80)).min(1).max(100),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        min_search_volume: z.number().int().min(0).max(1000000).default(0),
        sort_by: z.enum(["priority", "search_volume", "cpc", "difficulty"]).default("priority"),
        sync: z.boolean().default(true),
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
      description: "Find ranked keywords for a domain, subdomain, or URL and prioritize refresh opportunities.",
      inputSchema: {
        target: z.string().min(1),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        limit: z.number().int().min(10).max(250).default(50),
        min_search_volume: z.number().int().min(0).max(1000000).default(0),
        max_rank: z.number().int().min(1).max(100).default(100),
        sort_by: z.enum(["opportunity", "estimated_traffic", "rank", "search_volume", "cpc"]).default("opportunity"),
        include_lost: z.boolean().default(false),
        sync: z.boolean().default(true),
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
      description: "Find traffic-carrying pages for a domain and route them into protect, refresh, expand, or recover actions.",
      inputSchema: {
        target: z.string().min(1),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        limit: z.number().int().min(10).max(250).default(50),
        min_traffic: z.number().int().min(0).max(10000000).default(0),
        historical_serp_mode: z.enum(["live", "lost", "all"]).default("live"),
        sort_by: z.enum(["estimated_traffic", "keyword_count", "top3", "opportunity"]).default("estimated_traffic"),
        sync: z.boolean().default(true),
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
      description: "Discover search competitors for a domain and prioritize overlap, traffic gaps, and next analysis actions.",
      inputSchema: {
        target: z.string().min(1),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        limit: z.number().int().min(5).max(250).default(25),
        min_intersections: z.number().int().min(0).max(10000000).default(0),
        max_rank_group: z.number().int().min(1).max(100).default(20),
        sort_by: z.enum(["overlap", "competitor_traffic", "traffic_gap", "threat"]).default("threat"),
        sync: z.boolean().default(true),
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
      description: "Compare two domains to find shared keyword deficits, advantages, and target1-exclusive keyword opportunities.",
      inputSchema: {
        target1: z.string().min(1),
        target2: z.string().min(1),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        limit: z.number().int().min(5).max(250).default(25),
        intersections: z.boolean().default(true),
        min_search_volume: z.number().int().min(0).max(10000000).default(0),
        sort_by: z.enum(["opportunity", "search_volume", "traffic_gap", "rank_gap", "cpc"]).default("opportunity"),
        sync: z.boolean().default(true),
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
      description: "Compare estimated search traffic across multiple domains, subdomains, or URLs before spending deeper analysis credits.",
      inputSchema: {
        targets: z.array(z.string().min(1)).min(1).max(100),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        include_paid: z.boolean().default(true),
        include_featured_snippet: z.boolean().default(true),
        include_local_pack: z.boolean().default(false),
        sort_by: z.enum(["organic_traffic", "total_traffic", "paid_traffic", "opportunity", "target"]).default("organic_traffic"),
        sync: z.boolean().default(true),
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
      description: "Summarize backlink authority, referring domains, spam risk, broken backlinks, and next SEO actions for a domain, subdomain, or URL.",
      inputSchema: {
        target: z.string().min(1),
        include_subdomains: z.boolean().default(true),
        include_indirect_links: z.boolean().default(true),
        exclude_internal_backlinks: z.boolean().default(true),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live"),
        dofollow_only: z.boolean().default(false),
        internal_list_limit: z.number().int().min(1).max(100).default(10),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred"),
        sync: z.boolean().default(true),
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
      description: "Return a bounded list of actionable backlinks and classify each one for protection, repair, reclaim, quality review, or outreach reference.",
      inputSchema: {
        target: z.string().min(1),
        mode: z.enum(["as_is", "one_per_domain", "one_per_anchor"]).default("one_per_domain"),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live"),
        include_subdomains: z.boolean().default(true),
        include_indirect_links: z.boolean().default(true),
        exclude_internal_backlinks: z.boolean().default(true),
        intersection_mode: z.enum(["all", "partial"]).default("partial"),
        dofollow_only: z.boolean().default(false),
        broken_only: z.boolean().default(false),
        min_rank: z.number().int().min(0).max(100).optional(),
        sort_by: z.enum(["rank", "page_rank", "first_seen", "lost_date"]).default("rank"),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred"),
        sync: z.boolean().default(true),
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
      description: "Analyze backlink anchor text groups and classify branded, commercial, generic, URL, risky, broken, or lost anchor patterns.",
      inputSchema: {
        target: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        internal_list_limit: z.number().int().min(1).max(100).default(10),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live"),
        include_subdomains: z.boolean().default(true),
        include_indirect_links: z.boolean().default(true),
        exclude_internal_backlinks: z.boolean().default(true),
        dofollow_only: z.boolean().default(false),
        anchor_filter: z.string().min(1).max(80).optional(),
        min_backlinks: z.number().int().min(1).max(10000000).optional(),
        min_referring_domains: z.number().int().min(1).max(10000000).optional(),
        sort_by: z.enum(["backlinks", "rank", "referring_domains", "spam_score", "broken_backlinks"]).default("backlinks"),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred"),
        sync: z.boolean().default(true),
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
      description: "Analyze referring domains and classify authority, lost-domain recovery, broken-link repair, quality review, and outreach patterns.",
      inputSchema: {
        target: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        internal_list_limit: z.number().int().min(1).max(100).default(10),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live"),
        include_subdomains: z.boolean().default(true),
        include_indirect_links: z.boolean().default(true),
        exclude_internal_backlinks: z.boolean().default(true),
        dofollow_only: z.boolean().default(false),
        domain_filter: z.string().min(1).max(120).optional(),
        min_backlinks: z.number().int().min(1).max(10000000).optional(),
        min_referring_pages: z.number().int().min(1).max(10000000).optional(),
        min_rank: z.number().int().min(0).max(1000).optional(),
        sort_by: z.enum(["rank", "backlinks", "referring_pages", "spam_score", "broken_backlinks", "first_seen", "lost_date"]).default("rank"),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred"),
        sync: z.boolean().default(true),
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
      description: "Analyze backlink-bearing pages and classify linkable assets, broken backlink pages, lost links, refresh candidates, and quality risks.",
      inputSchema: {
        target: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        internal_list_limit: z.number().int().min(1).max(100).default(10),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live"),
        include_subdomains: z.boolean().default(true),
        exclude_internal_backlinks: z.boolean().default(true),
        dofollow_only: z.boolean().default(false),
        page_filter: z.string().min(1).max(160).optional(),
        title_filter: z.string().min(1).max(160).optional(),
        status_code: z.number().int().min(100).max(599).optional(),
        min_backlinks: z.number().int().min(1).max(10000000).optional(),
        min_referring_domains: z.number().int().min(1).max(10000000).optional(),
        min_words: z.number().int().min(1).max(1000000).optional(),
        sort_by: z.enum(["backlinks", "referring_domains", "rank", "spam_score", "broken_backlinks", "first_visited", "words_count", "external_links"]).default("backlinks"),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred"),
        sync: z.boolean().default(true),
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
      description: "Discover backlink-profile competitors and prioritize overlap, authority, and link-gap research actions.",
      inputSchema: {
        target: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        min_rank: z.number().int().min(0).max(1000).optional(),
        min_intersections: z.number().int().min(1).max(10000000).optional(),
        main_domain: z.boolean().default(true),
        exclude_large_domains: z.boolean().default(true),
        sort_by: z.enum(["rank", "intersections", "opportunity"]).default("opportunity"),
        sync: z.boolean().default(true),
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
      description: "Track new and lost backlinks/referring domains over time and classify link momentum, leakage, and volatility.",
      inputSchema: {
        target: z.string().min(1),
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        group_range: z.enum(["day", "week", "month", "year"]).default("month"),
        include_subdomains: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Find source pages that link to competitor targets but not excluded/user targets, then prioritize link-gap outreach and quality review.",
      inputSchema: {
        targets: z.array(z.string().min(1)).min(1).max(5),
        exclude_targets: z.array(z.string().min(1)).max(5).default([]),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        internal_list_limit: z.number().int().min(1).max(100).default(10),
        backlinks_status_type: z.enum(["live", "all", "lost"]).default("live"),
        include_subdomains: z.boolean().default(true),
        include_indirect_links: z.boolean().default(true),
        exclude_internal_backlinks: z.boolean().default(true),
        dofollow_only: z.boolean().default(false),
        broken_only: z.boolean().default(false),
        min_rank: z.number().int().min(0).max(1000).optional(),
        min_domain_rank: z.number().int().min(0).max(1000).optional(),
        min_page_rank: z.number().int().min(0).max(1000).optional(),
        max_spam_score: z.number().int().min(0).max(100).optional(),
        sort_by: z.enum(["rank", "domain_rank", "page_rank", "first_seen", "last_seen"]).default("rank"),
        rank_scale: z.enum(["one_hundred", "one_thousand"]).default("one_hundred"),
        sync: z.boolean().default(true),
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
      description: "Turn supplied backlink prospects, competitor link gaps, and owned assets into prioritized safe outreach, reclaim, repair, and digital PR actions.",
      inputSchema: {
        target: z.string().min(1),
        campaign_goal: z.enum(["mixed", "link_gap", "broken_link_building", "digital_pr", "resource_page", "reclaim_lost_links", "protect_authority"]).default("mixed"),
        prospects: z.array(z.object({
          source_domain: z.string().min(1),
          source_url: z.string().url().optional(),
          title: z.string().optional(),
          source_type: z.enum(["resource_page", "article", "directory", "tool_list", "news", "partner", "unknown"]).default("unknown"),
          linked_competitors: z.array(z.string()).default([]),
          topics: z.array(z.string()).default([]),
          domain_rank: z.number().min(0).max(1000).optional(),
          page_rank: z.number().min(0).max(1000).optional(),
          spam_score: z.number().min(0).max(100).optional(),
          traffic_estimate: z.number().min(0).optional(),
          dofollow: z.boolean().optional(),
          broken_link: z.boolean().default(false),
          lost_link: z.boolean().default(false),
          context: z.string().optional(),
          notes: z.string().optional(),
        })).min(1).max(250),
        owned_assets: z.array(z.object({
          url: z.string().url(),
          title: z.string().min(1),
          page_type: z.enum(["research", "tool", "guide", "template", "comparison", "case_study", "landing_page", "other"]).default("other"),
          topics: z.array(z.string()).default([]),
          linkable_reason: z.string().optional(),
        })).default([]),
        competitor_domains: z.array(z.string()).default([]),
        existing_backlink_domains: z.array(z.string()).default([]),
        max_opportunities: z.number().int().min(1).max(50).default(20),
        min_priority: z.enum(["low", "medium", "high"]).default("medium"),
        max_spam_score: z.number().int().min(0).max(100).default(35),
        include_outreach_angles: z.boolean().default(true),
        sync: z.boolean().default(true),
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
      description: "Compare ranking pages to find shared page keywords or competitor-page keywords excluded from your pages.",
      inputSchema: {
        pages: z.array(z.string().url()).min(1).max(5),
        exclude_pages: z.array(z.string().url()).max(5).default([]),
        location: z.string().default("United States"),
        location_code: z.number().int().positive().optional(),
        language: z.string().default("en"),
        item_types: z.array(z.enum(["organic", "paid", "featured_snippet", "local_pack"])).min(1).max(4).default(["organic", "featured_snippet"]),
        limit: z.number().int().min(5).max(100).default(25),
        offset: z.number().int().min(0).max(20000).default(0),
        include_subdomains: z.boolean().default(true),
        intersection_mode: z.enum(["union", "intersect"]).default("union"),
        include_serp_info: z.boolean().default(false),
        include_clickstream_data: z.boolean().default(false),
        ignore_synonyms: z.boolean().default(true),
        min_search_volume: z.number().int().min(0).max(10000000).default(0),
        max_rank: z.number().int().min(1).max(100).default(30),
        sort_by: z.enum(["opportunity", "search_volume", "traffic_gap", "rank", "cpc"]).default("opportunity"),
        sync: z.boolean().default(true),
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
      description: "Extract AI Overview insights for a target keyword.",
      inputSchema: {
        keyword: z.string().describe("Target keyword"),
        location: z.string().default("United States"),
        language: z.string().default("en"),
        target_domain: z.string().optional(),
        sync: z.boolean().default(true),
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
      description: "Track local visibility for a domain across keywords and locations.",
      inputSchema: {
        domain: z.string().describe("Domain to track"),
        keywords: z.array(z.string()).min(1).max(5),
        locations: z.array(z.string()).min(1).max(3),
        language: z.string().default("en"),
        sync: z.boolean().default(true),
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
      description: "Queue a rank tracking check for a URL and keyword.",
      inputSchema: {
        keyword: z.string().describe("Keyword to track"),
        url: z.string().url().describe("URL to track"),
        location: z.string().default("United States"),
        sync: z.boolean().default(true),
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
      description: "Get status/result for a previously queued job.",
      inputSchema: {
        job_id: z.string().describe("Job ID"),
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
