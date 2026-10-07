import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  hardToFill,
  overviewKpis,
  periodStartByDays,
  type OverviewCandidate,
} from "@/lib/dashboard/recruitment";

/** GET /api/analytics/overview — KPI analitik rekrutmen + posisi sulit diisi. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisInsights);
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get("brand_id");
  const start = periodStartByDays(sp.get("period") || "3month", new Date(), 90);
  const db = await createServerPgClient();

  let query = db
    .from("candidates")
    .select("id, status, created_at, updated_at, position_id")
    .gte("created_at", start.toISOString());
  if (brandId) query = query.eq("brand_id", brandId);
  const { data, error } = await query;
  if (error) throw error;

  const { kpis, activePerPosition } = overviewKpis((data ?? []) as OverviewCandidate[]);
  let hard_to_fill: ReturnType<typeof hardToFill> = [];
  if (activePerPosition.size > 0) {
    const { data: positions } = await db.from("positions").select("id, title").in("id", [...activePerPosition.keys()]);
    if (positions) hard_to_fill = hardToFill(activePerPosition, positions as Array<{ id: string; title: string }>);
  }
  return NextResponse.json({ ...kpis, hard_to_fill });
}, "GET /api/analytics/overview");
