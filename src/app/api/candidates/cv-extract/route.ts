import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { ocrCandidateCv, OpenAiNotConfiguredError } from "@/lib/recruitment/cv-ocr";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB, sama dengan batas upload CV

// POST /api/candidates/cv-extract
// OCR CV via OpenAI untuk mengisi otomatis form Tambah Kandidat Manual.
// File belum tersimpan sebagai kandidat — dikirim multipart langsung dari dialog.
export async function POST(request: Request) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const clientIp = request.headers.get("x-forwarded-for") || "anonymous";
  const rateLimit = checkRateLimit(`cv_extract_${clientIp}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan. Coba lagi beberapa saat." },
      { status: 429 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: `Tipe file tidak valid. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Ukuran file maksimal 10MB" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fields = await ocrCandidateCv(buffer, file.name);
    return NextResponse.json({ data: fields });
  } catch (error) {
    if (error instanceof OpenAiNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[cv-extract] OCR gagal:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OCR CV gagal" },
      { status: 500 }
    );
  }
}
