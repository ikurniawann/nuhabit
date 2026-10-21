import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { recordIncident } from "@/lib/studio/coach-discipline-server";
import { incidentCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Catat coach tidak hadir tanpa kabar / terlambat (cuti mendadak tercatat otomatis). */
export async function POST(request: NextRequest) {
  return studioRoute("coach incident POST", async () => {
    const ctx = await requireStudioContext("update", ["studio.coach-leave"]);
    const b = await validateBody(request, incidentCreateSchema);
    await recordIncident(ctx, ctx.user.id, b);
    return NextResponse.json({ success: true, message: "Pelanggaran dicatat" }, { status: 201 });
  });
}
