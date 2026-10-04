import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { fetchChatMessages, sendCandidateChat } from "@/lib/recruitment/live-monitor";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";

/** GET/POST /api/psikotes/session/[token]/chat: live chat kandidat ↔ HRD. */

type Ctx = { params: Promise<{ token: string }> };

export const GET = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const session = await requirePsikotesSession((await params).token, "chat");
  const messages = await fetchChatMessages("psikotes", session.id, req.nextUrl.searchParams.get("after"));
  return NextResponse.json({ data: messages });
}, "psikotes-chat");

export const POST = apiHandler(async (req: NextRequest, { params }: Ctx) => {
  const session = await requirePsikotesSession((await params).token, "chat");
  const saved = await sendCandidateChat("psikotes", session, req);
  return NextResponse.json({ data: saved }, { status: 201 });
}, "psikotes-chat");
