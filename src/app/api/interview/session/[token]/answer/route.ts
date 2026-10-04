import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { answerInterview, MAX_AUDIO_BYTES } from "@/lib/recruitment/interview-runner";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";
import { assertBodySize, assertInProgress } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/interview/session/[token]/answer: jawaban kandidat (multipart
 * turn_id, mode voice|text, audio | answer_text). AI lalu bertanya lagi
 * (+TTS) atau menutup sesi dengan kesimpulan.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const session = await requireInterviewSession((await params).token, "answer");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  assertBodySize(req, MAX_AUDIO_BYTES + 64 * 1024);
  return NextResponse.json({ data: await answerInterview(session, req) });
}, "interview-answer");
