import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { reschedulePtBooking } from "@/lib/studio/pt-reschedule-server";
import { memberPtRescheduleSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Member memindah sesi Personal Training ke jam kosong coach yang sama — kredit tetap, coach dikabari WA. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("member pt reschedule", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const { id } = await params;
    const b = await validateBody(request, memberPtRescheduleSchema);
    const res = await reschedulePtBooking(actor, { booking_id: id, ...b }, { by: "member", customerId });
    return NextResponse.json({
      success: true,
      data: res,
      message: `Done — your session is now ${res.to.date} at ${res.to.time}. Your credit stays the same and your coach has been notified.`,
    });
  });
}
