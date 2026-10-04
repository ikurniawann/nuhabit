import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

// GET /api/dashboard/sources - Get source distribution for pie chart
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
    .select("source", { count: "exact", head: true })
    .gte("created_at", startDate.toISOString());

  if (brand_id) {
    query = query.eq("brand_id", brand_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Get all candidates within period to count by source
  let countQuery = db
    .from("candidates")
    .select("source")
    .gte("created_at", startDate.toISOString());

  if (brand_id) {
    countQuery = countQuery.eq("brand_id", brand_id);
  }

  const { data: candidates, error: countError } = await countQuery;

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 400 });
  }

  // Count by source
  const sourceCounts: Record<string, number> = {};
  candidates?.forEach((candidate) => {
    if (candidate.source) {
      sourceCounts[candidate.source] = (sourceCounts[candidate.source] || 0) + 1;
    }
  });

  // Map source values to readable labels
  const sourceLabelMap: Record<string, string> = {
    portal: "Website Portal",
    referral: "Referral",
    jobstreet: "JobStreet",
    instagram: "Instagram",
    jobfair: "Job Fair",
    internal: "Internal",
    other: "Lainnya",
  };

  const result = Object.entries(sourceCounts)
    .map(([source, count]) => ({
      name: sourceLabelMap[source] || source,
      value: count,
    }))
    .sort((a, b) => b.value - a.value);

  return NextResponse.json(result);
}
