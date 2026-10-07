import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, validateWarehouseForReceivingScope } from "@/lib/api/scope";
import { parseSearchParams } from "@/lib/inventory/query-params";
import { listWarehouseInventoryForOpname } from "@/lib/inventory/stock-opname";

const querySchema = z.object({ warehouse_id: z.string().uuid("Gudang wajib dipilih") });

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const params = parseSearchParams(request.nextUrl.searchParams, querySchema, "Validasi gagal", []);
  const warehouseCheck = await validateWarehouseForReceivingScope(params.warehouse_id, await getApiUserScope(), null);
  if ("error" in warehouseCheck) throw ApiError.badRequest("Gudang tidak valid atau tidak diizinkan");
  const lines = await listWarehouseInventoryForOpname(params.warehouse_id);
  return Response.json({ success: true, data: lines, total: lines.length });
}, "GET /api/inventory/stock-opnames/preview");
