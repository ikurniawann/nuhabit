import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { appOrigin } from "@/lib/app-origin";
import { purchasePassOnline, purchasePassSchema } from "@/lib/ticketing/public-pass-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// Endpoint PUBLIK: beli Season Pass online. Pass dibuat 'pending' → aktif
// saat webhook Xendit PAID. Tanpa Xendit → 503 sebelum insert.

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(
      request.headers,
      "pass-create",
      { limit: 5, windowMs: 5 * 60_000 },
      "Terlalu banyak percobaan — coba lagi beberapa menit lagi"
    );
    const { slug } = await params;
    const body = await validateBody(request, purchasePassSchema);
    return successResponse(
      await purchasePassOnline(slug, body, appOrigin(request)),
      "Pass dibuat — selesaikan pembayaran"
    );
  },
  "public.booking.pass.POST"
);
