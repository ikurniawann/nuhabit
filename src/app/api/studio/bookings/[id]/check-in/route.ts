import { NextRequest, NextResponse } from "next/server";
import { checkInBooking, undoCheckIn } from "@/lib/studio/booking-server";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Check-in; `?override=1` melewati jendela waktu (mis. input susulan). */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("booking check-in", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    await checkInBooking(staffActor(ctx), id, request.nextUrl.searchParams.get("override") === "1");
    return NextResponse.json({ success: true, message: "Check-in berhasil" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("booking undo check-in", async () => {
    const ctx = await requireStudioContext("update");
    const { id } = await params;
    await undoCheckIn(staffActor(ctx), id);
    return NextResponse.json({ success: true, message: "Check-in dibatalkan" });
  });
}
