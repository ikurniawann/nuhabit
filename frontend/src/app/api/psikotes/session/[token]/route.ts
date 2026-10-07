import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getPortalSessionData } from "@/lib/recruitment/psikotes-runner";
import { requirePsikotesSession } from "@/lib/recruitment/psikotes-session";

/**
 * GET /api/psikotes/session/[token]: ringkasan sesi utk portal kandidat
 * (anonim, identitas = token). Tidak pernah memuat soal/kunci; soal baru
 * dikirim saat tes dimulai via endpoint start per-tes.
 */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const session = await requirePsikotesSession((await params).token, "get");
  return NextResponse.json({ data: await getPortalSessionData(session) });
}, "psikotes-session");
