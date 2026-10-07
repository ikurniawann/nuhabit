// GET /api/purchasing/suppliers/:id/price-history.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getSupplierPriceHistory } from "@/lib/purchasing/supplier-price-history";

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const result = await getSupplierPriceHistory(db, id, {
      materialId: sp.get("material_id"),
      months: Math.max(1, parseInt(sp.get("months") || "6", 10)),
      page: Math.max(1, parseInt(sp.get("page") || "1", 10)),
      limit: Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10))),
    });
    return NextResponse.json({ success: true, ...result });
  },
  "purchasing.suppliers.price-history"
);
