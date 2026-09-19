import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      jobId,
    )
  ) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const { rows } = await getDb().query(
    `SELECT b.id, b.name, b.address, b.zip, b.lat, b.lng, b.category,
            b.phone, b.website_url, s.overall_score, s.accessibility_score,
            s.performance_score, s.seo_score, s.basics_score, s.modernity_score
       FROM businesses b
       LEFT JOIN LATERAL (
         SELECT overall_score, accessibility_score, performance_score,
                seo_score, basics_score, modernity_score
           FROM site_scores
          WHERE business_id = b.id
          ORDER BY scanned_at DESC
          LIMIT 1
       ) s ON true
      WHERE b.discovery_job_id = $1
      ORDER BY COALESCE(s.overall_score, -1) DESC, b.name ASC`,
    [jobId],
  );

  return NextResponse.json({ results: rows });
}
