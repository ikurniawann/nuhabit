import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { lastEightWeeks, weeklyApplications } from "@/lib/dashboard/recruitment";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

/** GET /api/dashboard/weekly — lamaran per minggu, 8 minggu terakhir. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(READERS);
  const brandId = request.nextUrl.searchParams.get("brand_id");
  const weeks = lastEightWeeks(new Date());
  const db = await createServerPgClient();
  let query = db
    .from("candidates")
    .select("created_at")
    .gte("created_at", weeks[0].start.toISOString())
    .lte("created_at", weeks[weeks.length - 1].end.toISOString());
  if (brandId) query = query.eq("brand_id", brandId);

  const { data, error } = await query;
  if (error) throw error;
  return NextResponse.json(weeklyApplications(weeks, (data ?? []) as Array<{ created_at: string }>));
}, "GET /api/dashboard/weekly");
