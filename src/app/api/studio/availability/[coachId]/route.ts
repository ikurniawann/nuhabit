import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { loadAvailability, saveAvailability } from "@/lib/studio/pt-server";
import { availabilitySaveSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ coachId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("availability GET", async () => {
    const ctx = await requireStudioContext();
    const { coachId } = await params;
    return NextResponse.json({ success: true, data: await loadAvailability(ctx.branchId, coachId) });
  });
}

/** Simpan ulang jam ketersediaan mingguan & program Personal Training coach. */
export async function PUT(request: NextRequest, { params }: Params) {
  return studioRoute("availability PUT", async () => {
    const ctx = await requireStudioContext("update");
    const { coachId } = await params;
    const b = await validateBody(request, availabilitySaveSchema);
    await saveAvailability({ companyId: ctx.companyId, branchId: ctx.branchId, userId: ctx.user.id }, coachId, b);
    return NextResponse.json({ success: true, data: await loadAvailability(ctx.branchId, coachId), message: "Ketersediaan coach disimpan" });
  });
}
