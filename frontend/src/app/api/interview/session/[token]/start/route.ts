import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { startInterview } from "@/lib/recruitment/interview-runner";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";

/**
 * POST /api/interview/session/[token]/start: kandidat memulai interview
 * (consent kamera wajib). Idempoten: sesi berjalan → pertanyaan aktif.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const session = await requireInterviewSession((await params).token, "start");
  return NextResponse.json({ data: await startInterview(session, req) });
}, "interview-start");
