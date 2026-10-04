import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import { extractCvText } from "@/lib/recruitment/cv-extract";
import { analyzeCvWithDeepseek, DeepseekNotConfiguredError } from "@/lib/recruitment/deepseek";
import { isUuid } from "@/lib/recruitment/candidate-query";
import {
  formatJobContext,
  type JobOpeningContext,
  type PositionContext,
} from "@/lib/recruitment/candidate-job-context";

/**
 * GET  /api/candidates/[id]/ai-analysis: hasil analisis tersimpan (null jika belum ada).
 * POST /api/candidates/[id]/ai-analysis: jalankan (ulang) ekstraksi CV + analisis DeepSeek.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ANALYSIS_FIELDS = `id, candidate_id, extracted, summary, match_score, match_reason,
  job_context, model, created_at, updated_at`;

/** Ekstraksi teks CV (pdf/docx/ocr) lalu analisis DeepSeek. */
async function analyzeCv(cvUrl: string, jobContext: string | null) {
  try {
    const { text: cvText, method } = await extractCvText(cvUrl);
    const { result, model } = await analyzeCvWithDeepseek(cvText, jobContext);
    return { cvText, method, result, model };
  } catch (error) {
    if (error instanceof DeepseekNotConfiguredError) throw ApiError.badRequest(error.message);
    // detail galat ekstraksi/DeepSeek cukup di log server
    console.error("[ai-analysis] analisis gagal:", error);
    throw ApiError.server("Analisis CV gagal");
  }
}

export const GET = apiHandler(async (_req: Request, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  const row = await queryOne(
    `SELECT ${ANALYSIS_FIELDS} FROM recruitment.candidate_ai_analysis WHERE candidate_id = $1`,
    [id]
  );
  return NextResponse.json({ data: row ?? null });
}, "ai-analysis");

export const POST = apiHandler(async (_req: Request, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");

  const candidate = await queryOne<{
    cv_url: string | null;
    position_id: string | null;
    job_opening_id: string | null;
  }>("SELECT cv_url, position_id, job_opening_id FROM recruitment.candidates WHERE id = $1", [id]);
  if (!candidate) throw ApiError.notFound("Kandidat tidak ditemukan");
  if (!candidate.cv_url) throw ApiError.badRequest("Kandidat belum memiliki lampiran CV");

  const [job, position] = await Promise.all([
    candidate.job_opening_id
      ? queryOne<JobOpeningContext>(
          "SELECT title, description, requirements FROM recruitment.job_openings WHERE id = $1",
          [candidate.job_opening_id]
        )
      : null,
    candidate.position_id
      ? queryOne<PositionContext>(
          "SELECT title, department, level FROM hris.positions WHERE id = $1",
          [candidate.position_id]
        )
      : null,
  ]);
  const jobContext = formatJobContext(job, position);

  const { cvText, method, result, model } = await analyzeCv(candidate.cv_url, jobContext);

  const extracted = {
    nama: result.nama,
    email: result.email,
    no_hp: result.no_hp,
    sumber: result.sumber,
    pendidikan: result.pendidikan,
    pengalaman: result.pengalaman,
    metode_ekstraksi: method,
  };

  const row = await queryOne(
    `INSERT INTO recruitment.candidate_ai_analysis
       (candidate_id, cv_text, extracted, summary, match_score, match_reason, job_context, model, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, now())
     ON CONFLICT (candidate_id) DO UPDATE SET
       cv_text = EXCLUDED.cv_text,
       extracted = EXCLUDED.extracted,
       summary = EXCLUDED.summary,
       match_score = EXCLUDED.match_score,
       match_reason = EXCLUDED.match_reason,
       job_context = EXCLUDED.job_context,
       model = EXCLUDED.model,
       updated_at = now()
     RETURNING ${ANALYSIS_FIELDS}`,
    [id, cvText, JSON.stringify(extracted), result.ringkasan, result.skor_kecocokan, result.alasan_kecocokan, jobContext, model]
  );

  return NextResponse.json({ data: row, message: "Analisis CV selesai" });
}, "ai-analysis");
