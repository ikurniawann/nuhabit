// POST /api/purchasing/inventory/adjustment — set stok bahan baku ke qty aktual (guard IAM items).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  adjustRawMaterialStock,
  stockAdjustmentSchema,
} from "@/lib/purchasing/inventory-stock-moves";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(stockAdjustmentSchema, await request.json());
  const scope = await getApiUserScope();
  const result = await adjustRawMaterialStock(db, scope, user, input, requestMeta(request));
  return NextResponse.json({ success: true, ...result });
}, "purchasing.inventory.adjustment");
