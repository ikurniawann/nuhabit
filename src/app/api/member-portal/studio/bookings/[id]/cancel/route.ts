import { NextRequest, NextResponse } from "next/server";
import { cancelBooking } from "@/lib/studio/booking-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("member booking cancel", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const { id } = await params;
    const res = await cancelBooking(actor, id, { reason: "Dibatalkan member", customerId });
    const message =
      res.status === "late_cancelled"
        ? "Booking dibatalkan. Karena kurang dari batas waktu, kreditnya tidak kembali."
        : res.refunded
          ? "Booking dibatalkan. Kredit sudah kembali ke pass kamu."
          : "Kamu keluar dari waitlist.";
    return NextResponse.json({ success: true, data: res, message });
  });
}
