import { NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { opnameCreateSchema, opnameListQuerySchema } from "@/lib/inventory/opname-sessions";
import { parseSearchParams } from "@/lib/inventory/query-params";
import { createStockOpname, listStockOpnames } from "@/lib/inventory/stock-opname-service";

const createSchema = opnameCreateSchema("Gudang wajib dipilih");

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const params = parseSearchParams(request.nextUrl.searchParams, opnameListQuerySchema, "Validasi gagal", []);
  const result = await listStockOpnames(await getApiUserScope(), params);
  return Response.json({ success: true, ...result });
}, "GET /api/inventory/stock-opnames");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.itemsInventory);
  const input = await validateBody(request, createSchema);
  const data = await createStockOpname({ scope: await getApiUserScope(), userId: user.id, input });
  return Response.json({ success: true, data, message: "Sesi stock opname berhasil dibuat" });
}, "POST /api/inventory/stock-opnames");
