# Contributing

Thanks for helping improve the AgentSEO clients.

Good contributions include:

- SDK bug fixes
- typed request/response improvements
- documentation fixes
- MCP tool ergonomics
- examples for agent workflows

Please keep this repository focused on public client code. Do not add hosted API implementation, provider adapters, private transformations, billing code, internal prompts, or customer data.

Before opening a pull request:

```bash
cd packages/js-sdk && npm install && npm run build
cd ../mcp-server && npm install && npm run build
cd ../python-sdk && python -m pip install -e .
```

Use clear, small pull requests where possible.
