import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { finishPsikotesSession } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";

/**
 * POST /api/psikotes/session/[token]/finish: tutup sesi setelah SEMUA tes
 * terminal dan catat jejak 'psikotes_completed' (atribusi "Sistem").
 */
export const POST = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const session = await requirePsikotesSession((await params).token, "finish");
  return NextResponse.json(await finishPsikotesSession(session));
}, "psikotes-session-finish");
