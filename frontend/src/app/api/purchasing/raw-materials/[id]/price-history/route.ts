// GET /api/purchasing/raw-materials/:id/price-history — biaya masuk GRN/import.
// Scope bisnis dari sesi user.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getRawMaterialPriceHistory } from "@/lib/purchasing/raw-material-api";

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const db = await createServerPgClient();
    const data = await getRawMaterialPriceHistory(db, await getApiUserScope(), id, {
      months: Math.max(1, parseInt(sp.get("months") || "12", 10)),
      limit: Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10))),
    });
    return NextResponse.json({ success: true, data });
  },
  "purchasing.raw-materials.price-history"
);
