import { NextRequest } from "next/server";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { apiHandler } from "@/lib/api/handler";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import { getApiUserScope } from "@/lib/api/scope";
import { listFinishedGoodsStock } from "@/lib/inventory/finished-goods-stock";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const sp = request.nextUrl.searchParams;
  // "all" = permintaan eksplisit semua gudang; selain itu ikut stall aktif.
  const warehouseParam = sp.get("warehouse_id") || "";
  const warehouseId =
    warehouseParam === "all" ? "all" : ((await resolveWarehouseFilter(warehouseParam)) ?? "");
  const page = Number(sp.get("page") || 1);
  const limit = Number(sp.get("limit") || 20);

  const { rows, total } = await listFinishedGoodsStock({
    scope: await getApiUserScope(),
    search: sp.get("search") || "",
    status: sp.get("status") || "",
    warehouseId,
    page,
    limit,
  });
  return paginatedResponse(rows, { page, limit, total }, "Finished goods stock retrieved");
}, "GET /api/inventory/finished-goods");
