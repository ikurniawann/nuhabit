import { NextRequest } from "next/server";
import { createdResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createApprovalRule, listApprovalRules } from "@/lib/crm/advance-rules-server";
import { approvalRuleSchema } from "@/lib/crm/approvals";
import { requireCrmScope } from "@/lib/crm/guards";

/** EPIC-050 T-2.4 — aturan approval diskon quotation. */
export const GET = apiHandler(async () => {
  const { scope } = await requireCrmScope("settings");
  return successResponse(await listApprovalRules(scope));
}, "crm.approval-rules.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const { user, scope } = await requireCrmScope("settings");
  const body = await validateBody(request, approvalRuleSchema);
  return createdResponse(await createApprovalRule(user, scope, body), "Aturan approval dibuat");
}, "crm.approval-rules.POST");
