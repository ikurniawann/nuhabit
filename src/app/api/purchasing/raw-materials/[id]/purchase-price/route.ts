// GET /api/purchasing/raw-materials/:id/purchase-price — saran harga beli terakhir.
// Scope bisnis dari sesi user.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getRawMaterialPurchasePrice } from "@/lib/purchasing/raw-material-api";

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const monthsParam = parseInt(sp.get("months") || "24", 10);
    const db = await createServerPgClient();
    const data = await getRawMaterialPurchasePrice(db, await getApiUserScope(), id, {
      supplierId: sp.get("supplier_id"),
      satuanId: sp.get("satuan_id"),
      months: Number.isFinite(monthsParam) ? Math.max(1, monthsParam) : 24,
    });
    return NextResponse.json({ success: true, data });
  },
  "purchasing.raw-materials.purchase-price"
);
