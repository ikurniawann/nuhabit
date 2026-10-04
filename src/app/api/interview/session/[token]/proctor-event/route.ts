import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { interviewProctorEventSchema } from "@/lib/validations/interview";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";
import { recordProctorEvent } from "@/lib/recruitment/proctor-events";
import { assertBodySize, assertInProgress, parseJsonBody } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/interview/session/[token]/proctor-event: flag proctoring
 * (tab/fullscreen/paste/disconnect, deteksi wajah, kamera mati) dan
 * snapshot webcam ke storage PRIVATE.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  assertBodySize(req, 1024 * 1024);
  const session = await requireInterviewSession((await params).token, "proctor");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  const input = await parseJsonBody(req, interviewProctorEventSchema);
  await recordProctorEvent("interview", session.id, input);
  return NextResponse.json({ data: { ok: true } });
}, "interview-proctor-event");
