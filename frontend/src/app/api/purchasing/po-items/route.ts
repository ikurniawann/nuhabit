import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { listPurchaseOrderItems } from "@/lib/purchasing/po-lifecycle";

// GET /api/purchasing/po-items?po_id=xxx
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const poId = new URL(request.url).searchParams.get("po_id");
  if (!poId) throw ApiError.badRequest("po_id parameter required");
  const data = await listPurchaseOrderItems(createPgClient(), poId);
  return successResponse(data || [], "PO items retrieved");
}, "purchasing.po-items.list");
