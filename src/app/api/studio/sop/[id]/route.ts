import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { getSopDocument, setSopActive } from "@/lib/studio/sop-server";
import { sopActiveSchema } from "@/lib/studio/schemas";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

/** Isi versi terbaru, riwayat versi, dan status konfirmasi per coach. */
export async function GET(_request: NextRequest, { params }: Params) {
  return studioRoute("sop detail", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.sop"]);
    const { id } = await params;
    const data = await getSopDocument(ctx.branchId, id);
    if (!data) throw ApiError.notFound("Dokumen SOP tidak ditemukan");
    return NextResponse.json({ success: true, data });
  });
}

/** Aktifkan / arsipkan dokumen (yang diarsipkan tidak diminta dikonfirmasi lagi). */
export async function PATCH(request: NextRequest, { params }: Params) {
  return studioRoute("sop PATCH", async () => {
    const ctx = await requireStudioContext("update", ["studio.sop"]);
    const { id } = await params;
    const b = await validateBody(request, sopActiveSchema);
    await setSopActive(ctx.branchId, id, b.is_active);
    return NextResponse.json({ success: true, message: b.is_active ? "SOP diaktifkan" : "SOP diarsipkan" });
  });
}
