import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { listBookingReschedules, reschedulePtBooking } from "@/lib/studio/pt-reschedule-server";
import { ptRescheduleSchema } from "@/lib/studio/schemas";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Riwayat reschedule satu booking Personal Training. */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("pt reschedule GET", async () => {
    const ctx = await requireStudioContext();
    const { id } = await params;
    return NextResponse.json({ success: true, data: await listBookingReschedules(ctx.branchId, id) });
  });
}

/** Front desk memindah sesi Personal Training (boleh ganti coach); kredit tetap, WA ke member & coach. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("pt reschedule POST", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    const b = await validateBody(request, ptRescheduleSchema);
    const res = await reschedulePtBooking(staffActor(ctx), { booking_id: id, ...b }, { by: "staff" });
    return NextResponse.json({
      success: true,
      data: res,
      message: `Personal Training dipindah ke ${res.to.date} ${res.to.time}–${res.to.end_time}. Kredit member tidak berubah${res.member_notified ? "; member dikabari lewat WA" : ""}.`,
    });
  });
}
