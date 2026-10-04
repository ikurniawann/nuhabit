import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];

export async function GET(request: Request) {
  const guard = await requireIamGuard(READERS);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const brand_id = searchParams.get("brand_id");

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthISO = startOfMonth.toISOString();

  const base = () => {
    let q = db.from("candidates").select("id", { count: "exact", head: true });
    if (brand_id) q = q.eq("brand_id", brand_id);
    return q;
  };

  const posBase = () => {
    let q = db.from("positions").select("id", { count: "exact", head: true });
    if (brand_id) q = q.eq("brand_id", brand_id);
    return q;
  };

  const [
    { count: candidatesThisMonth },
    { count: activePipeline },
    { count: talentPool },
    { count: openPositions },
    { count: hiredThisMonth },
  ] = await Promise.all([
    base().gte("created_at", startOfMonthISO),
    base().not("status", "in", "('hired','rejected','archived')"),
    base().eq("status", "talent_pool"),
    posBase().eq("is_active", true),
    base().eq("status", "hired").gte("updated_at", startOfMonthISO),
  ]);

  return NextResponse.json({
    candidates_this_month: candidatesThisMonth ?? 0,
    active_pipeline: activePipeline ?? 0,
    talent_pool: talentPool ?? 0,
    open_positions: openPositions ?? 0,
    hired_this_month: hiredThisMonth ?? 0,
  });
}
