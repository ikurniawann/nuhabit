import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { closePurchaseOrder } from "@/lib/purchasing/po";
import { poCloseSchema } from "@/lib/purchasing/po-schemas";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const { reason } = await validateBody(request, poCloseSchema);
    const data = await closePurchaseOrder(await createServerPgClient(), id, reason, user.id);

    return NextResponse.json({
      success: true,
      data,
      message:
        "Purchase order ditutup. Kekurangan qty tidak ditagihkan; pengiriman baru tidak lagi diizinkan.",
    });
  },
  "purchasing.po.close"
);
