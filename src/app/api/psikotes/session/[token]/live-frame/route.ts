import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { liveFrameSchema, saveLiveFrame } from "@/lib/recruitment/live-monitor";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";
import { assertBodySize, assertInProgress, parseJsonBody } from "@/lib/recruitment/route-helpers";

/** POST /api/psikotes/session/[token]/live-frame: frame near-live utk Live Monitoring HRD. */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  assertBodySize(req, 1024 * 1024);
  const session = await requirePsikotesSession((await params).token, "frame");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  const { frame } = await parseJsonBody(req, liveFrameSchema, "Frame tidak valid");
  await saveLiveFrame("psikotes", session.id, frame);
  return NextResponse.json({ data: { ok: true } });
}, "psikotes-live-frame");
