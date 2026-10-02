import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { createBooking } from "@/lib/studio/booking-server";
import { bookingCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

/** Booking dari front desk (opsional langsung check-in = walk-in). */
export async function POST(request: NextRequest) {
  return studioRoute("bookings POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, bookingCreateSchema);
    const res = await createBooking(staffActor(ctx), {
      session_id: b.session_id,
      customer_id: b.customer_id,
      source: b.check_in ? "walk_in" : "front_desk",
      check_in: b.check_in,
      notes: b.notes,
    });
    const message =
      res.status === "waitlisted"
        ? "Kelas penuh — member masuk waitlist (kredit dikunci saat naik)"
        : `${res.status === "attended" ? "Check-in" : "Booking"} berhasil · pass ${res.pass_code} sisa ${res.class_left} kelas`;
    return NextResponse.json({ success: true, data: res, message }, { status: 201 });
  });
}
