import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { periodStartByDays, sourceDistribution } from "@/lib/dashboard/recruitment";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

/** GET /api/dashboard/sources — distribusi sumber kandidat (pie chart). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(READERS);
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get("brand_id");
  const start = periodStartByDays(sp.get("period") || "month", new Date(), 30);
  const db = await createServerPgClient();
  let query = db.from("candidates").select("source").gte("created_at", start.toISOString());
  if (brandId) query = query.eq("brand_id", brandId);

  const { data, error } = await query;
  if (error) throw error;
  return NextResponse.json(sourceDistribution((data ?? []) as Array<{ source: string | null }>));
}, "GET /api/dashboard/sources");
