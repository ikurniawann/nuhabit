import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { readPrivateFile } from "@/lib/storage-private";
import { safeSegmentsUnder } from "@/lib/security/safe-path";

/**
 * GET /api/psikotes/files/[...path] — sajikan berkas PRIVATE psikotes
 * (gambar tes proyektif & snapshot proctoring) khusus role HR.
 * Berbeda dgn /api/files yang publik: route ini ber-auth dan menolak
 * path traversal (safeSegmentsUnder + readPrivateFile).
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const segments = safeSegmentsUnder((await params).path, "psikotes");
    if (!segments) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }
    const rel = segments.join("/");
    const { data, mime } = await readPrivateFile(rel);
    if (!data) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-files] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
