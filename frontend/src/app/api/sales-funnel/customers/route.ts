import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rate-limit";
import { searchCustomers } from "@/lib/sales-funnel/catalog-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

/**
 * Pencarian member loyalty untuk penautan PIC (Fase D). Bidang minimal,
 * di-rate-limit per user agar tidak bisa dipakai scraping member massal.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  if (!checkRateLimit(`sales-funnel-customers:${user.id}`, 30).allowed) {
    throw new ApiError(429, "Terlalu banyak pencarian — coba lagi sebentar");
  }
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  return successResponse(await searchCustomers(q));
}, "sales-funnel.customers.GET");
