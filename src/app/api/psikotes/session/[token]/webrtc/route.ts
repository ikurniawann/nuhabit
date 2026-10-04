import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";
import { assertInProgress, parseJsonBody } from "@/lib/recruitment/route-helpers";
import { getPendingOffers, putAnswer, sdpSchema } from "@/lib/recruitment/webrtc-signaling";

/**
 * Signaling WebRTC sisi kandidat (psikotes):
 * GET  → offer pending dari HRD; POST {offer_id, sdp} → answer kandidat.
 */

type Ctx = { params: Promise<{ token: string }> };
const answerSchema = z.object({ offer_id: z.string(), sdp: sdpSchema });

export const GET = apiHandler(async (_req: NextRequest, { params }: Ctx) => {
  const session = await requirePsikotesSession((await params).token, "webrtc");
  const offers = session.status === "in_progress" ? getPendingOffers("psikotes", session.id) : [];
  return NextResponse.json({ data: { offers } });
}, "psikotes-webrtc");

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const session = await requirePsikotesSession((await params).token, "webrtc");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  const { offer_id, sdp } = await parseJsonBody(req, answerSchema, "Payload tidak valid");
  return NextResponse.json({ data: { ok: putAnswer("psikotes", session.id, offer_id, sdp) } });
}, "psikotes-webrtc");
