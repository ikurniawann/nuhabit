import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { approvePurchaseReturn } from "@/lib/purchasing/purchase-return-service";

export const PATCH = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const approver = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const returnId = (await params).id;
    const data = await approvePurchaseReturn(db, returnId, approver.id);
    return NextResponse.json({
      success: true,
      data,
      message: "Purchase return approved. Stock has been reduced from the receipt warehouse.",
    });
  },
  "purchasing.returns.approve"
);
