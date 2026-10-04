import { NextRequest } from "next/server";
import { noContentResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { assertRuleAccess, deleteRule, updateApprovalRule } from "@/lib/crm/advance-rules-server";
import { approvalRuleSchema } from "@/lib/crm/approvals";
import { requireCrmScope } from "@/lib/crm/guards";
import { patchSchemaOf } from "@/lib/crm/patch-schema";

type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = "Aturan tidak ditemukan";

export const PATCH = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_approval_rules", id, user, scope, NOT_FOUND);
  const patch = await validateBody(request, patchSchemaOf(approvalRuleSchema));
  return successResponse(await updateApprovalRule(id, patch), "Aturan diperbarui");
}, "crm.approval-rules.[id].PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { user, scope } = await requireCrmScope("settings");
  const { id } = await params;
  await assertRuleAccess("crm_approval_rules", id, user, scope, NOT_FOUND);
  await deleteRule("crm_approval_rules", id);
  return noContentResponse();
}, "crm.approval-rules.[id].DELETE");
