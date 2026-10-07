import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { finishPsikotesTest } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession, requireSessionTest } from "@/lib/recruitment/psikotes-session";
import { assertBodySize, assertInProgress } from "@/lib/recruitment/route-helpers";

/**
 * POST /api/psikotes/session/[token]/tests/[testId]/finish: akhiri satu tes
 * (scoring server-side; tes gambar → perlu_review). Body {answers} opsional.
 */
export const POST = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ token: string; testId: string }> }) => {
    const { token, testId } = await params;
    assertBodySize(req, 100_000);
    const session = await requirePsikotesSession(token, "test_finish");
    assertInProgress(session, "Sesi sudah berakhir");
    const test = await requireSessionTest(session.id, testId);
    return NextResponse.json(await finishPsikotesTest(test, req));
  },
  "psikotes-test-finish"
);
