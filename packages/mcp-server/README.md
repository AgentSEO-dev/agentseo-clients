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

`Run agentseo_local_audit for example.com in New York, NY`

## Environment Variables

- `AGENTSEO_API_KEY` (required): Your workspace API key.
- `AGENTSEO_API_URL` (optional): Defaults to `https://www.agentseo.dev/api/v1`.
  - For local development use `http://localhost:3000/api/v1`.
- `AGENTSEO_PROJECT_ID` (optional): Default project attribution for all tool calls.
- `AGENTSEO_WORKFLOW_ID` (optional): Default workflow attribution for all tool calls.

## Available Tools

- `agentseo_search`
- `agentseo_extract`
- `agentseo_analyze_serp`
- `agentseo_local_audit`
- `agentseo_local_audit_batch`
- `agentseo_content_gap`
- `agentseo_web_mentions` (preferred; alias: `agentseo_social_listen`)
- `agentseo_ai_overview_extract`
- `agentseo_local_visibility_track`
- `agentseo_llm_mentions_track`
- `agentseo_content_decay_detect`
- `agentseo_keyword_cluster_build`
- `agentseo_rank_track`
- `agentseo_rank_history`
- `agentseo_job_status`

`agentseo_ai_overview_extract` also accepts an optional `target_domain` when you want Claude or another MCP client to check whether your site appears in the sampled candidate set for an AI Overview query.

## Local Run (Without Claude)

```bash
AGENTSEO_API_KEY="sk_live_your_key" npx -y @agentseo/mcp-server
```

If startup succeeds, you should see:

`AgentSEO MCP Server running on stdio`
