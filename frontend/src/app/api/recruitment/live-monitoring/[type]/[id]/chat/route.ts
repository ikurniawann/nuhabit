import { NextResponse, type NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  fetchChatMessages,
  insertChatMessage,
  readChatMessage,
  requireLiveSession,
} from "@/lib/recruitment/live-monitor";

/**
 * /api/recruitment/live-monitoring/[type]/[id]/chat (sisi HRD):
 * GET riwayat pesan, POST kirim pesan ke kandidat (sender 'hr').
 */

type Ctx = { params: Promise<{ type: string; id: string }> };

export const GET = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { type, id } = await params;
  const live = await requireLiveSession(type, id);
  const messages = await fetchChatMessages(live.type, live.session.id, req.nextUrl.searchParams.get("after"));
  return NextResponse.json({ data: messages });
}, "live-monitoring-chat");

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
  const { type, id } = await params;
  const live = await requireLiveSession(type, id);
  const saved = await insertChatMessage({
    type: live.type,
    sessionId: live.session.id,
    sender: "hr",
    senderName: user.full_name || "HRD",
    message: await readChatMessage(req),
  });
  return NextResponse.json({ data: saved }, { status: 201 });
}, "live-monitoring-chat");
