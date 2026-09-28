import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getDb } from "@/lib/db";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

describe("GET /api/jobs/:jobId/results", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue({ query } as unknown as Pool);
  });

  it("rejects an invalid job ID before querying Postgres", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid job ID." });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns the database rows for a valid discovery job", async () => {
    const rows = [{ id: "business-1", name: "Example Cafe", modernity_score: 12 }];
    query.mockResolvedValueOnce({ rows });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        jobId: "00000000-0000-4000-8000-000000000001",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: rows });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("keeps results available for databases without the modernity migration", async () => {
    query
      .mockRejectedValueOnce(new Error('column "modernity_score" does not exist'))
      .mockResolvedValueOnce({ rows: [{ id: "business-1", modernity_score: null }] });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        jobId: "00000000-0000-4000-8000-000000000001",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ id: "business-1", modernity_score: null }],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("NULL::real AS modernity_score");
  });

  it("surfaces unexpected database errors", async () => {
    query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      GET(new Request("http://localhost"), {
        params: Promise.resolve({
          jobId: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    ).rejects.toThrow("database unavailable");
  });
});
