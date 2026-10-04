import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { psikotesSessionCreateSchema } from "@/lib/validations/psikotes";
import { apiHandler } from "@/lib/api/handler";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { logCandidateActivity, parseBody, requireCandidate } from "@/lib/recruitment/candidates-repo";

/**
 * POST /api/candidates/[id]/psikotes/sessions: buat undangan tes baru:
 * generate token 256-bit, baris sesi (status 'sent') + baris tes per
 * instrumen terpilih, dan jejak aktivitas, dalam SATU transaksi.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  if (!checkRateLimit(`psikotes_session_create_${user.id}`, 20).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const input = await parseBody(req, psikotesSessionCreateSchema);

  await requireCandidate(id);

  const instruments = await query<{ id: string; name: string; sort_order: number }>(
    `SELECT id, name, sort_order FROM recruitment.psikotes_instruments
     WHERE id = ANY($1::uuid[]) AND is_active = true
     ORDER BY sort_order`,
    [input.instrument_ids]
  );
  if (instruments.length !== input.instrument_ids.length) throw ApiError.badRequest("Ada instrumen yang tidak ditemukan atau nonaktif");

  const token = crypto.randomBytes(32).toString("hex");

  const session = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO recruitment.psikotes_sessions
         (candidate_id, token, status, invited_at, expires_at, created_by, created_by_name)
       VALUES ($1, $2, 'sent', now(), now() + make_interval(days => $3), $4, $5)
       RETURNING id, token, status, invited_at, expires_at`,
      [id, token, input.expires_days, user.id, user.full_name]
    );
    const sessionRow = res.rows[0];
    for (const [index, instrument] of instruments.entries()) {
      await client.query(
        `INSERT INTO recruitment.psikotes_session_tests (session_id, instrument_id, sort_order)
         VALUES ($1, $2, $3)`,
        [sessionRow.id, instrument.id, index]
      );
    }
    await logCandidateActivity(
      id,
      "psikotes_invited",
      `Undangan psikotes online dibuat (${instruments.map((i) => i.name).join(", ")}; berlaku ${input.expires_days} hari)`,
      user,
      client
    );
    return sessionRow;
  });

  return NextResponse.json(
    { data: session, message: "Undangan tes dibuat" },
    { status: 201 }
  );
}, "candidate-psikotes-sessions");
