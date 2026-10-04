import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { createdResponse, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  additionalCostSchema,
  createAdditionalCost,
  listAdditionalCosts,
} from "@/lib/purchasing/cogs-additional-cost";

// POST /api/purchasing/cogs/additional-cost
// Biaya tambahan (freight, bea masuk, handling, dll) per PO/GRN; ikut HPP lewat landed cost.
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, additionalCostSchema);
  const data = await createAdditionalCost(user.id, input);
  return createdResponse(data, "Biaya tambahan berhasil ditambahkan");
}, "purchasing.cogs.additional-cost.create");

// GET /api/purchasing/cogs/additional-cost?reference_type=&reference_id=&tipe_biaya=
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const { searchParams } = new URL(request.url);
  const data = await listAdditionalCosts({
    reference_type: searchParams.get("reference_type"),
    reference_id: searchParams.get("reference_id"),
    tipe_biaya: searchParams.get("tipe_biaya"),
  });
  return NextResponse.json({ success: true, data, pagination: { total: data.length } });
}, "purchasing.cogs.additional-cost.list");
