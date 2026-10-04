import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { brandComparison, periodStartByCalendar } from "@/lib/dashboard/recruitment";

/** GET /api/analytics/brands — perbandingan brand (bar) + hired per brand (pie). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisInsights);
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get("brand_id");
  const start = periodStartByCalendar(sp.get("period") || "3month", new Date());
  const db = await createServerPgClient();

  const { data: brands, error: brandsError } = await db
    .from("brands")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (brandsError) throw brandsError;

  let query = db.from("candidates").select("brand_id, status").gte("created_at", start.toISOString());
  if (brandId) query = query.eq("brand_id", brandId);
  const { data: candidates, error } = await query;
  if (error) throw error;

  return NextResponse.json(
    brandComparison(
      (brands ?? []) as Array<{ id: string; name: string }>,
      (candidates ?? []) as Array<{ brand_id: string | null; status: string | null }>,
      brandId
    )
  );
}, "GET /api/analytics/brands");
