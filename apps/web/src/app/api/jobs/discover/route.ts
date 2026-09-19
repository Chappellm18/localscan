import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRedis } from "@/lib/redis";

// POST /api/jobs/discover  { zip: string, radiusMiles?: number, categoryFilter?: string }
// Enqueues a job onto `jobs:discovery` per the schema in DESIGN.md §7b and
// returns the job_id immediately so the frontend can open an SSE
// connection to /api/jobs/{jobId}/stream without waiting for the crawl.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { zip, radiusMiles = null, categoryFilter = null } = body ?? {};

  if (typeof zip !== "string" || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit string" }, { status: 400 });
  }

  // TODO: replace with the authenticated user's id once Phase 2 auth
  // (DESIGN.md §9) lands. Placeholder nil UUID keeps the payload shape
  // stable for the Rust worker in the meantime.
  const requestedByUserId = "00000000-0000-0000-0000-000000000000";

  const jobId = uuidv4();
  const payload = {
    job_id: jobId,
    zip,
    radius_miles: radiusMiles,
    category_filter: categoryFilter,
    requested_by_user_id: requestedByUserId,
    enqueued_at: new Date().toISOString(),
  };

  try {
    const redis = getRedis();
    await redis.xadd("jobs:discovery", "*", "payload", JSON.stringify(payload));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Could not enqueue the discovery job. Make sure Redis is running and the REDIS_URL is reachable.",
        details: error instanceof Error ? error.message : "Unknown Redis error",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ jobId }, { status: 202 });
}
