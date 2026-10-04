import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { MAX_DRAWING_BYTES, uploadPsikotesDrawing } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession, requireSessionTest } from "@/lib/recruitment/psikotes-session";
import { assertBodySize, assertInProgress } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/psikotes/session/[token]/tests/[testId]/upload: unggah foto hasil
 * tes gambar (multipart, field "file") ke storage PRIVATE; HR membukanya
 * lewat /api/psikotes/files yang ber-auth.
 */
export const POST = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ token: string; testId: string }> }) => {
    const { token, testId } = await params;
    // tolak sebelum formData() mem-buffer body besar; +1MB utk overhead multipart
    assertBodySize(req, MAX_DRAWING_BYTES + 1024 * 1024);
    const session = await requirePsikotesSession(token, "upload");
    assertInProgress(session, "Sesi sudah berakhir");
    const test = await requireSessionTest(session.id, testId);
    await uploadPsikotesDrawing(session.id, test, req);
    return NextResponse.json({ data: { uploaded: true }, message: "Gambar terunggah" });
  },
  "psikotes-test-upload"
);
