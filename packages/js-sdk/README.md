# @agentseo/sdk

Official JavaScript SDK for AgentSEO.

## Install

```bash
npm install @agentseo/sdk@0.1.1
```

## Quickstart (Node.js ESM)

Create `demo.mjs`:

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
const job = await client.analyzeSerp({
  "keyword": "seo agency austin",
  "location": "Austin, TX",
  "location_code": 1026201
});
if (typeof job.jobId !== "string" || !job.jobId) throw new Error("Missing job ID");
console.error("Job:", job.jobId);
const status = await pollExistingJob(job.jobId);
console.log(JSON.stringify(status.result, null, 2));
```

Run it:

```bash
export AGENTSEO_API_KEY="sk_live_your_key"
node demo.mjs
```

The example has a 90-second polling budget and a 10-second per-request timeout.
A final in-flight request can outlast the polling budget. If it stops or fails,
keep the printed job ID and resume polling; do not submit another job.

## Async Jobs (queue + poll)

By default, requests are queued (`sync: false`) and return a job object.
Use `pollExistingJob` from the quickstart above for the same bounded completion
handling. It uses `getJob`, which is available in the pinned published SDK; it does
not require the source-only `waitForJob` helper.

```ts
const job = await client.contentGap({
  url: "https://example.com/blog/post",
  keyword: "best project management software",
});

console.error("Job:", job.jobId);
const status = await pollExistingJob(job.jobId);
console.log(JSON.stringify(status.result, null, 2));
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
