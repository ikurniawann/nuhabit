// /api/purchasing/inventory/transfer — riwayat & eksekusi transfer stok antar stall (guard IAM items).
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { effectiveBranchId, getApiUserScope } from "@/lib/api/scope";
import { requestMeta } from "@/lib/audit";
import { IAM } from "@/lib/iam/prefixes";
import { listStockTransfers } from "@/lib/inventory/stock-transfer";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  stockTransferSchema,
  transferRawMaterialStock,
} from "@/lib/purchasing/inventory-stock-moves";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { z } from "zod";

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const branchId = effectiveBranchId(await getApiUserScope());
  const { page, limit } = parseBodyOrThrow(
    listQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  );
  const { rows, total } = await listStockTransfers({ branchId, page, limit });
  return NextResponse.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  });
}, "purchasing.inventory.transfer.list");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const input = parseBodyOrThrow(stockTransferSchema, await request.json());
  const scope = await getApiUserScope();
  const result = await transferRawMaterialStock(db, scope, user, input, requestMeta(request));
  return NextResponse.json({ success: true, ...result });
}, "purchasing.inventory.transfer.create");
