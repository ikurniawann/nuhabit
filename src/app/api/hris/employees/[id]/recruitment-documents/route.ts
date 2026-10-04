import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { loadRecruitmentDocuments } from "@/lib/hris/employees-profile";
import { requireUuid } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/employees/[id]/recruitment-documents — CV dan ketersediaan
 * Laporan Pipeline dari kandidat asal karyawan (tab Dokumen HRD).
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const id = requireUuid((await params).id, "ID karyawan tidak valid");
  return NextResponse.json({ data: await loadRecruitmentDocuments(id) });
}, "hris/employees/recruitment-documents GET");
