import { NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { opnamePatchSchema } from "@/lib/inventory/opname-sessions";
import {
  getProductStockOpnameInScope,
  saveProductStockOpnameChanges,
} from "@/lib/inventory/product-stock-opname-service";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const { id } = await params;
  const data = await getProductStockOpnameInScope(id, await getApiUserScope());
  return Response.json({ success: true, data });
}, "GET /api/inventory/product-stock-opnames/[id]");

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.itemsInventory);
  const { id } = await params;
  const input = await validateBody(request, opnamePatchSchema);
  const { result, data } = await saveProductStockOpnameChanges({
    id,
    scope: await getApiUserScope(),
    userId: user.id,
    input,
  });
  return Response.json({
    success: true,
    data,
    message:
      result === "cancelled" ? "Stock opname produk dibatalkan" : "Perubahan stock opname produk disimpan",
  });
}, "PATCH /api/inventory/product-stock-opnames/[id]");
