import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { redeemBooking, redeemSchema } from "@/lib/ticketing/booking-redeem-server";
import { requireBookingId } from "@/lib/ticketing/bookings-admin-server";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    assertStaffRateLimit(
      `ticketing-booking-redeem:${ctx.user.id}`,
      20,
      "Terlalu banyak redeem — coba lagi sebentar"
    );
    const id = requireBookingId((await params).id);
    const body = await validateBody(request, redeemSchema);
    const result = await redeemBooking(ctx, id, body);
    return successResponse(
      { visit_id: result.visitId },
      `Booking ${result.bookingCode} di-redeem — gelang siap dipakai`
    );
  },
  "ticketing.bookings.redeem.POST"
);
