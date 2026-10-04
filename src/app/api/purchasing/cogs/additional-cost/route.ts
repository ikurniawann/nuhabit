import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, successResponse, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  additionalCostSchema,
  createAdditionalCost,
  listAdditionalCosts,
} from "@/lib/purchasing/cogs-additional-cost";

// POST /api/purchasing/cogs/additional-cost
// Biaya tambahan (freight, handling, dll) per PO/GRN, dialokasikan ke item.
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const input = await validateBody(request, additionalCostSchema);
  const data = await createAdditionalCost(db, user.id, input);
  return successResponse(data, "Biaya tambahan berhasil dialokasikan");
}, "purchasing.cogs.additional-cost.create");

// GET /api/purchasing/cogs/additional-cost
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const { data, total } = await listAdditionalCosts(db, {
    po_id: searchParams.get("po_id"),
    grn_id: searchParams.get("grn_id"),
    jenis_biaya: searchParams.get("jenis_biaya"),
  });
  return NextResponse.json({ success: true, data, pagination: { total } });
}, "purchasing.cogs.additional-cost.list");
