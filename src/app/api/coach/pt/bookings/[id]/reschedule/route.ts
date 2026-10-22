import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { requireCoach } from "@/lib/studio/coach-portal";
import { reschedulePtBooking } from "@/lib/studio/pt-reschedule-server";
import { coachPtRescheduleSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Coach memindah sesi Personal Training miliknya ke jam kosongnya sendiri; member dikabari WA. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach pt reschedule", async () => {
    const { coach, actor } = await requireCoach();
    const { id } = await params;
    const b = await validateBody(request, coachPtRescheduleSchema);
    const res = await reschedulePtBooking(actor, { booking_id: id, ...b }, { by: "coach", coachId: coach.id });
    return NextResponse.json({
      success: true,
      data: res,
      message: `Sesi dipindah ke ${res.to.date} ${res.to.time}. ${res.member_notified ? "Member dikabari lewat WA." : "Nomor member tidak valid — kabari member langsung."}`,
    });
  });
}
