// GET /api/purchasing/inventory/transfer/preview?warehouse_id= — stok sumber transfer (guard IAM items).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope, validateWarehouseForReceivingScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { listWarehouseInventoryForOpname } from "@/lib/inventory/stock-opname";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

const querySchema = z.object({
  warehouse_id: z.string().uuid("Source stall is required"),
});

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const scope = await getApiUserScope();
  const { warehouse_id: warehouseId } = parseBodyOrThrow(
    querySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const warehouseCheck = await validateWarehouseForReceivingScope(warehouseId, scope, null);
  if ("error" in warehouseCheck) {
    throw ApiError.badRequest("Source stall is invalid or not allowed");
  }
  const lines = await listWarehouseInventoryForOpname(warehouseId);
  return NextResponse.json({ success: true, data: lines, total: lines.length });
}, "purchasing.inventory.transfer.preview");
