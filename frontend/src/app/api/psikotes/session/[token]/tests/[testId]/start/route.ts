import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { startPsikotesTest } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession, requireSessionTest } from "@/lib/recruitment/psikotes-session";
import { assertInProgress } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/psikotes/session/[token]/tests/[testId]/start: mulai/lanjutkan
 * satu instrumen. Undian soal terjadi sekali; soal dikirim tanpa kunci.
 */
export const POST = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ token: string; testId: string }> }) => {
    const { token, testId } = await params;
    const session = await requirePsikotesSession(token, "test_start");
    assertInProgress(session, "Sesi belum dimulai atau sudah berakhir");
    const test = await requireSessionTest(session.id, testId);
    return NextResponse.json({ data: await startPsikotesTest(session.id, test) });
  },
  "psikotes-test-start"
);
