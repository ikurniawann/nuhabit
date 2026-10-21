import { NextRequest, NextResponse } from "next/server";
import { remindUnacknowledged } from "@/lib/studio/sop-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** WA pengingat ke coach yang belum konfirmasi versi terbaru. */
export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("sop remind", async () => {
    const ctx = await requireStudioContext("update", ["studio.sop"]);
    const { id } = await params;
    const r = await remindUnacknowledged(ctx.branchId, id);
    return NextResponse.json({
      success: true,
      data: r,
      message: r.pending === 0 ? "Semua coach sudah konfirmasi" : `Pengingat WA terkirim ke ${r.sent} dari ${r.pending} coach yang belum konfirmasi`,
    });
  });
}
