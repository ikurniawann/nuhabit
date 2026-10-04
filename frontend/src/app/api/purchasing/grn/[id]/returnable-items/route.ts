import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listReturnableGrnItems } from "@/lib/purchasing/grn-returnable";

// GET /api/purchasing/grn/[id]/returnable-items (dipakai form retur).
export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const excludeReturnId = new URL(request.url).searchParams.get("exclude_return_id");
    const data = await listReturnableGrnItems(await createServerPgClient(), id, excludeReturnId);
    return NextResponse.json({ success: true, data });
  },
  "purchasing.grn.returnable-items"
);
