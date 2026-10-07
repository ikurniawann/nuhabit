import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { proctorEventSchema } from "@/lib/validations/psikotes";
import { recordProctorEvent } from "@/lib/recruitment/proctor-events";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";
import { assertBodySize, assertInProgress, parseJsonBody } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/psikotes/session/[token]/proctor-event: flag proctoring dan
 * snapshot webcam berkala. Snapshot hanya diterima bila kandidat memberi
 * consent kamera; disimpan di storage PRIVATE.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  assertBodySize(req, 1024 * 1024);
  const session = await requirePsikotesSession((await params).token, "proctor");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  const input = await parseJsonBody(req, proctorEventSchema);
  if (input.event_type === "webcam_snapshot" && !session.webcam_consent) {
    throw ApiError.badRequest("Consent kamera tidak diberikan");
  }
  const created = await recordProctorEvent("psikotes", session.id, input);
  return NextResponse.json({ data: created }, { status: 201 });
}, "psikotes-proctor-event");
