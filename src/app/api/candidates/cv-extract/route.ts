import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { checkRateLimit } from "@/lib/rate-limit";
import { readCvFile } from "@/lib/recruitment/candidate-cv";
import { ocrCandidateCv, OpenAiNotConfiguredError } from "@/lib/recruitment/cv-ocr";

// POST /api/candidates/cv-extract
// OCR CV via OpenAI untuk mengisi otomatis form Tambah Kandidat Manual.
// File belum tersimpan sebagai kandidat: dikirim multipart langsung dari dialog.
export const POST = apiHandler(async (request: Request) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  if (!checkRateLimit(`cv_extract_${user.id}`).allowed) {
    throw ApiError.tooManyRequests("Terlalu banyak permintaan. Coba lagi beberapa saat.");
  }

  const file = await readCvFile(request);
  try {
    const fields = await ocrCandidateCv(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ data: fields });
  } catch (error) {
    if (error instanceof OpenAiNotConfiguredError) throw ApiError.badRequest(error.message);
    // detail galat OpenAI cukup di log server
    console.error("[cv-extract] OCR gagal:", error);
    throw ApiError.server("OCR CV gagal");
  }
}, "cv-extract");
