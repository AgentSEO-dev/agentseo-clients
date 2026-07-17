# agentseo-sdk

Official Python SDK for AgentSEO.

## Install

```bash
pip install agentseo-sdk
```

## Quick Start

```python
from agentseo_sdk import AgentSEOClient

client = AgentSEOClient(
    api_key="sk_live_...",
    base_url="https://www.agentseo.dev",
    project_id="client-alpha",
    workflow_id="nightly-refresh",
)

result = client.local_audit("example.com", "New York, NY", sync=True)
print(result)
```

## Async Jobs

By default, requests are queued (`sync=False`) and return a job object.

```python
job = client.content_gap(
    url="https://example.com/blog/post",
    keyword="best project management software"
)

result = client.get_job(job["jobId"])
```

Set `project_id` and `workflow_id` once on the client when you want usage, jobs, and budgets grouped by agent workflow. You can also override them when polling:

```python
result = client.get_job(
    job["jobId"],
    project_id="client-alpha",
    workflow_id="nightly-refresh",
)
```

For geo-targeted endpoints, pass `location_code` when you need deterministic targeting:

```python
client.analyze_serp(
    keyword="seo agency austin",
    location="Austin, TX",
    location_code=1026201,
)
```

## Error Handling

```python
from agentseo_sdk import AgentSEOClient, AgentSEOError

try:
    client.search(query="agentic seo tools", sync=True)
except AgentSEOError as error:
    print(error.status_code, str(error), error.details)
```

## API Surface

- `local_audit(domain, location, sync=False)`
- `content_gap(url, keyword, location="United States", location_code=None, language="en", scrape_depth="h3", sync=False)`
- `search(query, location="United States", location_code=None, limit=10, include_domains=None, exclude_domains=None, sync=False)`
- `analyze_serp(keyword, location="United States", location_code=None, language="en", device="desktop", sync=False)`
- `ai_overview_extract(keyword, location="United States", location_code=None, language="en", target_domain=None, sync=False)`
- `local_visibility_track(domain, keywords, locations, location_codes=None, language="en", sync=False)`
- `llm_mentions_track(brand, queries, platform="all", limit_per_query=8, sync=False)`
- `content_decay_detect(url, keyword, lookback_days=30, threshold=3, sync=False)`
- `keyword_cluster_build(keywords, sync=False)`
- `get_job(job_id, project_id=None, workflow_id=None)`

## Notes

- `sync=True` opens a short inline processing window. If the job is not ready yet, the API may still return `202` with a job payload.
