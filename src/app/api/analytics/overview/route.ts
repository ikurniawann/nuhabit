import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// GET /api/analytics/overview - Get KPI data for analytics page
export async function GET(request: Request) {
  const guard = await requireIamGuard(IAM.hrisInsights);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const brand_id = searchParams.get("brand_id");
  const period = searchParams.get("period") || "3month";

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
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }

  // Build base query with optional brand_id filter
  let candidatesQuery = db
    .from("candidates")
    .select("id, status, created_at, updated_at, position_id")
    .gte("created_at", startDate.toISOString());

  if (brand_id) {
    candidatesQuery = candidatesQuery.eq("brand_id", brand_id);
  }

  const { data: candidatesData, error } = await candidatesQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const candidates = candidatesData || [];

  // 1. Total applicants
  const total_applicants = candidates.length;

  // 2. Total hired (in period, based on updated_at for hired status)
  const total_hired = candidates.filter(
    (c) => c.status === "hired"
  ).length;

  // 3. Total rejected
  const total_rejected = candidates.filter(
    (c) => c.status === "rejected"
  ).length;

  // 4. Total active (not hired, rejected, archived)
  const total_active = candidates.filter(
    (c) => !["hired", "rejected", "archived"].includes(c.status)
  ).length;

  // 5. Hiring rate
  const hiring_rate = total_applicants > 0 
    ? (total_hired / total_applicants) * 100 
    : 0;

  // 6. Time to hire average (days from created_at to updated_at for hired candidates)
  const hiredCandidates = candidates.filter((c) => c.status === "hired");
  let time_to_hire_avg: number | null = null;

  if (hiredCandidates.length > 0) {
    const totalDays = hiredCandidates.reduce((sum, c) => {
      const created = new Date(c.created_at);
      const updated = new Date(c.updated_at);
      const days = Math.floor(
        (updated.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );
      return sum + days;
    }, 0);
    time_to_hire_avg = Math.round(totalDays / hiredCandidates.length);
  }

  // 7. Conversion rates (percentage per current status)
  const statusCounts: Record<string, number> = {};
  const allStatuses = [
    "applied",
    "screening",
    "psikotes",
    "interview",
    "offer",
    "hired",
    "talent_pool",
    "rejected",
    "archived",
  ];

  candidates.forEach((c) => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  });

  const stageNames: Record<string, string> = {
    applied: "Applied",
    screening: "Screening",
    psikotes: "Psikotes",
    interview: "Interview",
    offer: "Offer",
    hired: "Hired",
    talent_pool: "Talent Pool",
    rejected: "Tolak",
    archived: "Archived",
  };

  const conversion_rates = allStatuses.map((status) => ({
    stage: stageNames[status],
    rate: total_applicants > 0 
      ? Math.round((statusCounts[status] || 0) / total_applicants * 100) 
      : 0,
  }));

  // 8. Hard to fill positions (positions with most candidates stuck in pipeline)
  // Get position_id for candidates that are active (not hired/rejected/archived)
  const activeCandidates = candidates.filter(
    (c) => !["hired", "rejected", "archived"].includes(c.status)
  );

  const positionCounts: Record<string, number> = {};
  activeCandidates.forEach((c) => {
    if (c.position_id) {
      positionCounts[c.position_id] = (positionCounts[c.position_id] || 0) + 1;
    }
  });

  // Get position titles for the counted positions
  let hard_to_fill: Array<{ position_id: string; position_title: string; count: number }> = [];

  if (Object.keys(positionCounts).length > 0) {
    const positionIds = Object.keys(positionCounts);
    
    const { data: positionsData } = await db
      .from("positions")
      .select("id, title")
      .in("id", positionIds);

    if (positionsData) {
      hard_to_fill = positionIds
        .map((posId) => {
          const pos = positionsData.find((p: any) => p.id === posId);
          return {
            position_id: posId,
            position_title: pos?.title || "Unknown",
            count: positionCounts[posId],
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
  }

  return NextResponse.json({
    time_to_hire_avg,
    hiring_rate: Math.round(hiring_rate * 100) / 100,
    total_applicants,
    total_hired,
    total_rejected,
    total_active,
    conversion_rates,
    hard_to_fill,
  });
}
