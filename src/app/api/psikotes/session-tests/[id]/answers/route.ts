import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getTestAnswerDetail } from "@/lib/recruitment/psikotes-admin";
import { assertUuid } from "@/lib/recruitment/route-helpers";

/**
 * GET /api/psikotes/session-tests/[id]/answers: rincian soal + jawaban
 * kandidat utk HR (MCQ & PAPI). Kunci jawaban boleh tampil karena route ini
 * ber-auth HR, berbeda dgn endpoint publik kandidat.
 */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID tes tidak valid");
  return NextResponse.json({ data: await getTestAnswerDetail(id) });
}, "psikotes-test-answers");
