import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { assertRuleAccess, deleteRule, updateCustomField } from "@/lib/crm/advance-rules-server";
import { customFieldSchema } from "@/lib/crm/custom-fields";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";

type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = "Field tidak ditemukan";

// key & object tidak boleh diubah (nilai tersimpan mengacu key)
const patchSchema = patchSchemaOf(customFieldSchema, ["key", "object"]);

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_custom_fields", id, user, scope, NOT_FOUND);
  const patch = await validateBody(request, patchSchema);
  return successResponse(await updateCustomField(id, patch), "Custom field diperbarui");
}, "crm.custom-fields.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_custom_fields", id, user, scope, NOT_FOUND);
  // nilai tersimpan di record tidak dihapus — hanya definisinya
  await deleteRule("crm_custom_fields", id);
  return noContentResponse();
}, "crm.custom-fields.[id].DELETE");
