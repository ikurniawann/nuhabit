import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { createBlackout, listUpcomingBlackouts } from "@/lib/studio/coach-leave-server";
import { wibNow } from "@/lib/studio/jobs";
import { blackoutCreateSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MENU = ["studio.coach-leave"] as const;

/** Tanggal blackout cuti coach yang belum lewat (EPIC-067 T-067-A2). */
export async function GET() {
  return studioRoute("coach-leave blackouts GET", async () => {
    const ctx = await requireStudioContext(undefined, MENU);
    return NextResponse.json({ success: true, data: await listUpcomingBlackouts(ctx.branchId) });
  });
}

/** Program Director menetapkan rentang blackout; cuti yang sudah ada di rentang itu dikembalikan untuk ditinjau. */
export async function POST(request: NextRequest) {
  return studioRoute("coach-leave blackouts POST", async () => {
    const ctx = await requireStudioContext("update", MENU);
    const b = await validateBody(request, blackoutCreateSchema);
    if (b.date_to < wibNow().date) throw ApiError.badRequest("Rentang blackout sudah lewat");
    const data = await createBlackout(ctx, ctx.user.id, b);
    return NextResponse.json({ success: true, data, message: "Tanggal blackout ditambahkan" }, { status: 201 });
  });
}
