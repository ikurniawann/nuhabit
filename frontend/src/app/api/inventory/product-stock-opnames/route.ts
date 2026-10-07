import { NextRequest } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { opnameCreateSchema, opnameListQuerySchema } from "@/lib/inventory/opname-sessions";
import {
  createProductStockOpname,
  listProductStockOpnames,
} from "@/lib/inventory/product-stock-opname-service";
import { parseSearchParams } from "@/lib/inventory/query-params";

const createSchema = opnameCreateSchema("Stall wajib dipilih");

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const params = parseSearchParams(request.nextUrl.searchParams, opnameListQuerySchema, "Validasi gagal", []);
  const result = await listProductStockOpnames(await getApiUserScope(), params);
  return Response.json({ success: true, ...result });
}, "GET /api/inventory/product-stock-opnames");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.itemsInventory);
  const input = await validateBody(request, createSchema);
  const data = await createProductStockOpname({ scope: await getApiUserScope(), userId: user.id, input });
  return Response.json({ success: true, data, message: "Sesi stock opname produk berhasil dibuat" });
}, "POST /api/inventory/product-stock-opnames");
