import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { cancelBooking } from "@/lib/studio/booking-server";
import { bookingCancelSchema } from "@/lib/studio/schemas";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("booking cancel", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const b = await validateBody(request, bookingCancelSchema);
    const res = await cancelBooking(staffActor(ctx), id, { reason: b.reason, waive: b.waive });
    const message =
      res.status === "late_cancelled"
        ? "Batal telat — kredit hangus sesuai aturan"
        : `Booking dibatalkan${res.refunded ? " · kredit dikembalikan" : ""}${res.promoted ? ` · ${res.promoted} member naik dari waitlist` : ""}`;
    return NextResponse.json({ success: true, data: res, message });
  });
}
