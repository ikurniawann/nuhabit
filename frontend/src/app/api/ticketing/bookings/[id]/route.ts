import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  bookingNotesSchema,
  getBookingDetail,
  requireBookingId,
  updateBookingNotes,
} from "@/lib/ticketing/bookings-admin-server";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";

type Params = { params: Promise<{ id: string }> };

// Loket boleh melihat rincian (bantu pengunjung); mutasi tetap admin
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  const id = requireBookingId((await params).id);
  return successResponse(await getBookingDetail(ctx, id));
}, "ticketing.bookings.detail.GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  assertStaffRateLimit(
    `ticketing-booking-refund-note:${ctx.user.id}`,
    20,
    "Terlalu banyak aksi — coba lagi sebentar"
  );
  const id = requireBookingId((await params).id);
  const parsed = bookingNotesSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw ApiError.badRequest("Catatan refund wajib diisi (maks 500 karakter)");
  }
  const updatedId = await updateBookingNotes(ctx, id, parsed.data);
  return successResponse(
    { id: updatedId },
    parsed.data.clear_webhook_alert && parsed.data.refund_note === undefined
      ? "Alert ditandai selesai"
      : "Catatan refund tersimpan"
  );
}, "ticketing.bookings.PATCH");
