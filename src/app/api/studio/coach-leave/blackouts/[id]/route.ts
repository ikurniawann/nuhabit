import { NextResponse } from "next/server";
import { deleteBlackout } from "@/lib/studio/coach-leave-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return studioRoute("coach-leave blackout DELETE", async () => {
    const ctx = await requireStudioContext("update", ["studio.coach-leave"]);
    const { id } = await params;
    await deleteBlackout(ctx.branchId, id);
    return NextResponse.json({ success: true, message: "Tanggal blackout dihapus" });
  });
}
