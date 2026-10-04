import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createQuestion, listQuestions } from "@/lib/recruitment/psikotes-admin";
import { assertUuid, enforceRateLimit } from "@/lib/recruitment/route-helpers";

/**
 * Bank soal per instrumen (halaman manajemen HR).
 * GET  semua soal TERMASUK kunci jawaban; endpoint kandidat terpisah.
 * POST tambah soal; skema mengikuti `kind` instrumen, `drawing` tanpa bank soal.
 */

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_req: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID instrumen tidak valid");
  enforceRateLimit(`psikotes_questions_get_${user.id}`);
  return NextResponse.json({ data: await listQuestions(id) });
}, "psikotes-questions");

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  assertUuid(id, "ID instrumen tidak valid");
  enforceRateLimit(`psikotes_question_post_${user.id}`);
  const created = await createQuestion(id, req);
  return NextResponse.json({ data: created, message: "Soal tersimpan" }, { status: 201 });
}, "psikotes-questions");
