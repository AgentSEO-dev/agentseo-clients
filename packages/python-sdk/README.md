# agentseo-sdk

Official Python SDK for AgentSEO.

## Install

Use an activated Python 3.9+ virtual environment and install from the official
source repository. The import check makes no API requests. For setup without an
SDK, use the [REST quickstart](https://www.agentseo.dev/docs/quickstart).

```bash
git clone https://github.com/AgentSEO-dev/agentseo-clients.git
cd agentseo-clients
python -m pip install ./packages/python-sdk
python -c "from agentseo_sdk import AgentSEOClient; print('AgentSEOClient import OK')"
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

job = client.local_audit("Example Dental", "New York, NY")
job_id = job["jobId"]
print("Job:", job_id, flush=True)
completed = client.wait_for_job(job_id, timeout_seconds=90)
if completed["status"] == "failed":
    raise RuntimeError(completed.get("error") or "Job failed")
print(completed["result"])
```

Local audits require the business name, not a website domain or URL. The SDK’s
legacy argument is named `domain`; pass a business name in it. REST callers use
`business_name`. If polling stops, resume with the printed job ID.

## Async Jobs

By default, requests are queued (`sync=False`) and return a job object.

```python
job = client.content_gap(
    url="https://example.com/blog/post",
    keyword="best project management software"
)

print("Job:", job["jobId"])
completed = client.wait_for_job(job["jobId"], timeout_seconds=60)
if completed["status"] == "failed":
    raise RuntimeError(completed.get("error"))
print(completed["result"])
```

If polling times out, keep the printed job ID and resume with `get_job` or
`wait_for_job`; do not submit the work again.

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
