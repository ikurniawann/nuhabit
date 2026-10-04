import { NextResponse, type NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { getPipelineReportData } from "@/lib/recruitment/pipeline-report";
import { buildPipelineReportPdf } from "@/lib/recruitment/pipeline-report-pdf";
import { reportFileName } from "@/lib/recruitment/pipeline-report-format";

/**
 * GET /api/candidates/[id]/report: PDF laporan perjalanan pipeline kandidat
 * (profil, analisis AI CV, screening, psikotes, interview AI, offer, timeline).
 * Digenerate on-the-fly agar selalu mengikuti data terbaru; tersedia mulai
 * tahap Offer.
 */

const REPORT_STAGES = new Set(["offer", "hired"]);

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.badRequest("ID kandidat tidak valid");
  if (!checkRateLimit(`pipeline_report_${user.id}`, 30).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const data = await getPipelineReportData(id);
  if (!data) throw ApiError.notFound("Kandidat tidak ditemukan");
  if (!REPORT_STAGES.has(data.candidate.status)) {
    throw ApiError.conflict("Laporan pipeline tersedia mulai tahap Offer");
  }

  const pdf = await buildPipelineReportPdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="${reportFileName(data.candidate.full_name)}"`,
      "Cache-Control": "no-store",
    },
  });
}, "pipeline-report");
