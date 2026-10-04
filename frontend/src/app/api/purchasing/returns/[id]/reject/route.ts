import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { rejectPurchaseReturn } from "@/lib/purchasing/purchase-return-service";
import { returnRejectSchema } from "@/lib/purchasing/return-schemas";

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const returnId = (await params).id;
    const { rejection_reason } = await validateBody(request, returnRejectSchema);
    const data = await rejectPurchaseReturn(db, returnId, rejection_reason, user.id);
    return NextResponse.json({ success: true, data, message: "Return ditolak" });
  },
  "purchasing.returns.reject"
);
