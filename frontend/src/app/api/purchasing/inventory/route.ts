// GET /api/purchasing/inventory — stok bahan baku (stall aktif / agregat).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listRawMaterialStock } from "@/lib/purchasing/inventory-queries";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const sp = new URL(request.url).searchParams;
  const data = await listRawMaterialStock(db, scope, await rawMaterialStockSource(), {
    belowMinimum: sp.get("below_minimum") === "true",
    search: sp.get("search"),
  });
  return NextResponse.json({ success: true, data });
}, "purchasing.inventory.list");
