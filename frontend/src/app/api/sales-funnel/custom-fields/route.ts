import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { CUSTOM_FIELD_OBJECTS, type CustomFieldObject } from "@/lib/crm/custom-fields";
import { loadCustomFieldDefs } from "@/lib/crm/custom-fields-server";
import { requireSalesFunnelUser } from "@/lib/sales-funnel/server";

/** Definisi custom field aktif untuk form (dibaca semua user sales). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireSalesFunnelUser();
  const object = request.nextUrl.searchParams.get("object") ?? "";
  if (!(CUSTOM_FIELD_OBJECTS as readonly string[]).includes(object)) {
    throw ApiError.badRequest("object wajib: lead|deal|account|contact");
  }
  const scope = await getApiUserScope();
  return successResponse(await loadCustomFieldDefs(object as CustomFieldObject, scope?.companyId ?? null));
}, "sales-funnel.custom-fields.GET");
