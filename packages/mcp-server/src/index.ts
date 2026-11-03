#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { createAgentSeoMcpServer } from "./server.js";

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

const apiKey = API_KEY;

async function main() {
  const server = createAgentSeoMcpServer({
    apiBaseUrl: API_BASE_URL,
    apiKey,
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AgentSEO MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
