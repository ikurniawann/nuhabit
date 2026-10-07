import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { appendRecordingChunk, MAX_CHUNK_BYTES } from "@/lib/recruitment/interview-runner";
import { requireInterviewSession } from "@/lib/recruitment/interview-session";
import { assertBodySize, assertInProgress } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/interview/session/[token]/recording-chunk: potongan rekaman
 * video interview (multipart chunk + part) di-append ke storage private.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  assertBodySize(req, MAX_CHUNK_BYTES + 64 * 1024, "Chunk terlalu besar");
  const session = await requireInterviewSession((await params).token, "recording");
  assertInProgress(session, "Sesi tidak sedang berjalan");
  return NextResponse.json({ data: await appendRecordingChunk(session, req) });
}, "interview-recording-chunk");
