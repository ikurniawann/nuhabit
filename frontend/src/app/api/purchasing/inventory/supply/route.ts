// EPIC-026 C2 — GET /api/purchasing/inventory/supply?search=&warehouse_id=&low_stock=1
// Saldo stok barang operasional per gudang. Guard: sesi ber-scope (401 bila tidak).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { listSupplyStock, requireSupplyScope } from "@/lib/purchasing/supply-inventory-queries";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const scope = requireSupplyScope(await getApiUserScope());
  const sp = new URL(request.url).searchParams;
  const data = await listSupplyStock(scope, {
    search: sp.get("search")?.trim() || null,
    warehouseId: sp.get("warehouse_id") || null,
    lowStock: sp.get("low_stock") === "1",
  });
  return NextResponse.json({ success: true, data });
}, "purchasing.inventory.supply.list");
