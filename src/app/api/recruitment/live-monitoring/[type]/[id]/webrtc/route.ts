import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { isUuid } from "@/lib/recruitment/candidate-query";
import { isLiveSessionRunning, isLiveSessionType } from "@/lib/recruitment/live-monitor";
import { parseJsonBody } from "@/lib/recruitment/route-helpers";
import { getAnswer, putOffer, sdpSchema } from "@/lib/recruitment/webrtc-signaling";

/**
 * Signaling WebRTC sisi HRD:
 * POST {offer_id, sdp} → simpan offer; GET ?offer_id=xxx → {sdp: answer|null}.
 */

type Ctx = { params: Promise<{ type: string; id: string }> };
const OFFER_ID_RE = /^[a-z0-9-]{8,64}$/i;
const offerSchema = z.object({ offer_id: z.string().regex(OFFER_ID_RE), sdp: sdpSchema });

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { type, id } = await params;
  if (!isLiveSessionType(type) || !(await isLiveSessionRunning(type, id))) {
    throw ApiError.notFound("Sesi tidak sedang berjalan");
  }
  const { offer_id, sdp } = await parseJsonBody(req, offerSchema, "Payload tidak valid");
  putOffer(type, id, offer_id, sdp);
  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}, "live-webrtc");

export const GET = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { type, id } = await params;
  if (!isLiveSessionType(type) || !isUuid(id)) throw ApiError.badRequest("Sesi tidak valid");
  const offerId = req.nextUrl.searchParams.get("offer_id") ?? "";
  if (!OFFER_ID_RE.test(offerId)) throw ApiError.badRequest("offer_id tidak valid");
  return NextResponse.json({ data: { sdp: getAnswer(type, id, offerId) } });
}, "live-webrtc");
