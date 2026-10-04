// EPIC-026 C2 — pemakaian barang operasional (stok keluar).
// GET  → 100 pemakaian terbaru (sesi ber-scope)
// POST → catat pemakaian, kurangi stok (guard IAM items)
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseBodyOrThrow } from "@/lib/purchasing/pr-schemas";
import { requireSupplyScope } from "@/lib/purchasing/supply-inventory-queries";
import {
  createSupplyUsage,
  listSupplyUsages,
  supplyUsageSchema,
} from "@/lib/purchasing/supply-usage";

export const GET = apiHandler(async () => {
  const data = await listSupplyUsages(requireSupplyScope(await getApiUserScope()));
  return NextResponse.json({ success: true, data });
}, "purchasing.inventory.supply-usage.list");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = parseBodyOrThrow(supplyUsageSchema, await request.json());
  const data = await createSupplyUsage(db, scope, user.id, input);
  return NextResponse.json({ success: true, data, message: `Pemakaian ${data.nomor} tercatat` });
}, "purchasing.inventory.supply-usage.create");
