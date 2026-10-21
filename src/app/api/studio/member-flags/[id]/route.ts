import { NextRequest, NextResponse } from "next/server";
import { removeBackofficeFlag } from "@/lib/studio/member-flags-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Hapus penanda umum (penanda medis hanya bisa dihapus coach). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("member-flags DELETE", async () => {
    const ctx = await requireStudioContext("update", ["studio.member-flags"]);
    const { id } = await params;
    await removeBackofficeFlag(ctx.branchId, ctx.user.id, id);
    return NextResponse.json({ success: true, message: "Penanda dihapus" });
  });
}
