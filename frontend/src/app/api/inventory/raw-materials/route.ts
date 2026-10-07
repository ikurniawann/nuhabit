import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { apiHandler } from "@/lib/api/handler";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import {
  effectiveBranchId,
  getApiUserScope,
  validateWarehouseForReceivingScope,
} from "@/lib/api/scope";
import { parseSearchParams } from "@/lib/inventory/query-params";
import {
  filterStockRows,
  listLegacyRawMaterialStock,
  listRawMaterialStockByBranch,
  listRawMaterialStockByWarehouse,
  mapRawMaterialStockRow,
  paginateRows,
} from "@/lib/inventory/warehouse-stock";

const querySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  warehouse_id: z.string().uuid().optional(),
});

const MESSAGE = "Raw material stock retrieved";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const scope = await getApiUserScope();
  const { search, status, page, limit, warehouse_id } = parseSearchParams(
    request.nextUrl.searchParams,
    querySchema,
    "Filter tidak valid",
    []
  );
  // Filter gudang eksplisit menang; selain itu ikut stall aktif di sidebar.
  const warehouseId = await resolveWarehouseFilter(warehouse_id);
  const branchId = effectiveBranchId(scope);

  if (!warehouseId && !branchId) {
    const { data, total } = await listLegacyRawMaterialStock({ scope, search, status, page, limit });
    return paginatedResponse(data, { page, limit, total }, MESSAGE);
  }

  if (warehouseId) {
    const check = await validateWarehouseForReceivingScope(warehouseId, scope, null);
    if ("error" in check) throw ApiError.badRequest("Gudang tidak valid atau tidak diizinkan");
  }
  const rows = warehouseId
    ? await listRawMaterialStockByWarehouse(warehouseId)
    : await listRawMaterialStockByBranch(branchId!);
  const { data, total } = paginateRows(filterStockRows(rows, search, status), page, limit);
  return paginatedResponse(data.map(mapRawMaterialStockRow), { page, limit, total }, MESSAGE);
}, "GET /api/inventory/raw-materials");
