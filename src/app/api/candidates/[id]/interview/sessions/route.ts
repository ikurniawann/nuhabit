import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { interviewSessionCreateSchema } from "@/lib/validations/interview";
import { apiHandler } from "@/lib/api/handler";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { logCandidateActivity, parseBody, requireCandidate } from "@/lib/recruitment/candidates-repo";

/**
 * POST /api/candidates/[id]/interview/sessions: buat undangan interview AI:
 * generate token 256-bit, baris sesi (status 'sent') + jejak aktivitas
 * dalam satu transaksi. Kandidat mengakses portal /interview/[token].
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  if (!checkRateLimit(`interview_session_create_${user.id}`, 20).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const input = await parseBody(req, interviewSessionCreateSchema);

  await requireCandidate(id);

  const token = crypto.randomBytes(32).toString("hex");

  const session = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO recruitment.interview_ai_sessions
         (candidate_id, token, status, config, invited_at, expires_at, created_by, created_by_name)
       VALUES ($1, $2, 'sent', $3, now(), now() + make_interval(days => $4), $5, $6)
       RETURNING id, token, status, invited_at, expires_at`,
      [
        id,
        token,
        JSON.stringify({ max_questions: input.max_questions }),
        input.expires_days,
        user.id,
        user.full_name,
      ]
    );
    await logCandidateActivity(
      id,
      "interview_ai_invited",
      `Undangan interview AI dibuat (maks ${input.max_questions} pertanyaan; berlaku ${input.expires_days} hari)`,
      user,
      client
    );
    return res.rows[0];
  });

  return NextResponse.json({ data: session, message: "Undangan interview dibuat" }, { status: 201 });
}, "candidate-interview-sessions");
