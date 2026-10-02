import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { createPtBooking } from "@/lib/studio/pt-server";
import { memberPtBookingSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

/** Member booking Personal Training dari Member App (batal lewat bookings/[id]/cancel). */
export async function POST(request: NextRequest) {
  return studioRoute("member pt booking", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const b = await validateBody(request, memberPtBookingSchema);
    const res = await createPtBooking(actor, { ...b, customer_id: customerId, source: "member_app" });
    return NextResponse.json(
      { success: true, data: res, message: `Your Personal Training session is locked in: ${b.date} ${b.start_time}–${res.end_time}. ${res.pt_left} ${res.pt_left === 1 ? "session" : "sessions"} left.` },
      { status: 201 }
    );
  });
}
