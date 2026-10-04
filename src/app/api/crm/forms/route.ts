import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createForm, listForms } from "@/lib/crm/forms-admin-server";
import { requireCrmScope } from "@/lib/crm/guards";
import { publicFormSchema } from "@/lib/crm/public-forms";

/** EPIC-050 T-5.3 — kelola form publik (dashboard). */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("segments");
  return successResponse(await listForms(scope));
}, "crm.forms.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("segments");
  const body = await validateBody(request, publicFormSchema);
  return createdResponse(await createForm(user, scope, body), "Form dibuat");
}, "crm.forms.POST");
