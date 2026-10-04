import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

// GET /api/dashboard/funnel - Get pipeline funnel data
export async function GET(request: Request) {
  const guard = await requireIamGuard(READERS);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);

  const brand_id = searchParams.get("brand_id");
  const period = searchParams.get("period") || "month";

  // Calculate date range based on period
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case "week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "3month":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "6month":
      startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  let query = db
    .from("candidates")
    .select("status")
    .gte("created_at", startDate.toISOString())
    .limit(5000);

  if (brand_id) {
    query = query.eq("brand_id", brand_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Count by status
  const statusCounts: Record<string, number> = {
    applied: 0,
    screening: 0,
    psikotes: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    talent_pool: 0,
  };

  data?.forEach((candidate) => {
    if (candidate.status && statusCounts.hasOwnProperty(candidate.status)) {
      statusCounts[candidate.status]++;
    }
  });

  // Map to funnel stages
  const funnelStages = [
    { stage: "Applied", count: statusCounts.applied },
    { stage: "Screening", count: statusCounts.screening },
    { stage: "Psikotes", count: statusCounts.psikotes },
    { stage: "Interview", count: statusCounts.interview },
    { stage: "Offer", count: statusCounts.offer },
    { stage: "Hired", count: statusCounts.hired },
    { stage: "Talent Pool", count: statusCounts.talent_pool },
  ];

  return NextResponse.json(funnelStages);
}
