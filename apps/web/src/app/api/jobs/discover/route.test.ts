import { NextRequest } from "next/server";
import type Redis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getRedis } from "@/lib/redis";

vi.mock("@/lib/redis", () => ({ getRedis: vi.fn() }));

describe("POST /api/jobs/discover", () => {
  const xadd = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue({ xadd } as unknown as Redis);
    xadd.mockResolvedValue("1-0");
  });

  it("rejects invalid JSON and ZIP codes without contacting Redis", async () => {
    const invalidJson = await POST(
      new NextRequest("http://localhost/api/jobs/discover", {
        method: "POST",
        body: "{",
      }),
    );
    const invalidZip = await POST(
      new NextRequest("http://localhost/api/jobs/discover", {
        method: "POST",
        body: JSON.stringify({ zip: "1234" }),
      }),
    );

    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(invalidZip.status).toBe(400);
    expect(await invalidZip.json()).toEqual({
      error: "zip must be a 5-digit string",
    });
    expect(getRedis).not.toHaveBeenCalled();
  });

  it("enqueues a correctly shaped Rust worker payload", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/jobs/discover", {
        method: "POST",
        body: JSON.stringify({
          zip: "10940",
          radiusMiles: 10,
          categoryFilter: "restaurant",
        }),
      }),
    );

    expect(response.status).toBe(202);
    const { jobId } = await response.json();
    expect(jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(xadd).toHaveBeenCalledOnce();
    const [stream, id, field, serializedPayload] = xadd.mock.calls[0];
    expect([stream, id, field]).toEqual(["jobs:discovery", "*", "payload"]);
    expect(JSON.parse(serializedPayload)).toMatchObject({
      job_id: jobId,
      zip: "10940",
      radius_miles: 10,
      category_filter: "restaurant",
      requested_by_user_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(Number.isNaN(Date.parse(JSON.parse(serializedPayload).enqueued_at))).toBe(
      false,
    );
  });

  it("returns a service-unavailable response when Redis cannot enqueue", async () => {
    xadd.mockRejectedValueOnce(new Error("connection refused"));

    const response = await POST(
      new NextRequest("http://localhost/api/jobs/discover", {
        method: "POST",
        body: JSON.stringify({ zip: "10940" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Could not enqueue"),
      details: "connection refused",
    });
  });
});
