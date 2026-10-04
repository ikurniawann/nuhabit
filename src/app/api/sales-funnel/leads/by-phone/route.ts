import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rate-limit";
import { lookupPicByPhone } from "@/lib/sales-funnel/leads-server";
import { requireSalesFunnelUser, requireSalesScope } from "@/lib/sales-funnel/server";

/** Lookup PIC by no. WA untuk prefill form lead (satu PIC bisa membawa banyak leads). */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  // Anti-scan nomor (pola /customers): data kontak PIC jangan bisa dipanen
  if (!checkRateLimit(`sales-funnel-pic-lookup:${user.id}`, 30).allowed) {
    throw new ApiError(429, "Terlalu banyak pencarian — coba lagi sebentar");
  }
  const scope = await requireSalesScope(user);
  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  return successResponse(await lookupPicByPhone(user, scope, phone));
}, "sales-funnel.leads.by-phone.GET");
