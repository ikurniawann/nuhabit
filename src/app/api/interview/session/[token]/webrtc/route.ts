import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";
import { assertInProgress, parseJsonBody } from "@/lib/recruitment/route-helpers";
import { getPendingOffers, putAnswer, sdpSchema } from "@/lib/recruitment/webrtc-signaling";

/**
 * Signaling WebRTC sisi kandidat (interview AI):
 * GET  → offer pending dari HRD; POST {offer_id, sdp} → answer kandidat.
 */

type Ctx = { params: Promise<{ token: string }> };
const answerSchema = z.object({ offer_id: z.string(), sdp: sdpSchema });

export const GET = apiHandler(async (_req: NextRequest, { params }: Ctx) => {
  const session = await requireInterviewSession((await params).token, "webrtc");
  const offers = session.status === "in_progress" ? getPendingOffers("interview", session.id) : [];
  return NextResponse.json({ data: { offers } });
}, "interview-webrtc");

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const session = await requireInterviewSession((await params).token, "webrtc");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  const { offer_id, sdp } = await parseJsonBody(req, answerSchema, "Payload tidak valid");
  return NextResponse.json({ data: { ok: putAnswer("interview", session.id, offer_id, sdp) } });
}, "interview-webrtc");
