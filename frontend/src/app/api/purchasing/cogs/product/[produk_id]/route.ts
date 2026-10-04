import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { ApiError, requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getProductCogs } from "@/lib/purchasing/cogs-estimate";

type RouteContext = { params: Promise<{ produk_id: string }> };

// GET /api/purchasing/cogs/product/:produk_id
// Real-time estimated COGS from product BOM + inventory stock.
export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const { produk_id } = await params;
  if (!z.string().uuid().safeParse(produk_id).success) throw ApiError.badRequest("Invalid product ID");

  return successResponse(await getProductCogs(db, produk_id, scope));
}, "purchasing.cogs.product");
