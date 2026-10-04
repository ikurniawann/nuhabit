import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { psikotesSummarySchema } from "@/lib/validations/psikotes";
import { apiHandler } from "@/lib/api/handler";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { logCandidateActivity, parseBody, requireCandidate } from "@/lib/recruitment/candidates-repo";

/**
 * PUT /api/candidates/[id]/psikotes/summary: rekomendasi keseluruhan
 * psikotes (1 baris/kandidat, upsert; pola candidate_screenings task 7).
 * Upsert + jejak aktivitas dalam SATU transaksi supaya "tersimpan" selalu
 * berarti "teraudit". Menjadi gate tombol "Lolos → Interview".
 */

const RECOMMENDATION_LABELS: Record<string, string> = {
  lolos: "Lolos",
  hold: "Hold",
  tidak_lolos: "Tidak Lolos",
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const PUT = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  if (!checkRateLimit(`psikotes_summary_put_${user.id}`).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const input = await parseBody(req, psikotesSummarySchema);

  await requireCandidate(id);

  const recLabel = input.recommendation
    ? ` (rekomendasi: ${RECOMMENDATION_LABELS[input.recommendation]})`
    : "";

  const saved = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO recruitment.candidate_psikotes_summary
         (candidate_id, recommendation, notes, updated_by, updated_by_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (candidate_id) DO UPDATE SET
         recommendation  = EXCLUDED.recommendation,
         notes           = EXCLUDED.notes,
         updated_by      = EXCLUDED.updated_by,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at      = now()
       RETURNING id, candidate_id, recommendation, notes, updated_by, updated_by_name,
                 created_at, updated_at`,
      [id, input.recommendation, input.notes, user.id, user.full_name]
    );
    await logCandidateActivity(
      id,
      "psikotes_summary_updated",
      `Rekomendasi psikotes disimpan${recLabel}`,
      user,
      client
    );
    return res.rows[0];
  });

  return NextResponse.json({ data: saved, message: "Rekomendasi psikotes tersimpan" });
}, "candidate-psikotes-summary");
