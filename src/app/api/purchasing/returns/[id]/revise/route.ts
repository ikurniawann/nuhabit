import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { requestMeta } from "@/lib/audit";
import { ReturnRevisionError, revisePurchaseReturn } from "@/lib/purchasing/purchase-return-revision";

/**
 * POST /api/purchasing/returns/[id]/revise — retur yang ditolak dibuatkan
 * revisi draft baru; dokumen yang ditolak tetap tersimpan sebagai riwayat.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const revision = await revisePurchaseReturn({
      returnId: id,
      actor: { id: user.id, name: user.full_name },
      ...requestMeta(request),
    });
    return NextResponse.json(
      { success: true, data: revision, message: `Revisi ${revision.return_number} dibuat sebagai draft` },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof ReturnRevisionError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    }
    console.error("POST /api/purchasing/returns/[id]/revise", error);
    return NextResponse.json({ success: false, message: "Gagal membuat revisi retur" }, { status: 500 });
  }
}
