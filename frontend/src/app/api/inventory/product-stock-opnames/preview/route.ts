import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, validateProductWarehouseScope } from "@/lib/api/scope";
import { listProductInventoryForOpname } from "@/lib/inventory/product-stock-opname";
import { parseSearchParams } from "@/lib/inventory/query-params";

const previewSchema = z.object({ warehouse_id: z.string().uuid("Stall wajib dipilih") });

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const scope = await getApiUserScope();
  const params = parseSearchParams(request.nextUrl.searchParams, previewSchema, "Validasi gagal", []);
  const warehouseScope = await validateProductWarehouseScope(params.warehouse_id, scope);
  if ("error" in warehouseScope) throw ApiError.badRequest(warehouseScope.error);
  const lines = await listProductInventoryForOpname(scope, params.warehouse_id);
  return Response.json({ success: true, data: lines, total: lines.length });
}, "GET /api/inventory/product-stock-opnames/preview");
