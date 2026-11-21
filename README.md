# AgentSEO Clients

Official open-source clients for [AgentSEO](https://www.agentseo.dev), the SEO intelligence API for AI agents and developer workflows.

This repository contains the integration layer only:

- `packages/js-sdk` - JavaScript/TypeScript SDK
- `packages/python-sdk` - Python SDK
- `packages/mcp-server` - Model Context Protocol server

The hosted AgentSEO API, worker system, provider orchestration, billing, and transformation logic are not part of this repository.

## Quick Start

Use the JavaScript SDK:

```bash
npm install @agentseo/sdk@0.1.1
```

```js
import { AgentSEO } from "@agentseo/sdk";

const apiKey = process.env.AGENTSEO_API_KEY;
if (!apiKey) throw new Error("Set AGENTSEO_API_KEY");
const client = new AgentSEO({ apiKey, timeoutMs: 10_000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pollExistingJob(jobId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await client.getJob(jobId);
    if (status.status === "completed") {
      if (status.result == null) throw new Error("Completed job has no result");
      return status;
    }
    if (status.status === "failed") {
      throw new Error(status.error?.message || "Job failed");
    }
    if (!["queued", "pending", "processing", "retrying"].includes(status.status)) {
      throw new Error("Unexpected job status: " + status.status);
    }
    await sleep(Math.min(2_000, Math.max(0, deadline - Date.now())));
  }
  throw new Error("Polling deadline reached. Resume job " + jobId + "; do not resubmit.");
}

// Submit once. Polling does not submit another billable request.
const job = await client.search({
  "query": "seo api",
  "location": "United States",
  "limit": 5
});
if (typeof job.jobId !== "string" || !job.jobId) throw new Error("Missing job ID");
console.error("Job:", job.jobId);
const status = await pollExistingJob(job.jobId);
console.log(JSON.stringify(status.result, null, 2));
```

Use the Python SDK:

Use an activated Python 3.9+ virtual environment and install from the official
source repository. The import check makes no API requests. For setup without an
SDK, use the [REST quickstart](https://www.agentseo.dev/docs/quickstart).

```bash
git clone https://github.com/AgentSEO-dev/agentseo-clients.git
cd agentseo-clients
python -m pip install ./packages/python-sdk
python -c "from agentseo_sdk import AgentSEOClient; print('AgentSEOClient import OK')"
```

```python
from agentseo_sdk import AgentSEOClient

client = AgentSEOClient(api_key="sk_live_...")
result = client.search(query="seo api", sync=True)
print(result)
```

Use the MCP server:

```bash
export AGENTSEO_API_KEY="sk_live_your_key"
npx -y @agentseo/mcp-server
```

## Development

Build the JavaScript SDK:

```bash
cd packages/js-sdk
npm install
npm run build
```

Build the MCP server:

```bash
cd packages/mcp-server
npm install
npm run build
```

Install the Python SDK locally:

```bash
cd packages/python-sdk
python -m pip install -e .
```

## Security

Do not commit API keys, `.env` files, customer payloads, or provider credentials. See [SECURITY.md](SECURITY.md).

## License

MIT. See package-level `LICENSE` files.
