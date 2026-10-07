// EPIC-026 C2 — GET /api/purchasing/inventory/supply/form-data — gudang, barang stockable, satuan.
import { NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getSupplyFormData,
  requireSupplyScope,
} from "@/lib/purchasing/supply-inventory-queries";

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.items);
  const scope = requireSupplyScope(await getApiUserScope());
  const data = await getSupplyFormData(await createServerPgClient(), scope);
  return NextResponse.json({ success: true, data });
}, "purchasing.inventory.supply.form-data");
