import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listProctorEvents } from "@/lib/recruitment/proctor-events";
import { assertUuid } from "@/lib/recruitment/route-helpers";

/** GET /api/psikotes/sessions/[id]/proctor-events: arsip bukti proctoring satu sesi utk HR. */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID sesi tidak valid");
  return NextResponse.json({ data: await listProctorEvents("psikotes", id) });
}, "psikotes-proctor-events");
