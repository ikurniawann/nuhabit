import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { requireBookingId, resendBookingWa } from "@/lib/ticketing/bookings-admin-server";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";

// Fase D5 — kirim ulang WA kode booking. Rate limit ketat: memicu pesan WA
// keluar ke pelanggan. Loket boleh (keputusan owner 2026-07-22).
export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    assertStaffRateLimit(
      `ticketing-booking-resend:${ctx.user.id}`,
      10,
      "Terlalu sering kirim ulang — tunggu sebentar"
    );
    const id = requireBookingId((await params).id);
    const sent = await resendBookingWa(ctx, id);
    return successResponse(
      { booking_code: sent.booking_code },
      `WA terkirim ulang ke ${sent.customer_phone}`
    );
  },
  "ticketing.bookings.resend-wa.POST"
);
