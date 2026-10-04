import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteForm, listFormSubmissions, requireForm, updateForm } from "@/lib/crm/forms-admin-server";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";
import { publicFormSchema } from "@/lib/crm/public-forms";

type Ctx = { params: Promise<{ id: string }> };

async function accessibleForm({ params }: Ctx) {
  const { scope } = await requireCrmScope("segments");
  const { id } = await params;
  return requireForm(id, scope);
}

/** Kiriman terakhir form — untuk memantau spam & konversi. */
export const GET = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  const form = await accessibleForm(ctx);
  return successResponse(await listFormSubmissions(form.id));
}, "crm.forms.[id].GET");

export const PATCH = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const form = await accessibleForm(ctx);
  const patch = await validateBody(request, patchSchemaOf(publicFormSchema, ["slug"]));
  return successResponse(await updateForm(form.id, patch), "Form diperbarui");
}, "crm.forms.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await deleteForm(await accessibleForm(ctx));
  return noContentResponse();
}, "crm.forms.[id].DELETE");
