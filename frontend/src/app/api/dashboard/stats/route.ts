import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(READERS);
  const brandId = request.nextUrl.searchParams.get("brand_id");
  const db = await createServerPgClient();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthStart = startOfMonth.toISOString();

  const count = (table: "candidates" | "positions") => {
    const q = db.from(table).select("id", { count: "exact", head: true });
    return brandId ? q.eq("brand_id", brandId) : q;
  };

  const [thisMonth, activePipeline, talentPool, openPositions, hiredThisMonth] = await Promise.all([
    count("candidates").gte("created_at", monthStart),
    count("candidates").not("status", "in", "('hired','rejected','archived')"),
    count("candidates").eq("status", "talent_pool"),
    count("positions").eq("is_active", true),
    count("candidates").eq("status", "hired").gte("updated_at", monthStart),
  ]);

  return NextResponse.json({
    candidates_this_month: thisMonth.count ?? 0,
    active_pipeline: activePipeline.count ?? 0,
    talent_pool: talentPool.count ?? 0,
    open_positions: openPositions.count ?? 0,
    hired_this_month: hiredThisMonth.count ?? 0,
  });
}, "GET /api/dashboard/stats");
