import { NextResponse, type NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireOffer, respondToOffer } from "@/lib/recruitment/offer-session";

/**
 * POST /api/offer/session/[token]/respond: kandidat menerima / menego /
 * menolak penawaran. Respons + waktu + IP tercatat sebagai bukti digital.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const offer = await requireOffer((await params).token, "respond");
  const ip =
    req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const updated = await respondToOffer(offer, req, ip);
  return NextResponse.json({ data: updated, message: "Respons Anda tercatat" });
}, "offer-respond");
