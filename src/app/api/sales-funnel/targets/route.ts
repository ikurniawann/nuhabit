import { NextRequest } from "next/server";
import { ApiError, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listTargets, parseMonthParam, saveTargets, saveTargetsSchema } from "@/lib/sales-funnel/forecast-server";
import { requireSalesFunnelUser, requireSalesScope, resolveSalesVenue } from "@/lib/sales-funnel/server";

/** EPIC-050 T-3.2 — target per salesperson + target perusahaan per bulan. GET ?month=YYYY-MM · PUT { targets: [...] } */
export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  const scope = await requireSalesScope(user);
  const month = parseMonthParam(request.nextUrl.searchParams.get("month"));
  return successResponse(await listTargets(user, scope?.companyId ?? null, month));
}, "sales-funnel.targets.GET");

export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireSalesFunnelUser();
  if (user.role === "sales") throw ApiError.forbidden("Target ditetapkan admin/super admin");
  const scope = await requireSalesScope(user);
  const { companyId } = await resolveSalesVenue(scope);
  if (!companyId) throw ApiError.badRequest("Venue belum dikonfigurasi");
  const { targets } = await validateBody(request, saveTargetsSchema);
  const saved = await saveTargets(targets, companyId, user.id);
  return successResponse({ saved }, `${saved} target disimpan`);
}, "sales-funnel.targets.PUT");
