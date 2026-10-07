import { NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { opnamePatchSchema } from "@/lib/inventory/opname-sessions";
import { getStockOpnameOr404, saveStockOpnameChanges } from "@/lib/inventory/stock-opname-service";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const { id } = await params;
  return Response.json({ success: true, data: await getStockOpnameOr404(id, await getApiUserScope()) });
}, "GET /api/inventory/stock-opnames/[id]");

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.itemsInventory);
  const { id } = await params;
  const input = await validateBody(request, opnamePatchSchema);
  const { result, data } = await saveStockOpnameChanges(id, user.id, input, await getApiUserScope());
  return Response.json({
    success: true,
    data,
    message: result === "cancelled" ? "Stock opname dibatalkan" : "Perubahan stock opname disimpan",
  });
}, "PATCH /api/inventory/stock-opnames/[id]");
