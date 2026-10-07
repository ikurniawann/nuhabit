import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listLostReasons } from "@/lib/sales-funnel/catalog-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

export const GET = apiHandler(async () => {
  await requireSalesFunnelUser();
  return successResponse(await listLostReasons());
}, "sales-funnel.lost-reasons.GET");
