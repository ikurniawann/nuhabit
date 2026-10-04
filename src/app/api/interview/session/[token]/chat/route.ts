import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";
import { fetchChatMessages, sendCandidateChat } from "@/lib/recruitment/live-monitor";

/** GET/POST /api/interview/session/[token]/chat: live chat kandidat ↔ HRD. */

type Ctx = { params: Promise<{ token: string }> };

export const GET = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const session = await requireInterviewSession((await params).token, "chat");
  const messages = await fetchChatMessages("interview", session.id, req.nextUrl.searchParams.get("after"));
  return NextResponse.json({ data: messages });
}, "interview-chat");

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const session = await requireInterviewSession((await params).token, "chat");
  const saved = await sendCandidateChat("interview", session, req);
  return NextResponse.json({ data: saved }, { status: 201 });
}, "interview-chat");
