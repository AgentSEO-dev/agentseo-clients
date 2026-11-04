# @agentseo/mcp-server

The official Model Context Protocol (MCP) server for AgentSEO. Exposes SEO tools to Claude Desktop, Cursor, and other MCP clients.

## Hosted remote MCP

AgentSEO also exposes a hosted remote MCP endpoint:

`https://www.agentseo.dev/mcp`

Use a server-side API key with no allowed domains.

### Claude Code

```bash
claude mcp add --transport http agentseo https://www.agentseo.dev/mcp \
  --header "Authorization: Bearer sk_live_your_key" \
  --header "x-project-id: client-alpha" \
  --header "x-workflow-id: nightly-refresh"
```

### Cursor

```json
{
  "mcpServers": {
    "agentseo": {
      "url": "https://www.agentseo.dev/mcp",
      "headers": {
        "Authorization": "Bearer sk_live_your_key",
        "x-project-id": "client-alpha",
        "x-workflow-id": "nightly-refresh"
      }
    }
  }
}
```

## Quickstart (Claude Desktop / Cursor)

### 1. Set your API key

```bash
export AGENTSEO_API_KEY="sk_live_your_key"
```

### 2. Add AgentSEO MCP server to your MCP config

For Claude Desktop, add this to `claude_desktop_config.json`.
For Cursor, add the same block in MCP settings:

```json
{
  "mcpServers": {
    "agentseo": {
      "command": "npx",
      "args": ["-y", "@agentseo/mcp-server"],
      "env": {
        "AGENTSEO_API_KEY": "sk_live_your_key",
        "AGENTSEO_API_URL": "https://www.agentseo.dev/api/v1",
        "AGENTSEO_PROJECT_ID": "client-alpha",
        "AGENTSEO_WORKFLOW_ID": "nightly-refresh"
      }
    }
  }
}
```

### 3. Restart your MCP client

After restart, ask Claude or Cursor:

`Run agentseo_local_audit for Example Dental in Austin, Texas, United States`

## Environment Variables

- `AGENTSEO_API_KEY` (required): Your workspace API key.
- `AGENTSEO_API_URL` (optional): Defaults to `https://www.agentseo.dev/api/v1`.
  - For local development use `http://localhost:3000/api/v1`.
- `AGENTSEO_PROJECT_ID` (optional): Default project attribution for all tool calls.
- `AGENTSEO_WORKFLOW_ID` (optional): Default workflow attribution for all tool calls.

## Available Tools

### Safety and input metadata

All 45 tools declare explicit MCP `readOnlyHint`, `destructiveHint`,
`idempotentHint` and `openWorldHint` values. These are behavior hints, not access
controls or permission to spend credits.

- The 44 analysis tools consume existing AgentSEO credits and may create durable
  jobs or other charged work, including workflows that only transform supplied
  data. They are **not read-only**. Credit consumption is flagged as destructive.
  The client does not send an idempotency key, so repeating a call can create
  another charge; these tools declare `idempotentHint: false`.
- `agentseo_job_status` can resume pending work, so it is also **not read-only**.
  It polls the same job without an additional debit and declares
  `destructiveHint: false` and `idempotentHint: true`.
- `openWorldHint: false` is limited to these supplied-data-only workflows:
  `agentseo_content_keyword_map`, `agentseo_content_action_plan`,
  `agentseo_serp_volatility`, `agentseo_ai_visibility_prompt_set`,
  `agentseo_content_programmatic_template`, `agentseo_content_cannibalization`,
  `agentseo_content_competitor_gap_matrix` and
  `agentseo_backlinks_opportunity_finder`. They still call AgentSEO and consume
  credits. The other tools can query or fetch external data, including when
  pending work is resumed by job polling.

`tools/list` documents every input property, including nested page, crawl,
snapshot, prospect and sample-record fields. Descriptions state purpose, formats,
units, accepted enum values, bounds and client defaults where applicable.
For example, weekly planning capacity is measured in effort points, result
offsets are zero-based row offsets, and a synchronous request can still return a
pending job. Poll its returned job ID instead of repeating the charged analysis.

### Provider-free contract checks

From this package directory, run:

```bash
npm ci --workspaces=false
npm test --workspaces=false
```

The tests build the package, verify all 45 tools' metadata recursively and compare
validation rules/defaults with a pre-metadata schema fixture. They also initialize
the real stdio entry point and call `tools/list` using only dummy credentials, an
empty working directory and a preload that blocks network access. Invalid-input
rejection is checked without executing any live analysis or provider request.

These checks cover the npm client, independently of the hosted `/mcp` and
`/mcp/oauth` endpoints. A local build does not publish a new npm version.

### Tool catalog

- `agentseo_search`
- `agentseo_extract`
- `agentseo_analyze_serp`
- `agentseo_local_audit`
- `agentseo_content_gap`
- `agentseo_opportunities_find`
- `agentseo_opportunities_brief`
- `agentseo_content_refresh_brief`
- `agentseo_content_serp_outline`
- `agentseo_content_brief`
- `agentseo_content_draft_qa`
- `agentseo_content_schema_plan`
- `agentseo_content_internal_links`
- `agentseo_content_title_meta`
- `agentseo_content_keyword_map`
- `agentseo_content_technical_qa`
- `agentseo_content_action_plan`
- `agentseo_site_sitemap_audit`
- `agentseo_serp_volatility`
- `agentseo_page_cro_qa`
- `agentseo_ai_visibility_prompt_set`
- `agentseo_content_programmatic_template`
- `agentseo_content_cannibalization`
- `agentseo_content_competitor_gap_matrix`
- `agentseo_keyword_ideas_suggest`
- `agentseo_keyword_metrics_overview`
- `agentseo_domain_ranked_keywords`
- `agentseo_domain_relevant_pages`
- `agentseo_domain_competitors`
- `agentseo_domain_intersection`
- `agentseo_domain_traffic_estimate`
- `agentseo_backlinks_summary`
- `agentseo_backlinks_list`
- `agentseo_backlinks_anchors`
- `agentseo_backlinks_referring_domains`
- `agentseo_backlinks_domain_pages`
- `agentseo_backlinks_competitors`
- `agentseo_backlinks_new_lost_timeseries`
- `agentseo_backlinks_page_intersection`
- `agentseo_backlinks_opportunity_finder`
- `agentseo_page_intersection`
- `agentseo_ai_overview_extract`
- `agentseo_local_visibility_track`
- `agentseo_rank_track`
- `agentseo_job_status`

`agentseo_ai_overview_extract` also accepts an optional `target_domain` when you want Claude or another MCP client to check whether your site appears in the sampled candidate set for an AI Overview query.

`agentseo_content_internal_links` requires `target_pages`; pass 1-50 candidate internal pages from your sitemap, CMS, crawler, Search Console, or `agentseo_site_sitemap_audit`.

## Local Run (Without Claude)

```bash
AGENTSEO_API_KEY="sk_live_your_key" npx -y @agentseo/mcp-server
```

If startup succeeds, you should see:

`AgentSEO MCP Server running on stdio`
