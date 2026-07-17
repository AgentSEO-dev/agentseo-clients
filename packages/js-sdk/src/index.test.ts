import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSEO, AgentSEOError } from "./index";

describe("AgentSEO SDK", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries transient HTTP failures before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Please slow down" },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "0",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AgentSEO({
      apiKey: "sk_live_test_key",
      baseUrl: "https://agentseo.test",
      maxRetries: 1,
    });

    const result = await client.search({ query: "agent seo" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits for jobs until completion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "job-1",
            status: "processing",
            result: null,
            error: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: "job-1",
            status: "completed",
            result: { value: 42 },
            error: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new AgentSEO({
      apiKey: "sk_live_test_key",
      baseUrl: "https://agentseo.test",
      maxRetries: 0,
    });

    const result = await client.waitForJob<{ value: number }>("job-1", {
      pollIntervalMs: 1,
      timeoutMs: 200,
    });

    expect(result.status).toBe("completed");
    expect(result.result).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a timeout error when waitForJob exceeds the deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            jobId: "job-1",
            status: "processing",
            result: null,
            error: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const client = new AgentSEO({
      apiKey: "sk_live_test_key",
      baseUrl: "https://agentseo.test",
      maxRetries: 0,
    });

    await expect(
      client.waitForJob("job-1", {
        pollIntervalMs: 1,
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(AgentSEOError);
  });
});
