import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getInterviewPortalData } from "@/lib/recruitment/interview-runner";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";

/**
 * GET /api/interview/session/[token]: ringkasan sesi utk portal kandidat.
 * Kesimpulan AI TIDAK pernah dikirim; audio TTS pertanyaan aktif ikut
 * dikirim (base64) supaya bisa diputar ulang setelah reload.
 */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const session = await requireInterviewSession((await params).token, "get");
  return NextResponse.json({ data: await getInterviewPortalData(session) });
}, "interview-session");
