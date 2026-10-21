import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { voidIncident } from "@/lib/studio/coach-discipline-server";
import { incidentVoidSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Batalkan catatan pelanggaran (mis. ada surat dokter) — potongan bulan itu ikut hilang bila komisi belum disetujui. */
export async function POST(request: NextRequest, { params }: Params) {
  return studioRoute("coach incident void", async () => {
    const ctx = await requireStudioContext("update", ["studio.coach-leave"]);
    const { id } = await params;
    const b = await validateBody(request, incidentVoidSchema);
    await voidIncident(ctx.branchId, id, ctx.user.id, b.reason);
    return NextResponse.json({ success: true, message: "Catatan dibatalkan" });
  });
}
