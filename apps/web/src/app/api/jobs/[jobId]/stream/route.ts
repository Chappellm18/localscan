import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";

// GET /api/jobs/{jobId}/stream — Server-Sent Events, per DESIGN.md §7c.
//
// Polls the `job_status:{job_id}` hash the Rust workers write to, and
// forwards updates to the client. Also queries Postgres for newly-scored
// businesses tied to this discovery job so results can stream in
// incrementally rather than all appearing at once when the job completes
// (see §7c for why this matters for perceived responsiveness).
//
// NOTE: polling Redis on an interval is the simple version of this — an
// upgrade path is Redis keyspace notifications so updates push instead of
// poll. Fine to ship polling first; swap later if latency matters.
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const { jobId } = params;
  const redis = getRedis();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const interval = setInterval(async () => {
        try {
          const status = await redis.hgetall(`job_status:${jobId}`);
          if (Object.keys(status).length === 0) {
            return; // job not started yet, or status hash expired
          }

          send("status", status);

          // TODO: query Postgres for businesses tied to this
          // parent_discovery_job_id that have a completed site_scores row
          // not yet sent to this client, and `send("business", row)` for
          // each — this is what makes results appear incrementally rather
          // than all at once (§7c). Left as a TODO since it needs the
          // Postgres client wired up (see package.json's `pg` dependency)
          // plus a way to track "already sent" per-connection.

          if (status.status === "completed" || status.status === "failed") {
            clearInterval(interval);
            closed = true;
            controller.close();
          }
        } catch (err) {
          send("error", { message: String(err) });
        }
      }, 1000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
