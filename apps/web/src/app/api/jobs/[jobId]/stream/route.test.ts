import { NextRequest } from "next/server";
import type Redis from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getRedis } from "@/lib/redis";

vi.mock("@/lib/redis", () => ({ getRedis: vi.fn() }));

describe("GET /api/jobs/:jobId/stream", () => {
  const hgetall = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue({ hgetall } as unknown as Redis);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams the terminal job status as a server-sent event", async () => {
    hgetall.mockResolvedValue({
      status: "completed",
      stage: "done",
      progress_current: "1",
      progress_total: "1",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/jobs/00000000-0000-4000-8000-000000000001/stream"),
      {
        params: Promise.resolve({
          jobId: "00000000-0000-4000-8000-000000000001",
        }),
      },
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");

    const reader = response.body!.getReader();
    const nextChunk = reader.read();
    await vi.advanceTimersByTimeAsync(1_000);
    const { value, done } = await nextChunk;

    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toContain(
      'event: status\ndata: {"status":"completed","stage":"done","progress_current":"1","progress_total":"1"}',
    );
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true });
    expect(hgetall).toHaveBeenCalledWith(
      "job_status:00000000-0000-4000-8000-000000000001",
    );
  });
});
