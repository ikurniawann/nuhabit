import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { revisePurchaseReturn } from "@/lib/purchasing/purchase-return-revision";

/**
 * POST /api/purchasing/returns/[id]/revise — retur yang ditolak dibuatkan
 * revisi draft baru; dokumen yang ditolak tetap tersimpan sebagai riwayat.
 */
export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
  },
  "purchasing.returns.revise"
);
