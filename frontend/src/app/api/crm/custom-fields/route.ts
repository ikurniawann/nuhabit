import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createCustomField, listCustomFields } from "@/lib/crm/advance-rules-server";
import { customFieldSchema } from "@/lib/crm/custom-fields";
import { requireCrmScope } from "@/lib/crm/guards";

/** EPIC-050 T-3.3 — registry custom field (Pengaturan CRM → Custom Fields). */
export const GET = apiHandler(async (request: NextRequest) => {
  const { scope } = await requireCrmScope("settings");
  const object = request.nextUrl.searchParams.get("object");
  return successResponse(await listCustomFields(scope, object));
}, "crm.custom-fields.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("settings");
  const body = await validateBody(request, customFieldSchema);
  return createdResponse(await createCustomField(user, scope, body), "Custom field dibuat");
}, "crm.custom-fields.POST");
