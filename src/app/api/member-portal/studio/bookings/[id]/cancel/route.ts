import { NextRequest, NextResponse } from "next/server";
import { cancelBooking } from "@/lib/studio/booking-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("member booking cancel", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const { id } = await params;
    const res = await cancelBooking(actor, id, { reason: "Cancelled by member", customerId });
    const message =
      res.status === "late_cancelled"
        ? "Booking cancelled. Since it was within the cancellation window, the credit isn't returned."
        : res.refunded
          ? "Booking cancelled. Your credit is back on your pass."
          : "You've left the waitlist.";
    return NextResponse.json({ success: true, data: res, message });
  });
}
