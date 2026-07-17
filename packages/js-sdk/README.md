# @agentseo/sdk

Official JavaScript SDK for AgentSEO.

## Install

```bash
npm install @agentseo/sdk
```

## Quickstart (Node.js ESM)

Create `demo.mjs`:

```ts
import { AgentSEO } from "@agentseo/sdk";

const client = new AgentSEO({
  apiKey: process.env.AGENTSEO_API_KEY!,
  baseUrl: "https://www.agentseo.dev",
  projectId: "client-alpha",
  workflowId: "nightly-refresh",
});

const job = await client.analyzeSerp({
  keyword: "seo agency austin",
  location: "Austin, TX",
  location_code: 1026201,
});

console.log(job.jobId);
console.log(await client.getJob(job.jobId));
```

Run it:

```bash
export AGENTSEO_API_KEY="sk_live_your_key"
node demo.mjs
```

## Async Jobs (queue + poll)

By default, requests are queued (`sync: false`) and return a job object.

```ts
const job = await client.contentGap({
  url: "https://example.com/blog/post",
  keyword: "best project management software",
});

const result = await client.getJob(job.jobId);
```

Set `projectId` and `workflowId` once on the client when you want usage, jobs, and budgets grouped by agent workflow. You can also override them per request:

```ts
await client.search(
  { query: "best crm software" },
  { projectId: "client-beta", workflowId: "manual-research" },
);
```

For geo-targeted endpoints, pass `location_code` when you need deterministic targeting:

```ts
await client.search({
  query: "best crm software",
  location: "Austin, TX",
  location_code: 1026201,
  limit: 5,
});
```

For AI Overview checks, pass `target_domain` when the agent needs to know whether your site is present in the sampled candidate set:

```ts
await client.aiOverviewExtract({
  keyword: "best seo agency",
  location: "Austin, TX",
  location_code: 1026201,
  target_domain: "example.com",
});
```

## Error Handling

```ts
import { AgentSEOError } from "@agentseo/sdk";

try {
  await client.search({ query: "agentic seo tools" }, { sync: true });
} catch (error) {
  if (error instanceof AgentSEOError) {
    console.error(error.status, error.message, error.details);
  }
}
```

## API Surface

- `localAudit(input, options?)`
- `contentGap(input, options?)`
- `search(input, options?)`
- `analyzeSerp(input, options?)`
- `aiOverviewExtract(input, options?)`
- `localVisibilityTrack(input, options?)`
- `llmMentionsTrack(input, options?)`
- `contentDecayDetect(input, options?)`
- `keywordClusterBuild(input, options?)`
- `getJob(jobId)`
  - pass `getJob(jobId, { projectId, workflowId })` if you want poll requests grouped separately from the client default

## Request Options

- `sync?: boolean` Open a short inline processing window when `true`. If the job is not ready yet, the API may still return `202` with a job payload.
- `idempotencyKey?: string` Prevent duplicate job creation on retries.
- `projectId?: string` Group usage and jobs under a project.
- `workflowId?: string` Group usage and jobs under a workflow.

## Notes

- This package is ESM-first. Use `import`, not `require`.
