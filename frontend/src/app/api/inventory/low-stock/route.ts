import { NextRequest } from "next/server";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listLowStock } from "@/lib/inventory/low-stock";

/** GET /api/inventory/low-stock — stok di bawah minimum + saran order. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.itemsInventory);
  const sp = request.nextUrl.searchParams;
  const data = await listLowStock({ category: sp.get("category") || "", status: sp.get("status") || "" });
  return paginatedResponse(data, { page: 1, limit: data.length, total: data.length }, "Low stock report retrieved");
}, "GET /api/inventory/low-stock");
