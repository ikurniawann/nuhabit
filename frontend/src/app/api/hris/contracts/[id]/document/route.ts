import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildContractPdf, contractFileName } from "@/lib/hris/contract-pdf";
import { loadContractDocument } from "@/lib/hris/contracts-repo";
import { requireUuid } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/contracts/[id]/document — PDF surat perjanjian kerja
 * (PKWT/PKWTT), digenerate on-the-fly; draft tetap bisa dicetak.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const id = requireUuid((await params).id, "ID kontrak tidak valid");
  if (!checkRateLimit(`contract_pdf_${user.id}`, 30).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi");
  }

  const data = await loadContractDocument(id);
  const pdf = await buildContractPdf(data);
  const fileName = contractFileName(data.contract.contract_number, data.employee.full_name);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}, "hris/contracts/document GET");
