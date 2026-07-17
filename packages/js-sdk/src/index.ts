export type RequestOptions = {
  sync?: boolean;
  idempotencyKey?: string;
  projectId?: string;
  workflowId?: string;
  maxRetries?: number;
};

export type AgentSEOClientOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  projectId?: string;
  workflowId?: string;
  maxRetries?: number;
};

export type WaitForJobOptions = RequestOptions & {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type AgentSEOJobStatus<T = unknown> = {
  jobId: string;
  status: "queued" | "processing" | "retrying" | "completed" | "failed";
  result: T | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
  [key: string]: unknown;
};

export type LocalAuditInput = {
  domain: string;
  location: string;
};

export type ContentGapInput = {
  url: string;
  keyword: string;
  location?: string;
  location_code?: number;
  language?: string;
  scrape_depth?: "h1" | "h2" | "h3";
};

export type SearchInput = {
  query: string;
  location?: string;
  location_code?: number;
  limit?: number;
  include_domains?: string[];
  exclude_domains?: string[];
};

export type AnalyzeSerpInput = {
  keyword: string;
  location?: string;
  location_code?: number;
  language?: string;
  device?: "desktop" | "mobile";
};

export type AiOverviewInput = {
  keyword: string;
  location?: string;
  location_code?: number;
  language?: string;
  target_domain?: string;
};

export type LocalVisibilityInput = {
  domain: string;
  keywords: string[];
  locations: string[];
  location_codes?: number[];
  language?: string;
};

export type LlmMentionsInput = {
  brand: string;
  queries: string[];
  platform?: "reddit" | "twitter" | "all";
  limit_per_query?: number;
};

export type ContentDecayInput = {
  url: string;
  keyword: string;
  lookback_days?: number;
  threshold?: number;
};

export type KeywordClusterInput = {
  keywords: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export class AgentSEOError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  details?: unknown;

  constructor(
    message: string,
    status: number,
    details?: unknown,
    code?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "AgentSEOError";
    this.status = status;
    this.details = details;
    this.code = code;
    this.requestId = requestId;
  }
}

export class AgentSEO {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private projectId?: string;
  private workflowId?: string;
  private maxRetries: number;

  constructor(options: AgentSEOClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || "https://www.agentseo.dev").replace(
      /\/$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.projectId = options.projectId;
    this.workflowId = options.workflowId;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
    const retryAfterSeconds = Number.parseInt(retryAfterHeader || "", 10);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1_000;
    }
    return Math.min(500 * 2 ** Math.max(0, attempt - 1), 4_000);
  }

  private shouldRetryStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options?.sync && method === "POST") {
      url.searchParams.set("sync", "true");
    }

    const maxRetries = Math.max(0, options?.maxRetries ?? this.maxRetries);

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url.toString(), {
          method,
          headers: {
            "x-api-key": this.apiKey,
            "x-agentseo-client": "js-sdk",
            ...(method === "POST" ? { "content-type": "application/json" } : {}),
            ...(options?.idempotencyKey
              ? { "idempotency-key": options.idempotencyKey }
              : {}),
            ...(options?.projectId || this.projectId
              ? { "x-project-id": options?.projectId ?? this.projectId ?? "" }
              : {}),
            ...(options?.workflowId || this.workflowId
              ? {
                  "x-workflow-id":
                    options?.workflowId ?? this.workflowId ?? "",
                }
              : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });

        const data = (await res.json().catch(() => ({}))) as unknown;
        if (!res.ok) {
          if (attempt < maxRetries && this.shouldRetryStatus(res.status)) {
            await this.sleep(
              this.getRetryDelayMs(attempt + 1, res.headers.get("retry-after")),
            );
            continue;
          }

          const err: unknown = isRecord(data) ? data.error : undefined;
          const code =
            isRecord(err) && typeof err.code === "string" ? err.code : undefined;
          const requestId =
            isRecord(err) && typeof err.request_id === "string"
              ? err.request_id
              : undefined;
          const message =
            typeof err === "string"
              ? err
              : isRecord(err) && typeof err.message === "string"
                ? err.message
                : `Request failed (${res.status})`;

          throw new AgentSEOError(message, res.status, data, code, requestId);
        }

        return data as T;
      } catch (error) {
        const isAbortError =
          error instanceof Error && error.name === "AbortError";
        const isNetworkError =
          error instanceof TypeError ||
          isAbortError ||
          (error instanceof Error && /network|fetch/i.test(error.message));

        if (attempt < maxRetries && isNetworkError) {
          await this.sleep(this.getRetryDelayMs(attempt + 1, null));
          continue;
        }

        if (isAbortError) {
          throw new AgentSEOError(
            `Request timed out after ${this.timeoutMs}ms`,
            408,
          );
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async post<T>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  private async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  localAudit<T = unknown>(input: LocalAuditInput, options?: RequestOptions) {
    return this.post<T>("/api/v1/audit/local", input, options);
  }

  contentGap<T = unknown>(input: ContentGapInput, options?: RequestOptions) {
    return this.post<T>("/api/v1/content/gap", input, options);
  }

  search<T = unknown>(input: SearchInput, options?: RequestOptions) {
    return this.post<T>("/api/v1/search", input, options);
  }

  analyzeSerp<T = unknown>(input: AnalyzeSerpInput, options?: RequestOptions) {
    return this.post<T>("/api/v1/analyze/serp", input, options);
  }

  aiOverviewExtract<T = unknown>(
    input: AiOverviewInput,
    options?: RequestOptions,
  ) {
    return this.post<T>("/api/v1/ai-overview/extract", input, options);
  }

  localVisibilityTrack<T = unknown>(
    input: LocalVisibilityInput,
    options?: RequestOptions,
  ) {
    return this.post<T>("/api/v1/local-visibility/track", input, options);
  }

  llmMentionsTrack<T = unknown>(
    input: LlmMentionsInput,
    options?: RequestOptions,
  ) {
    return this.post<T>("/api/v1/llm-mentions/track", input, options);
  }

  contentDecayDetect<T = unknown>(
    input: ContentDecayInput,
    options?: RequestOptions,
  ) {
    return this.post<T>("/api/v1/content-decay/detect", input, options);
  }

  keywordClusterBuild<T = unknown>(
    input: KeywordClusterInput,
    options?: RequestOptions,
  ) {
    return this.post<T>("/api/v1/keyword-cluster/build", input, options);
  }

  getJob<T = unknown>(jobId: string, options?: RequestOptions) {
    return this.get<T>(`/api/v1/jobs/${jobId}`, options);
  }

  async waitForJob<T = unknown>(
    jobId: string,
    options: WaitForJobOptions = {},
  ): Promise<AgentSEOJobStatus<T>> {
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 2_000);
    const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 60_000);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const status = await this.getJob<AgentSEOJobStatus<T>>(jobId, options);
      if (status.status === "completed" || status.status === "failed") {
        return status;
      }
      await this.sleep(pollIntervalMs);
    }

    throw new AgentSEOError(
      `Timed out waiting for job ${jobId}`,
      408,
      { jobId, timeout_ms: timeoutMs },
      "JOB_WAIT_TIMEOUT",
    );
  }
}
