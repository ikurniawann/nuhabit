// GET /api/purchasing/warehouses — stall/gudang dalam scope user.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { listWarehouses, warehouseListQuerySchema } from "@/lib/purchasing/warehouse-api";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(["items.product", "items.raw-material", "pos.catalog", "settings.users"]);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const params = parseBodyOrThrow(
    warehouseListQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const data = await listWarehouses(db, scope, params);
  return NextResponse.json({ success: true, data });
}, "purchasing.warehouses.list");
