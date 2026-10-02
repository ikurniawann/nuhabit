import { NextResponse } from "next/server";
import { completePastSessions } from "@/lib/studio/booking-server";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

/** Selesaikan otomatis kelas yang sudah lewat ≥ 1 jam (dipicu halaman check-in). */
export async function POST() {
  return studioRoute("sessions complete-past", async () => {
    const ctx = await requireStudioContext("update");
    const n = await completePastSessions(staffActor(ctx));
    return NextResponse.json({ success: true, data: { completed: n }, message: n ? `${n} kelas lewat diselesaikan` : "Tidak ada kelas lewat" });
  });
}
