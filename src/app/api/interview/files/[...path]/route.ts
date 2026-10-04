import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { readPrivateFile } from "@/lib/storage-private";
import { safeSegmentsUnder } from "@/lib/security/safe-path";

/**
 * GET /api/interview/files/[...path] — sajikan berkas PRIVATE interview AI
 * (rekaman jawaban, audio TTS, snapshot proctoring) khusus role HR.
 * Menolak path traversal (safeSegmentsUnder) dan path di luar interview/.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const segments = safeSegmentsUnder((await params).path, "interview");
    if (!segments) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }
    const rel = segments.join("/");
    const { data, mime } = await readPrivateFile(rel);
    if (!data) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }
    // rekaman interview = video webm (readPrivateFile memetakan .webm ke audio)
    const contentType = rel.includes("/recording/") ? "video/webm" : mime;
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[interview-files] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
