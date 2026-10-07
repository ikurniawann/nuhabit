import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { deleteAdditionalCost } from "@/lib/purchasing/cogs-additional-cost";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/purchasing/cogs/additional-cost/:id (soft delete)
export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deleteAdditionalCost(user.id, id);
  return successResponse(null, "Biaya tambahan berhasil dihapus");
}, "purchasing.cogs.additional-cost.delete");
