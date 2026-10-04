import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";
import { liveFrameSchema, saveLiveFrame } from "@/lib/recruitment/live-monitor";
import { assertBodySize, assertInProgress, parseJsonBody } from "@/lib/recruitment/route-helpers";

/** POST /api/interview/session/[token]/live-frame: frame near-live utk Live Monitoring HRD. */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  assertBodySize(req, 1024 * 1024);
  const session = await requireInterviewSession((await params).token, "frame");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  const { frame } = await parseJsonBody(req, liveFrameSchema, "Frame tidak valid");
  await saveLiveFrame("interview", session.id, frame);
  return NextResponse.json({ data: { ok: true } });
}, "interview-live-frame");
