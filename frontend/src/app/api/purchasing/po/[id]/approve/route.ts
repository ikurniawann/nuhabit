import { NextRequest, NextResponse } from "next/server";
import { requireIamAction } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { approvePurchaseOrder } from "@/lib/purchasing/po-lifecycle";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamAction(IAM.itemsApproval, "update");
    const { id } = await params;
    const { before, data } = await approvePurchaseOrder(await createServerPgClient(), id);

    await recordAuditAfterCommit({
      actor: { id: user.id, name: user.full_name },
      action: "po.approve",
      entity: "purchase_order",
      entityId: id,
      entityLabel: before.nomor_po ?? null,
      before: { status: before.status },
      after: { status: "approved", grand_total: before.grand_total ?? null },
      ...requestMeta(request),
    });

    return NextResponse.json({ success: true, data, message: "PO berhasil diapprove" });
  },
  "purchasing.po.approve"
);
