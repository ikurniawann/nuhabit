import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// GET /api/analytics/sources - Source analytics for bar chart
export async function GET(request: Request) {
  const guard = await requireIamGuard(IAM.hrisInsights);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);

  const brand_id = searchParams.get("brand_id");
  const period = searchParams.get("period") || "3month";

  // Calculate date range based on period
  const now = new Date();
  const startDate = new Date();
  
  switch (period) {
    case "week":
      startDate.setDate(now.getDate() - 7);
      break;
    case "month":
      startDate.setMonth(now.getMonth() - 1);
      break;
    case "3month":
      startDate.setMonth(now.getMonth() - 3);
      break;
    case "6month":
      startDate.setMonth(now.getMonth() - 6);
      break;
    default:
      startDate.setMonth(now.getMonth() - 3);
  }

  // Source mapping
  const sourceLabels: Record<string, string> = {
    portal: "Website Portal",
    referral: "Referral",
    jobstreet: "JobStreet",
    instagram: "Instagram",
    jobfair: "Job Fair",
    internal: "Internal",
    other: "Lainnya",
  };

  const sources = Object.keys(sourceLabels);

  let query = db
    .from("candidates")
    .select("source, status")
    .gte("created_at", startDate.toISOString());

  if (brand_id) {
    query = query.eq("brand_id", brand_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Aggregate by source
  const sourceStats: Record<string, { total: number; hired: number }> = {};
  
  sources.forEach((source) => {
    sourceStats[source] = { total: 0, hired: 0 };
  });

  data.forEach((candidate) => {
    if (candidate.source && sourceLabels[candidate.source]) {
      sourceStats[candidate.source].total += 1;
      if (candidate.status === "hired") {
        sourceStats[candidate.source].hired += 1;
      }
    }
  });

  // Transform to array and calculate rate
  const result = sources
    .map((source) => {
      const { total, hired } = sourceStats[source];
      return {
        source: sourceLabels[source],
        total,
        hired,
        rate: total > 0 ? Math.round((hired / total) * 1000) / 10 : 0,
      };
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ data: result });
}