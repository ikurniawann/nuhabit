// /api/purchasing/supply-items — EPIC-026 B1 master barang operasional.
// Scope company+branch dari sesi user.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import {
  createSupplyItem,
  listSupplyItems,
  supplyItemCreateSchema,
} from "@/lib/purchasing/supply-items-api";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const sp = new URL(request.url).searchParams;
  const result = await listSupplyItems(db, scope, {
    search: sp.get("search"),
    isActive: sp.get("is_active"),
    stockable: sp.get("stockable"),
    page: parseInt(sp.get("page") || "1", 10),
    limit: parseInt(sp.get("limit") || "20", 10),
  });
  return NextResponse.json({ success: true, ...result });
}, "purchasing.supply-items.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(supplyItemCreateSchema, await request.json());
  const data = await createSupplyItem(db, scope, input);
  return NextResponse.json({ success: true, data }, { status: 201 });
}, "purchasing.supply-items.create");
