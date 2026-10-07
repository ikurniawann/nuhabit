import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { screeningSchema } from "@/lib/validations/candidate";
import { apiHandler } from "@/lib/api/handler";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { logCandidateActivity, parseBody, requireCandidate } from "@/lib/recruitment/candidates-repo";

/**
 * Hasil screening call terstruktur, 1 baris per kandidat.
 * GET /api/candidates/[id]/screening: muat hasil (null jika belum ada).
 * PUT /api/candidates/[id]/screening: upsert; upsert + jejak aktivitas ditulis
 * dalam SATU transaksi supaya "tersimpan" selalu berarti "teraudit" (AC epic).
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const SELECT_FIELDS = `id, candidate_id, contacted, interested, availability_note,
  confirmed_salary::float8 AS confirmed_salary, willing_shift, willing_placement,
  notes, recommendation, updated_by, updated_by_name, created_at, updated_at`;

const RECOMMENDATION_LABELS: Record<string, string> = {
  lolos: "Lolos",
  hold: "Hold",
  tidak_lolos: "Tidak Lolos",
};

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  const row = await queryOne(
    `SELECT ${SELECT_FIELDS} FROM recruitment.candidate_screenings WHERE candidate_id = $1`,
    [id]
  );
  return NextResponse.json({ data: row ?? null });
}, "candidate-screening");

export const PUT = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");

  // key ke user.id: X-Forwarded-For bisa dipalsukan client
  if (!checkRateLimit(`candidate_screening_put_${user.id}`).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const input = await parseBody(req, screeningSchema);

  await requireCandidate(id);

  const recLabel = input.recommendation
    ? ` (rekomendasi: ${RECOMMENDATION_LABELS[input.recommendation]})`
    : "";

  const saved = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO recruitment.candidate_screenings
         (candidate_id, contacted, interested, availability_note, confirmed_salary,
          willing_shift, willing_placement, notes, recommendation, updated_by, updated_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (candidate_id) DO UPDATE SET
         contacted = EXCLUDED.contacted,
         interested = EXCLUDED.interested,
         availability_note = EXCLUDED.availability_note,
         confirmed_salary = EXCLUDED.confirmed_salary,
         willing_shift = EXCLUDED.willing_shift,
         willing_placement = EXCLUDED.willing_placement,
         notes = EXCLUDED.notes,
         recommendation = EXCLUDED.recommendation,
         updated_by = EXCLUDED.updated_by,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at = now()
       RETURNING ${SELECT_FIELDS}`,
      [
        id,
        input.contacted,
        input.interested,
        input.availability_note,
        input.confirmed_salary,
        input.willing_shift,
        input.willing_placement,
        input.notes,
        input.recommendation,
        user.id,
        user.full_name,
      ]
    );

    await logCandidateActivity(
      id,
      "screening_updated",
      `Hasil screening disimpan${recLabel}`,
      user,
      client
    );

    return res.rows[0];
  });

  return NextResponse.json({ data: saved, message: "Hasil screening tersimpan" });
}, "candidate-screening");
