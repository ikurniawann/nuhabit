import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { listOwners } from "@/lib/sales-funnel/catalog-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

/** Daftar user yang bisa jadi penanggung jawab/approver (sales, admin, super_admin) di scope. */
export const GET = apiHandler(async () => {
  await requireSalesFunnelUser();
  const scope = await getApiUserScope();
  return successResponse(await listOwners(scope?.companyId ?? null));
}, "sales-funnel.owners.GET");
