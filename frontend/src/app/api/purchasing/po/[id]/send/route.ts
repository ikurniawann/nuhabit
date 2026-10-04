import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { sendPurchaseOrder } from "@/lib/purchasing/po-lifecycle";
import { poSendSchema } from "@/lib/purchasing/po-schemas";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const { sent_via } = await validateBody(request, poSendSchema);
    const data = await sendPurchaseOrder(createPgClient(), id, sent_via);
    return NextResponse.json({
      success: true,
      data,
      message: `PO berhasil dikirim ke supplier via ${sent_via}`,
    });
  },
  "purchasing.po.send"
);
