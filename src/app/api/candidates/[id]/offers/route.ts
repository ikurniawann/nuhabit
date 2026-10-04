import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { offerCreateSchema } from "@/lib/validations/offer";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { logCandidateActivity, parseBody } from "@/lib/recruitment/candidates-repo";

/**
 * /api/candidates/[id]/offers: panel Offer HRD.
 * GET : daftar offer (semua versi) + referensi gaji (ekspektasi lamaran,
 *       ekspektasi saat interview AI, range gaji posisi).
 * POST: buat offer baru (status 'sent' + token portal). Versi = versi
 *       terakhir + 1; offer non-terminal sebelumnya otomatis expired.
 */

const TOKEN_ROLES = new Set(["super_admin", "admin", "hrd"]);

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");

  const [candidate, offers, interviewSummary] = await Promise.all([
    queryOne<{
      id: string;
      expected_salary: string | null;
      position_title: string | null;
      salary_min: string | null;
      salary_max: string | null;
    }>(
      `SELECT c.id, c.expected_salary, p.title AS position_title,
              p.salary_min, p.salary_max
       FROM recruitment.candidates c
       LEFT JOIN hris.positions p ON p.id = c.position_id
       WHERE c.id = $1`,
      [id]
    ),
    query(
      `SELECT id, version, token, status, position_title, base_salary, benefits,
              start_date, notes, response_note, responded_at, response_source,
              sent_at, expires_at, created_by_name, created_at
       FROM recruitment.candidate_offers
       WHERE candidate_id = $1
       ORDER BY version DESC`,
      [id]
    ),
    // ekspektasi gaji yang diucapkan kandidat saat interview AI (sesi
    // completed terbaru yang punya kesimpulan)
    queryOne<{ ekspektasi: unknown }>(
      `SELECT ai_summary -> 'ekspektasi_gaji' AS ekspektasi
       FROM recruitment.interview_ai_sessions
       WHERE candidate_id = $1 AND status = 'completed' AND ai_summary IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [id]
    ),
  ]);

  if (!candidate) throw ApiError.notFound("Kandidat tidak ditemukan");

  return NextResponse.json({
    data: {
      salary_reference: {
        expected_salary: candidate.expected_salary ? Number(candidate.expected_salary) : null,
        interview_expectation: interviewSummary?.ekspektasi ?? null,
        position_title: candidate.position_title,
        salary_min: candidate.salary_min ? Number(candidate.salary_min) : null,
        salary_max: candidate.salary_max ? Number(candidate.salary_max) : null,
      },
      offers: offers.map((o) => ({
        ...o,
        base_salary: Number(o.base_salary),
        token: TOKEN_ROLES.has(user.role) ? o.token : null,
      })),
    },
  });
}, "candidate-offers");

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  if (!checkRateLimit(`offer_create_${user.id}`, 20).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }
  const input = await parseBody(req, offerCreateSchema);

  const candidate = await queryOne<{ id: string; position_title: string | null }>(
    `SELECT c.id, p.title AS position_title
     FROM recruitment.candidates c
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE c.id = $1`,
    [id]
  );
  if (!candidate) throw ApiError.notFound("Kandidat tidak ditemukan");

  const token = crypto.randomBytes(32).toString("hex");

  const offer = await withTransaction(async (client) => {
    // revisi baru menggantikan offer yang masih terbuka
    await client.query(
      `UPDATE recruitment.candidate_offers
       SET status = 'expired'
       WHERE candidate_id = $1 AND status IN ('sent', 'negotiating')`,
      [id]
    );
    const ver = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM recruitment.candidate_offers
       WHERE candidate_id = $1`,
      [id]
    );
    const version = Number(ver.rows[0].next);
    const res = await client.query(
      `INSERT INTO recruitment.candidate_offers
         (candidate_id, version, token, status, position_title, base_salary,
          benefits, start_date, notes, sent_at, expires_at, created_by, created_by_name)
       VALUES ($1, $2, $3, 'sent', $4, $5, $6, $7, $8, now(),
               now() + make_interval(days => $9), $10, $11)
       RETURNING id, version, token, status, sent_at, expires_at`,
      [
        id,
        version,
        token,
        candidate.position_title,
        input.base_salary,
        JSON.stringify(input.benefits),
        input.start_date ?? null,
        input.notes?.trim() || null,
        input.expires_days,
        user.id,
        user.full_name,
      ]
    );
    await logCandidateActivity(
      id,
      "offer_sent",
      `Offer v${version} dibuat (berlaku ${input.expires_days} hari)`,
      user,
      client
    );
    return res.rows[0];
  });

  return NextResponse.json({ data: offer, message: "Offer dibuat" }, { status: 201 });
}, "candidate-offers");
