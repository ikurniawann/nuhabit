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

  let query = db
    .from("candidates")
    .select("id, full_name, status, updated_at, positions(title), brands(name)")
    .not("status", "in", "('hired','rejected','archived')")
    .lt("updated_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("updated_at", { ascending: true })
    .limit(10);

  if (brand_id) query = query.eq("brand_id", brand_id);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const now = Date.now();
  const candidates = (data || []).map((candidate: any) => {
    const daysInCurrentStatus = Math.floor(
      (now - new Date(candidate.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    return {
      id: candidate.id,
      full_name: candidate.full_name,
      status: candidate.status,
      position_title: candidate.positions?.title ?? null,
      brand_name: candidate.brands?.name ?? null,
      days_in_current_status: daysInCurrentStatus,
      urgency: daysInCurrentStatus > 14 ? "red" : "amber",
    };
  });

  return NextResponse.json({ data: candidates });
}
