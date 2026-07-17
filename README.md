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
npm install @agentseo/sdk
```

```ts
import { AgentSEO } from "@agentseo/sdk";

const client = new AgentSEO({
  apiKey: process.env.AGENTSEO_API_KEY!,
});

const result = await client.search(
  { query: "seo api", location: "United States", limit: 5 },
  { sync: true },
);

console.log(result);
```

Use the Python SDK:

```bash
pip install agentseo-sdk
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
