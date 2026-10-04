import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { offerForCandidate, requireOffer } from "@/lib/recruitment/offer-session";

/** GET /api/offer/session/[token]: rincian penawaran utk portal kandidat (anonim, identitas = token). */
export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const offer = await requireOffer((await params).token, "get");
  return NextResponse.json({ data: { offer: offerForCandidate(offer) } });
}, "offer-session");
