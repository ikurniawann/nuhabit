import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { attentionItem, type StaleCandidateRow } from "@/lib/dashboard/recruitment";

// Dashboard rekrutmen: tim rekrutmen dan pembaca insight HR (direksi).
const READERS = [...IAM.hrisRecruitment, ...IAM.hrisInsights];
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** GET /api/dashboard/attention — 10 kandidat aktif yang tidak bergerak lebih dari 7 hari. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(READERS);
  const brandId = request.nextUrl.searchParams.get("brand_id");
  const db = await createServerPgClient();
  let query = db
    .from("candidates")
    .select("id, full_name, status, updated_at, positions(title), brands(name)")
    .not("status", "in", "('hired','rejected','archived')")
    .lt("updated_at", new Date(Date.now() - STALE_AFTER_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(10);
  if (brandId) query = query.eq("brand_id", brandId);

  const { data, error } = await query;
  if (error) throw error;
  const now = Date.now();
  return NextResponse.json({ data: ((data ?? []) as StaleCandidateRow[]).map((row) => attentionItem(row, now)) });
}, "GET /api/dashboard/attention");
