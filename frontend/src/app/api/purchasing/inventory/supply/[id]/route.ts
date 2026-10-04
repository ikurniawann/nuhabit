// EPIC-026 C2 — GET /api/purchasing/inventory/supply/:id — saldo + kartu stok barang operasional.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import {
  getSupplyStockDetail,
  requireSupplyScope,
} from "@/lib/purchasing/supply-inventory-queries";

export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const scope = requireSupplyScope(await getApiUserScope());
    const { id } = await params;
    const data = await getSupplyStockDetail(scope, id);
    return NextResponse.json({ success: true, data });
  },
  "purchasing.inventory.supply.detail"
);
