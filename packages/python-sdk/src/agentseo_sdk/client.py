from __future__ import annotations

import time
from typing import Any, Dict, Optional

import requests
from requests import Response
from requests.exceptions import RequestException, Timeout


class AgentSEOError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int,
        details: Optional[Dict[str, Any]] = None,
        code: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.details = details or {}
        self.code = code
        self.request_id = request_id


class AgentSEOClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://www.agentseo.dev",
        timeout_seconds: float = 15.0,
        project_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        max_retries: int = 2,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.project_id = project_id
        self.workflow_id = workflow_id
        self.max_retries = max(0, max_retries)

    def _should_retry_status(self, status_code: int) -> bool:
        return status_code in {429, 502, 503, 504}

    def _retry_delay_seconds(
        self,
        attempt: int,
        response: Optional[Response] = None,
    ) -> float:
        retry_after = response.headers.get("Retry-After") if response is not None else None
        if retry_after:
            try:
                retry_after_seconds = int(retry_after)
                if retry_after_seconds > 0:
                    return float(retry_after_seconds)
            except ValueError:
                pass
        return float(min(0.5 * (2 ** max(0, attempt - 1)), 4.0))

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        sync: bool = False,
        idempotency_key: Optional[str] = None,
        project_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        max_retries: Optional[int] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        if sync and method == "POST":
            url = f"{url}?sync=true"

        headers = {
            "x-api-key": self.api_key,
        }
        if method == "POST":
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key
        resolved_project_id = project_id if project_id is not None else self.project_id
        resolved_workflow_id = workflow_id if workflow_id is not None else self.workflow_id
        if resolved_project_id:
            headers["x-project-id"] = resolved_project_id
        if resolved_workflow_id:
            headers["x-workflow-id"] = resolved_workflow_id

        request_kwargs: Dict[str, Any] = {
            "url": url,
            "headers": headers,
            "timeout": self.timeout_seconds,
        }
        if method == "POST":
            request_kwargs["json"] = payload or {}

        retries = self.max_retries if max_retries is None else max(0, max_retries)

        for attempt in range(retries + 1):
            try:
                response = requests.request(method=method, **request_kwargs)
            except Timeout as exc:
                if attempt < retries:
                    time.sleep(self._retry_delay_seconds(attempt + 1))
                    continue
                raise AgentSEOError(
                    f"Request timed out after {self.timeout_seconds} seconds",
                    408,
                    {"path": path},
                    code="REQUEST_TIMEOUT",
                ) from exc
            except RequestException as exc:
                if attempt < retries:
                    time.sleep(self._retry_delay_seconds(attempt + 1))
                    continue
                raise AgentSEOError(
                    str(exc) or "Network request failed",
                    503,
                    {"path": path},
                    code="NETWORK_ERROR",
                ) from exc

            data: Dict[str, Any]
            try:
                data = response.json()
            except Exception:
                data = {"error": f"Invalid JSON response ({response.status_code})"}

            if response.ok:
                return data

            if attempt < retries and self._should_retry_status(response.status_code):
                time.sleep(self._retry_delay_seconds(attempt + 1, response))
                continue

            err = data.get("error")
            code: Optional[str] = None
            request_id: Optional[str] = None

            if isinstance(err, dict):
                message = str(err.get("message", f"Request failed ({response.status_code})"))
                code = err.get("code")
                request_id = err.get("request_id") or err.get("requestId")
            else:
                message = str(err or f"Request failed ({response.status_code})")

            raise AgentSEOError(message, response.status_code, data, code=code, request_id=request_id)

        raise AgentSEOError("Request failed after retries", 503, code="NETWORK_ERROR")

    def _post(
        self,
        path: str,
        payload: Dict[str, Any],
        sync: bool = False,
        idempotency_key: Optional[str] = None,
        project_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        max_retries: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            path,
            payload=payload,
            sync=sync,
            idempotency_key=idempotency_key,
            project_id=project_id,
            workflow_id=workflow_id,
            max_retries=max_retries,
        )

    def _get(
        self,
        path: str,
        project_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        max_retries: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "GET",
            path,
            project_id=project_id,
            workflow_id=workflow_id,
            max_retries=max_retries,
        )

    def local_audit(self, domain: str, location: str, sync: bool = False) -> Dict[str, Any]:
        return self._post("/api/v1/audit/local", {"domain": domain, "location": location}, sync=sync)

    def content_gap(
        self,
        url: str,
        keyword: str,
        location: str = "United States",
        location_code: Optional[int] = None,
        language: str = "en",
        scrape_depth: str = "h3",
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "url": url,
            "keyword": keyword,
            "location": location,
            "language": language,
            "scrape_depth": scrape_depth,
        }
        if location_code is not None:
            payload["location_code"] = location_code
        return self._post("/api/v1/content/gap", payload, sync=sync)

    def search(
        self,
        query: str,
        location: str = "United States",
        location_code: Optional[int] = None,
        limit: int = 10,
        include_domains: Optional[list[str]] = None,
        exclude_domains: Optional[list[str]] = None,
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"query": query, "limit": limit, "location": location}
        if location_code is not None:
            payload["location_code"] = location_code
        if include_domains:
            payload["include_domains"] = include_domains
        if exclude_domains:
            payload["exclude_domains"] = exclude_domains
        return self._post("/api/v1/search", payload, sync=sync)

    def analyze_serp(
        self,
        keyword: str,
        location: str = "United States",
        location_code: Optional[int] = None,
        language: str = "en",
        device: str = "desktop",
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "keyword": keyword,
            "location": location,
            "language": language,
            "device": device,
        }
        if location_code is not None:
            payload["location_code"] = location_code
        return self._post("/api/v1/analyze/serp", payload, sync=sync)

    def ai_overview_extract(
        self,
        keyword: str,
        location: str = "United States",
        location_code: Optional[int] = None,
        language: str = "en",
        target_domain: Optional[str] = None,
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload = {"keyword": keyword, "location": location, "language": language}
        if location_code is not None:
            payload["location_code"] = location_code
        if target_domain is not None:
            payload["target_domain"] = target_domain
        return self._post("/api/v1/ai-overview/extract", payload, sync=sync)

    def local_visibility_track(
        self,
        domain: str,
        keywords: list[str],
        locations: list[str],
        location_codes: Optional[list[int]] = None,
        language: str = "en",
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "domain": domain,
            "keywords": keywords,
            "locations": locations,
            "language": language,
        }
        if location_codes:
            payload["location_codes"] = location_codes
        return self._post("/api/v1/local-visibility/track", payload, sync=sync)

    def llm_mentions_track(
        self,
        brand: str,
        queries: list[str],
        platform: str = "all",
        limit_per_query: int = 8,
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "brand": brand,
            "queries": queries,
            "platform": platform,
            "limit_per_query": limit_per_query,
        }
        return self._post("/api/v1/llm-mentions/track", payload, sync=sync)

    def content_decay_detect(
        self,
        url: str,
        keyword: str,
        lookback_days: int = 30,
        threshold: int = 3,
        sync: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "url": url,
            "keyword": keyword,
            "lookback_days": lookback_days,
            "threshold": threshold,
        }
        return self._post("/api/v1/content-decay/detect", payload, sync=sync)

    def keyword_cluster_build(self, keywords: list[str], sync: bool = False) -> Dict[str, Any]:
        return self._post("/api/v1/keyword-cluster/build", {"keywords": keywords}, sync=sync)

    def get_job(
        self,
        job_id: str,
        project_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._get(
            f"/api/v1/jobs/{job_id}",
            project_id=project_id,
            workflow_id=workflow_id,
        )

    def wait_for_job(
        self,
        job_id: str,
        poll_interval_seconds: float = 2.0,
        timeout_seconds: float = 60.0,
        project_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        deadline = time.time() + max(timeout_seconds, poll_interval_seconds)

        while time.time() <= deadline:
            status = self.get_job(
                job_id,
                project_id=project_id,
                workflow_id=workflow_id,
            )
            if status.get("status") in {"completed", "failed"}:
                return status
            time.sleep(max(0.25, poll_interval_seconds))

        raise AgentSEOError(
            f"Timed out waiting for job {job_id}",
            408,
            {"job_id": job_id, "timeout_seconds": timeout_seconds},
            code="JOB_WAIT_TIMEOUT",
        )
