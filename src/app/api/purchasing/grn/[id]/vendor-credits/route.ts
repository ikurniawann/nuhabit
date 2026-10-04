import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getVendorCreditsByGrnId } from "@/lib/purchasing/vendor-credit-service";

// GET /api/purchasing/grn/[id]/vendor-credits
export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const credits = await getVendorCreditsByGrnId(await createServerPgClient(), id);
    return NextResponse.json({ success: true, data: credits });
  },
  "purchasing.grn.vendor-credits"
);
