import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { cancelBooking, requireBookingId } from "@/lib/ticketing/bookings-admin-server";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";

const cancelSchema = z.object({
  refund_note: z.string().trim().max(500).optional().nullable(),
});

// Fase D5 — batalkan booking (admin; keputusan manusia, bukan otomatis).
export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    assertStaffRateLimit(
      `ticketing-booking-cancel:${ctx.user.id}`,
      20,
      "Terlalu banyak aksi — coba lagi sebentar"
    );
    const id = requireBookingId((await params).id);
    const body = await validateBody(request, cancelSchema);
    const result = await cancelBooking(ctx, id, body.refund_note?.trim() || null);
    return successResponse({ id: result.id }, `Booking ${result.bookingCode} dibatalkan`);
  },
  "ticketing.bookings.cancel.POST"
);
