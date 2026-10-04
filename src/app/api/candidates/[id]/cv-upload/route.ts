import { uploadFile, validateFile } from "@/lib/storage";
import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];

// POST /api/candidates/[id]/cv-upload
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { id: candidateId } = await params;

  // Verify candidate exists
  const { data: candidate, error: candidateError } = await db
    .from("candidates")
    .select("id")
    .eq("id", candidateId)
    .single();

  if (candidateError || !candidate) {
    return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }

  // Validate file type
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: `Tipe file tidak valid. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
      { status: 400 }
    );
  }

  // Validate file type + size
  const validation = validateFile(file);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Upload to local storage
  const { url, error: uploadError } = await uploadFile(
    "candidates",
    file,
    "cvs"
  );

  if (uploadError) {
    return NextResponse.json({ error: `Upload gagal: ${uploadError}` }, { status: 500 });
  }

  // Update candidate with cv_url
  const { error: updateError } = await db
    .from("candidates")
    .update({ cv_url: url, updated_at: new Date().toISOString() })
    .eq("id", candidateId);

  if (updateError) {
    return NextResponse.json(
      { error: `Gagal menyimpan CV: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { cv_url: url }, message: "CV berhasil diupload" });
}

// DELETE /api/candidates/[id]/cv-upload
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const db = await createServerPgClient();
  const { id: candidateId } = await params;

  const { error: updateError } = await db
    .from("candidates")
    .update({ cv_url: null, updated_at: new Date().toISOString() })
    .eq("id", candidateId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ message: "CV berhasil dihapus" });
}
