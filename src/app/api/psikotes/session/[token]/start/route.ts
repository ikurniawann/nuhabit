import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { startPsikotesSession } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";
import { assertBodySize } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/psikotes/session/[token]/start: kandidat memulai sesi, merekam
 * consent kamera (draft/sent → in_progress). Idempoten utk sesi berjalan.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  assertBodySize(req, 10_000);
  const session = await requirePsikotesSession((await params).token, "start");
  const updated = await startPsikotesSession(session, req);
  return NextResponse.json({ data: updated, message: "Sesi dimulai" });
}, "psikotes-session-start");
