import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { cancelPurchaseOrder } from "@/lib/purchasing/po-lifecycle";
import { poCancelSchema } from "@/lib/purchasing/po-schemas";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const { reason } = await validateBody(request, poCancelSchema);
    const { before, data } = await cancelPurchaseOrder(await createServerPgClient(), id, reason);

    await recordAuditAfterCommit({
      actor: { id: user.id, name: user.full_name },
      action: "po.cancel",
      entity: "purchase_order",
      entityId: id,
      entityLabel: before.nomor_po ?? null,
      before: { status: before.status },
      after: { status: "cancelled" },
      reason,
      ...requestMeta(request),
    });

    return NextResponse.json({ success: true, data, message: "PO berhasil dibatalkan" });
  },
  "purchasing.po.cancel"
);
