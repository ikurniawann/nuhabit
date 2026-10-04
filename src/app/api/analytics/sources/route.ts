import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { periodStartByCalendar, sourceConversion } from "@/lib/dashboard/recruitment";

/** GET /api/analytics/sources — total, hired, dan rate per sumber kandidat. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisInsights);
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get("brand_id");
  const start = periodStartByCalendar(sp.get("period") || "3month", new Date());
  const db = await createServerPgClient();
  let query = db.from("candidates").select("source, status").gte("created_at", start.toISOString());
  if (brandId) query = query.eq("brand_id", brandId);

  const { data, error } = await query;
  if (error) throw error;
  return NextResponse.json({
    data: sourceConversion((data ?? []) as Array<{ source: string | null; status: string | null }>),
  });
}, "GET /api/analytics/sources");
