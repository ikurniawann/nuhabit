import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listInterviewRecordings } from "@/lib/recruitment/interview-runner";
import { assertUuid } from "@/lib/recruitment/route-helpers";

/** GET /api/interview/sessions/[id]/recordings: daftar rekaman video satu sesi; diputar via /api/interview/files. */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID sesi tidak valid");
  return NextResponse.json({ data: await listInterviewRecordings(id) });
}, "interview-recordings");
