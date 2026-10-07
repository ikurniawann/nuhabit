import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { savePsikotesAnswers } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession, requireSessionTest } from "@/lib/recruitment/psikotes-session";
import { assertBodySize, assertInProgress } from "@/lib/recruitment/route-helpers";

/**
 * PUT /api/psikotes/session/[token]/tests/[testId]/answers: autosave jawaban.
 * Hanya soal hasil undian tes ini yang diterima; ditolak setelah deadline + 30 dtk.
 */
export const PUT = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ token: string; testId: string }> }) => {
    const { token, testId } = await params;
    assertBodySize(req, 100_000);
    const session = await requirePsikotesSession(token, "answers");
    assertInProgress(session, "Sesi sudah berakhir");
    const test = await requireSessionTest(session.id, testId);
    const saved = await savePsikotesAnswers(test, req);
    return NextResponse.json({ data: { saved }, message: "Jawaban tersimpan" });
  },
  "psikotes-test-answers"
);
